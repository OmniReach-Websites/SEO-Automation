import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AuthenticationService,
  parseVersionedSecretKeyring,
  PostgresAuthenticationRepository,
  PostgresPasswordRecoveryOutbox,
  PostgresWebAuthnRepository,
  type AuthenticationTransactionPool,
  type PasswordRecoveryOutboxPool,
} from '@omnireach/auth';
import {
  createDatabase,
  PostgresEmailDeliveryQuota,
  type EmailDeliveryQuotaPool,
} from '@omnireach/database';
import {
  LocalAssetStorage,
  MockContactDelivery,
  PostgresAiProposalRequestRepository,
  PostgresAssetRepository,
  PostgresContentRepository,
} from '@omnireach/content';
import { contractHash, validateSiteContract, type SiteContract } from '@omnireach/contracts';
import {
  CloudflareTurnstileVerifier,
  GoogleHttpProvider,
  MockTurnstileVerifier,
  ResendAuthenticationNotifier,
  ResendAccountUsageProvider,
  ResendContactDelivery,
  ResendPlatformInquiryDelivery,
  ResendVerificationCodeNotifier,
} from '@omnireach/integrations';
import { parseConfig, redactConfig } from '@omnireach/shared';
import { withPlatformTransaction, type TenantTransactionPool } from '@omnireach/tenant';
import { discoverSiteBuildDefinitions, PostgresPreviewService } from '@omnireach/worker-publisher';
import { createClient } from 'redis';

import {
  LocalRedisPasswordRecoveryNotifier,
  LocalRedisInvitationNotifier,
  RedisEmailCodeChallengeStore,
  RedisMfaChallengeStore,
  RedisOwnerBootstrapPendingStore,
  RedisWebAuthnCeremonyStore,
  type AuthRedisClient,
  type EmailCodeRedisClient,
} from './redis-auth.ts';
import { RedisAuthenticationRateLimiter } from './auth-rate-limit.ts';
import {
  buildApiServer,
  PostgresCustomerService,
  PostgresContactService,
  PostgresOrapService,
  PostgresPlatformInquiryService,
  PostgresRequestContextResolver,
  decodeContactEncryptionKey,
  type ContextQueryPool,
} from './server.ts';
import { PostgresGoogleIntegrationService } from './postgres-google.ts';

const config = parseConfig(process.env);
const database = createDatabase(config.DATABASE_URL);
const resendAccountUsage = config.RESEND_API_KEY
  ? new ResendAccountUsageProvider({ apiKey: config.RESEND_API_KEY })
  : undefined;
const emailDeliveryQuota = new PostgresEmailDeliveryQuota(
  database.pool as unknown as EmailDeliveryQuotaPool,
  'omnireach_app',
  resendAccountUsage,
);
const redis = createClient({ url: config.REDIS_URL });
const authRepository = new PostgresAuthenticationRepository(
  database.pool as unknown as AuthenticationTransactionPool,
  config.ORAP_HOSTNAME,
);
const webAuthnRepository = new PostgresWebAuthnRepository(
  database.pool as unknown as AuthenticationTransactionPool,
  config.ORAP_HOSTNAME,
);
const mfaEncryptionKeyring = parseVersionedSecretKeyring(
  config.MFA_ENCRYPTION_KEYRING_JSON,
  config.MFA_ENCRYPTION_KEY,
);
const redisAuth = redis as unknown as AuthRedisClient;
const redisEmailCodes = redis as unknown as EmailCodeRedisClient;
const tenantPool = database.pool as unknown as TenantTransactionPool;
const recoveryDelivery = config.AUTH_EMAIL_DELIVERY_ENABLED
  ? new ResendAuthenticationNotifier({
      apiKey: config.RESEND_API_KEY ?? '',
      from: config.RESEND_AUTH_FROM ?? '',
      kind: 'password-recovery',
      quota: emailDeliveryQuota,
    })
  : new LocalRedisPasswordRecoveryNotifier(redisAuth, config.OMNIREACH_ENV);
const verificationNotifier = config.AUTH_EMAIL_DELIVERY_ENABLED
  ? new ResendVerificationCodeNotifier({
      apiKey: config.RESEND_API_KEY ?? '',
      from: config.RESEND_AUTH_FROM ?? '',
      quota: emailDeliveryQuota,
    })
  : undefined;
