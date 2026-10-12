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
import { createDatabase } from '@omnireach/database';
import {
  LocalAssetStorage,
  MockContactDelivery,
  PostgresAssetRepository,
  PostgresContentRepository,
} from '@omnireach/content';
import { contractHash, validateSiteContract, type SiteContract } from '@omnireach/contracts';
import {
  CloudflareTurnstileVerifier,
  MockTurnstileVerifier,
  ResendAuthenticationNotifier,
  ResendContactDelivery,
  ResendVerificationCodeNotifier,
} from '@omnireach/integrations';
import { parseConfig, redactConfig } from '@omnireach/shared';
import type { TenantTransactionPool } from '@omnireach/tenant';
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
  PostgresRequestContextResolver,
  decodeContactEncryptionKey,
  type ContextQueryPool,
} from './server.ts';

const config = parseConfig(process.env);
const database = createDatabase(config.DATABASE_URL);
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
    })
  : new LocalRedisPasswordRecoveryNotifier(redisAuth, config.OMNIREACH_ENV);
const verificationNotifier = config.AUTH_EMAIL_DELIVERY_ENABLED
  ? new ResendVerificationCodeNotifier({
      apiKey: config.RESEND_API_KEY ?? '',
      from: config.RESEND_AUTH_FROM ?? '',
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
    mfaEncryptionKeyring,
    orapHostname: config.ORAP_HOSTNAME,
    ownerBootstrapStore: new RedisOwnerBootstrapPendingStore(redisAuth),
    // This kill switch intentionally cannot be enabled from production configuration
    // until assertion/login support lands and is tested in the same release.
    webAuthnAuthenticationEnabled: false,
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
    codeSha: config.SOURCE_COMMIT_SHA,
    definitions: buildDefinitions,
    repositoryRoot: config.REPOSITORY_ROOT,
    signingKey: config.PREVIEW_SIGNING_KEY,
  }),
  contactEncryptionKey,
);
const orapService = new PostgresOrapService(
  tenantPool,
  config.AUTH_EMAIL_DELIVERY_ENABLED
    ? new ResendAuthenticationNotifier({
        apiKey: config.RESEND_API_KEY ?? '',
        from: config.RESEND_AUTH_FROM ?? '',
        kind: 'invitation',
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
);
const contactDelivery = config.CONTACT_DELIVERY_ENABLED
  ? new ResendContactDelivery({
      apiKey: config.RESEND_API_KEY ?? '',
      from: config.RESEND_CONTACT_FROM,
    })
  : new MockContactDelivery();
const contactService = new PostgresContactService(tenantPool, contactDelivery, {
  contracts: siteContracts,
  encryptionKey: contactEncryptionKey,
  turnstile: config.TURNSTILE_SECRET_KEY
    ? new CloudflareTurnstileVerifier(config.TURNSTILE_SECRET_KEY)
    : new MockTurnstileVerifier(config.OMNIREACH_ENV === 'local'),
  ...(config.TURNSTILE_SITE_KEY ? { turnstileSiteKey: config.TURNSTILE_SITE_KEY } : {}),
});
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
  orapService,
  resolveCustomerPrincipal: (request) => requestContext.customer(request),
  resolveContactSite: (request) => requestContext.contact(request),
  resolvePlatformActor: (request) => requestContext.platform(request),
  trustedProxyCidrs: config.TRUSTED_PROXY_CIDRS,
});

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