const recoveryOutbox = new PostgresPasswordRecoveryOutbox(
  database.pool as unknown as PasswordRecoveryOutboxPool,
  recoveryDelivery,
  mfaEncryptionKeyring,
);
const authService = new AuthenticationService(
  authRepository,
  new RedisMfaChallengeStore(redisAuth),
  recoveryOutbox,
  {
    attemptLimiter: new RedisAuthenticationRateLimiter(redisEmailCodes, config.SESSION_SECRET),
    authenticationPepper: config.SESSION_SECRET,
    emailCodeStore: new RedisEmailCodeChallengeStore(redisEmailCodes),
    factorEnrollmentStore: new RedisOwnerBootstrapPendingStore(
      redisAuth,
      'omnireach:auth:factor-enrollment:v1:',
    ),
    mfaEncryptionKeyring,
    orapHostname: config.ORAP_HOSTNAME,
    ownerBootstrapStore: new RedisOwnerBootstrapPendingStore(redisAuth),
    webAuthnAuthenticationEnabled: true,
    webAuthnCeremonies: new RedisWebAuthnCeremonyStore(redisAuth),
    webAuthnRepository,
    ...(verificationNotifier ? { verificationNotifier } : {}),
  },
);
const requestContext = new PostgresRequestContextResolver(
  database.pool as unknown as ContextQueryPool,
  config.ORAP_HOSTNAME,
);
const buildDefinitions = discoverSiteBuildDefinitions(config.REPOSITORY_ROOT);
const siteContracts = new Map<string, SiteContract>(
  [...buildDefinitions.keys()].map((sourcePath) => [
    sourcePath,
    validateSiteContract(
      JSON.parse(
        readFileSync(resolve(config.REPOSITORY_ROOT, sourcePath, 'site.manifest.json'), 'utf8'),
      ),
    ),
  ]),
);
const contactEncryptionKey = decodeContactEncryptionKey(config.CONTACT_ENCRYPTION_KEY);
const customerService = new PostgresCustomerService(
  tenantPool,
  new PostgresContentRepository(tenantPool),
  new PostgresAssetRepository(tenantPool, new LocalAssetStorage(config.ASSET_STORAGE_ROOT)),
  new PostgresPreviewService(tenantPool, {
    artifactsRoot: config.PREVIEW_STORAGE_ROOT,
    assetsRoot: config.ASSET_STORAGE_ROOT,
    codeSha: config.SOURCE_COMMIT_SHA,
    definitions: buildDefinitions,
    repositoryRoot: config.REPOSITORY_ROOT,
    signingKey: config.PREVIEW_SIGNING_KEY,
  }),
  contactEncryptionKey,
  config.OPENAI_PROVIDER_ENABLED ? new PostgresAiProposalRequestRepository(tenantPool) : undefined,
);
const orapService = new PostgresOrapService(
  tenantPool,
  config.AUTH_EMAIL_DELIVERY_ENABLED
    ? new ResendAuthenticationNotifier({
        apiKey: config.RESEND_API_KEY ?? '',
        from: config.RESEND_AUTH_FROM ?? '',
        kind: 'invitation',
        quota: emailDeliveryQuota,
      })
    : new LocalRedisInvitationNotifier(redisAuth, config.OMNIREACH_ENV),
  (input) => authService.requestPasswordRecovery(input),
  new Map(
    [...siteContracts].map(([sourcePath, contract]) => [
      sourcePath,
      {
        businessLocationCount: Math.max(
          1,
          contract.facts.filter((fact) => fact.kind === 'address').length,
        ),
        contactForms: contract.contactForms.map((form) => ({
          fieldIds: form.fields.map(({ id }) => id),
          id: form.id,
          requiredFieldIds: form.fields.filter(({ required }) => required).map(({ id }) => id),
        })),
        contractHash: contractHash(contract),
        contractVersion: contract.version,
        standardPageCount: contract.routes.length,
      },
    ]),
  ),
  {
    alertEnabled: config.ALERT_EMAIL_DELIVERY_ENABLED,
    alertSender: config.RESEND_ALERT_FROM,
    authenticationEnabled: config.AUTH_EMAIL_DELIVERY_ENABLED,
    ...(config.RESEND_AUTH_FROM ? { authenticationSender: config.RESEND_AUTH_FROM } : {}),
    contactEnabled: config.CONTACT_DELIVERY_ENABLED,
    contactSender: config.RESEND_CONTACT_FROM,
    credentialConfigured: Boolean(config.RESEND_API_KEY),
    turnstileConfigured: Boolean(config.TURNSTILE_SECRET_KEY && config.TURNSTILE_SITE_KEY),
  },
);
const integrationService = config.GOOGLE_INTEGRATION_ENABLED
  ? new PostgresGoogleIntegrationService(tenantPool, {
      allowedRedirectUris: [`https://${config.ORAP_HOSTNAME}/v1/orap/integrations/google/callback`],
      encryptionKeyHex: config.GOOGLE_TOKEN_ENCRYPTION_KEY ?? '',
      provider: new GoogleHttpProvider({
        clientId: config.GOOGLE_CLIENT_ID ?? '',
        clientSecret: config.GOOGLE_CLIENT_SECRET ?? '',
      }),
    })
  : undefined;
const contactDelivery = config.CONTACT_DELIVERY_ENABLED
  ? new ResendContactDelivery({
      apiKey: config.RESEND_API_KEY ?? '',
      from: config.RESEND_CONTACT_FROM,
      maxAttempts: 4,
      quota: emailDeliveryQuota,
    })
  : new MockContactDelivery();
const contactService = new PostgresContactService(tenantPool, contactDelivery, {
  contracts: siteContracts,
  deliveryEnabled: config.CONTACT_DELIVERY_ENABLED,
  encryptionKey: contactEncryptionKey,
  turnstile: config.TURNSTILE_SECRET_KEY
    ? new CloudflareTurnstileVerifier(config.TURNSTILE_SECRET_KEY)
    : new MockTurnstileVerifier(config.OMNIREACH_ENV === 'local'),
  ...(config.TURNSTILE_SITE_KEY ? { turnstileSiteKey: config.TURNSTILE_SITE_KEY } : {}),
});
const platformInquiryDeliveryEnabled = config.PLATFORM_INQUIRY_ENABLED;
const platformInquiryDelivery = platformInquiryDeliveryEnabled
  ? new ResendPlatformInquiryDelivery({
      apiKey: config.RESEND_API_KEY ?? '',
      from: config.RESEND_CONTACT_FROM,
      quota: emailDeliveryQuota,
    })
  : {
      async deliver() {
        return { providerReference: 'local-platform-inquiry' };
      },
    };
const platformInquiryService = new PostgresPlatformInquiryService(
  tenantPool,
  platformInquiryDelivery,
  {
    deliveryEnabled: platformInquiryDeliveryEnabled,
    turnstile: config.TURNSTILE_SECRET_KEY
      ? new CloudflareTurnstileVerifier(config.TURNSTILE_SECRET_KEY)
      : new MockTurnstileVerifier(config.OMNIREACH_ENV === 'local'),
    ...(config.TURNSTILE_SITE_KEY ? { turnstileSiteKey: config.TURNSTILE_SITE_KEY } : {}),
  },
);
redis.on('error', (error) => server.log.error({ error }, 'Redis client error'));

const server = buildApiServer({
  authService,
  contactService,
  customerService,
  dependencies: [
    { check: () => database.healthCheck(), name: 'postgres' },
    { check: async () => void (await redis.ping()), name: 'redis' },
  ],
  logLevel: config.LOG_LEVEL,
  openAiBenchmarkReport: () =>
    withPlatformTransaction(
      tenantPool,
      { actorId: '00000000-0000-4000-8000-000000000000' },
      async (client) => {
        const [result, diagnostics] = (await Promise.all([
          client.query(
            `SELECT passed, safe_result, created_at
             FROM ai_evaluation_results
            WHERE fixture_id = 'production-openai-live-v1'
            ORDER BY created_at DESC LIMIT 1`,
          ),
          client.query(
            `WITH latest_feature AS (
               SELECT key, version, overrideable, safe_default
                 FROM feature_definitions
                WHERE key = 'content.edit'
                ORDER BY version DESC LIMIT 1
             ), site_policy AS (
               SELECT site.id, site.tenant_id,
                      COALESCE(control.editing_frozen, false) AS editing_frozen,
                      sub.status AS subscription_status,
                      sub.grace_ends_at,
                      COALESCE(
                        CASE WHEN feature.overrideable THEN site_override.enabled END,
                        plan.enabled,
                        feature.safe_default,
                        false
                      ) AS feature_enabled
                 FROM sites site
                 LEFT JOIN subscriptions sub
                   ON sub.tenant_id = site.tenant_id AND sub.site_id = site.id
                 LEFT JOIN site_emergency_controls control
                   ON control.tenant_id = site.tenant_id AND control.site_id = site.id
                 LEFT JOIN latest_feature feature ON true
                 LEFT JOIN site_feature_overrides site_override
                   ON site_override.tenant_id = site.tenant_id
                  AND site_override.site_id = site.id
                  AND site_override.feature_key = feature.key
                  AND site_override.feature_version = feature.version
                 LEFT JOIN plan_features plan
                   ON plan.plan_id = sub.plan_id AND plan.feature_key = feature.key
                  AND plan.feature_version = feature.version
                WHERE site.status = 'active'
             )
             SELECT
               count(*)::integer AS active_site_count,
               count(*) FILTER (
                 WHERE NOT editing_frozen AND feature_enabled
                   AND (subscription_status = 'active'
                     OR (subscription_status IN ('past_due', 'cancelled')
                       AND grace_ends_at >= now()))
               )::integer AS content_edit_allowed_site_count,
               (SELECT count(*)::integer FROM content_fields field
                 JOIN site_policy policy
                   ON policy.tenant_id = field.tenant_id AND policy.id = field.site_id
                WHERE NOT field.protected AND field.ai_mode <> 'disabled'
                  AND field.field_type IN ('text', 'richText'))
                 AS eligible_field_metadata_count,
               (SELECT count(DISTINCT (revision.tenant_id, revision.site_id))::integer
                  FROM content_revisions revision
                  JOIN site_policy policy
                    ON policy.tenant_id = revision.tenant_id AND policy.id = revision.site_id)
                 AS site_with_revision_count
             FROM site_policy`,
          ),
        ])) as [
          { rows: { created_at: Date; passed: boolean; safe_result: unknown }[] },
          {
            rows: {
              active_site_count: number;
              content_edit_allowed_site_count: number;
              eligible_field_metadata_count: number;
              site_with_revision_count: number;
            }[];
          },
        ];
        const row = result.rows[0];
        const preflight = diagnostics.rows[0] ?? {
          active_site_count: 0,
          content_edit_allowed_site_count: 0,
          eligible_field_metadata_count: 0,
          site_with_revision_count: 0,
        };
        const safePreflight = {
          activeSiteCount: preflight.active_site_count,
          contentEditAllowedSiteCount: preflight.content_edit_allowed_site_count,
          eligibleFieldMetadataCount: preflight.eligible_field_metadata_count,
          siteWithRevisionCount: preflight.site_with_revision_count,
        };
        if (!row) return { preflight: safePreflight, state: 'missing' };
        return {
          createdAt: row.created_at.toISOString(),
          passed: row.passed,
          preflight: safePreflight,
          result: sanitizeBenchmarkResult(row.safe_result),
        };
      },
    ),
  ...(integrationService ? { integrationService } : {}),
  orapService,
  platformInquiryService,
  resolveCustomerPrincipal: (request) => requestContext.customer(request),
  resolveContactSite: (request) => requestContext.contact(request),
  resolveGoogleCallbackActor: (request) => requestContext.platformGoogleCallback(request),
  resolvePlatformActor: (request) => requestContext.platform(request),
  trustedProxyCidrs: config.TRUSTED_PROXY_CIDRS,
});

function sanitizeBenchmarkResult(value: unknown): Record<string, boolean | number | string | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { state: 'invalid' };
  const source = value as Record<string, unknown>;
  const allowed = [
    'code',
    'completedAt',
    'costUsdMicros',
    'inputTokens',
    'latencyMs',
    'liveContentChanged',
    'model',
    'outputTokens',
    'promptInjectionResistance',
    'proposalPersisted',
    'protectedFactGuardPassed',
    'state',
  ] as const;
  return Object.fromEntries(
    allowed.flatMap((key) => {
      const candidate = source[key];
      return candidate === null || ['boolean', 'number', 'string'].includes(typeof candidate)
        ? [[key, candidate as boolean | number | string | null]]
        : [];
    }),
  );
}

async function shutdown(signal: string): Promise<void> {
  server.log.info({ signal }, 'Shutting down API');
  await server.close();
  await recoveryOutbox.stop();
  if (redis.isOpen) await redis.quit();
  await database.close();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await redis.connect();
  await server.listen({ host: config.API_HOST, port: config.API_PORT });
  recoveryOutbox.start(() =>
    server.log.error('Password-recovery outbox processing failed; delivery remains queued'),
  );
  server.log.info({ config: redactConfig(config) }, 'API started');
} catch (error) {
  server.log.fatal({ error }, 'API startup failed');
  await shutdown('startup-error');
  process.exitCode = 1;
}
