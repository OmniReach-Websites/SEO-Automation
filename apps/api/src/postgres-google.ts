import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import {
  GoogleConnectionManager,
  GoogleProviderError,
  createOAuthRequest,
  type GoogleMetricPoint,
  type GoogleProperty,
  type GoogleProviderClient,
  type GoogleTokenSet,
  type OAuthRequest,
} from '@omnireach/integrations';
import { assertOrapCapability } from '@omnireach/auth';
import {
  withPlatformTransaction,
  type AdminActor,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';

import type { IntegrationEndpointService } from './integration-routes.ts';

interface GoogleServiceOptions {
  allowedRedirectUris: readonly string[];
  encryptionKeyHex: string;
  keyVersion?: number;
  now?: () => Date;
  provider: GoogleProviderClient;
}

interface OAuthStateRow extends Record<string, unknown> {
  encrypted_request: Uint8Array;
  initiated_by: string;
  key_version: number;
  property_kind: GoogleProperty['kind'];
  redirect_uri: string;
  site_id: string;
  tenant_id: string;
}

interface ConnectionRow extends Record<string, unknown> {
  credential_ref: string;
  id: string;
  property_id: string;
  property_kind: GoogleProperty['kind'];
  property_mapping: string;
  site_id: string;
  status: string;
  tenant_id: string;
}

export class PostgresGoogleIntegrationService implements IntegrationEndpointService {
  readonly #allowedRedirectUris: readonly string[];
  readonly #connectionManager = new GoogleConnectionManager();
  readonly #encryptionKey: Buffer;
  readonly #keyVersion: number;
  readonly #now: () => Date;
  readonly #provider: GoogleProviderClient;

  constructor(
    private readonly pool: TenantTransactionPool,
    options: GoogleServiceOptions,
  ) {
    if (!/^[a-f0-9]{64}$/iu.test(options.encryptionKeyHex)) {
      throw new Error('Google integration encryption key must be exactly 32 bytes');
    }
    if (options.allowedRedirectUris.length === 0) {
      throw new Error('At least one exact Google OAuth redirect URI is required');
    }
    this.#allowedRedirectUris = [...options.allowedRedirectUris];
    this.#encryptionKey = Buffer.from(options.encryptionKeyHex, 'hex');
    this.#keyVersion = options.keyVersion ?? 1;
    this.#now = options.now ?? (() => new Date());
    this.#provider = options.provider;
  }

  startGoogle(
    actor: AdminActor,
    input: { propertyKind: GoogleProperty['kind']; redirectUri: string; siteId: string },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'integrations.google.manage', { siteId: input.siteId });
    const request = createOAuthRequest(input.redirectUri, this.#allowedRedirectUris);
    const scopes = scopesFor(input.propertyKind);
    return withPlatformTransaction(this.pool, { actorId: actor.id }, async (client) => {
      const site = required(
        (
          await query<{
            hostname: string;
            site_id: string;
            tenant_id: string;
          }>(
            client,
            `SELECT site.id AS site_id, site.tenant_id, domain.hostname
               FROM sites site
               JOIN tenants tenant ON tenant.id = site.tenant_id AND tenant.status = 'active'
               JOIN domains domain
                 ON domain.tenant_id = site.tenant_id AND domain.site_id = site.id
                AND domain.kind = 'public' AND domain.active
                AND domain.verification_status = 'verified'
              WHERE site.id = $1 AND site.status = 'active'
              LIMIT 2`,
            [input.siteId],
          )
        ).rows,
        'An exact verified public site is required before Google consent',
      );
      const now = this.#now();
      await client.query(
        `INSERT INTO google_oauth_states
           (state_hash, tenant_id, site_id, property_kind, redirect_uri,
            encrypted_request, key_version, initiated_by, scopes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
        [
          digest(request.state),
          site.tenant_id,
          site.site_id,
          input.propertyKind,
          request.redirectUri,
          this.encrypt(request, site.tenant_id, site.site_id),
          this.#keyVersion,
          actor.id,
          JSON.stringify(scopes),
          new Date(now.getTime() + 5 * 60_000),
        ],
      );
      await audit(client, actor, {
        action: 'integration.google.consent_started',
        metadata: { propertyKind: input.propertyKind, scopes },
        siteId: site.site_id,
        targetId: site.site_id,
        tenantId: site.tenant_id,
      });
      return {
        authorizationUrl: this.#provider.authorizationUrl(request, input.propertyKind),
        consent: {
          access:
            input.propertyKind === 'ga4'
              ? 'Read-only GA4 reporting'
              : 'Read-only Search Console reporting',
          disconnect:
            'Collection stops immediately when disconnected. Retained metrics follow the approved retention policy.',
          propertySelection:
            'Only a property whose public website exactly matches this site can be selected.',
        },
        expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      };
    });
  }

  async finishGoogle(
    actor: AdminActor,
    input: { code: string; propertyId?: string; state: string },
  ): Promise<unknown> {
    const state = await withPlatformTransaction(
      this.pool,
      { actorId: actor.id },
      async (client) => {
        const now = this.#now();
        const rows = await query<OAuthStateRow>(
          client,
          `UPDATE google_oauth_states
            SET consumed_at = $1
          WHERE state_hash = $2 AND initiated_by = $3
            AND consumed_at IS NULL AND expires_at > $1
          RETURNING tenant_id, site_id, property_kind, redirect_uri,
                    encrypted_request, key_version, initiated_by`,
          [now, digest(input.state), actor.id],
        );
        const storedState = required(
          rows.rows,
          'Google OAuth state is invalid, expired, replayed, or belongs to another actor',
        );
        assertOrapCapability(actor, 'integrations.google.manage', {
          siteId: storedState.site_id,
        });
        return storedState;
      },
    );
    let stage: GoogleCallbackStage = 'decrypt_state';
    try {
      const request = this.decrypt<OAuthRequest>(
        state.encrypted_request,
        state.tenant_id,
        state.site_id,
        state.key_version,
      );
      stage = 'validate_callback';
      this.#connectionManager.acceptCallback(request, {
        nonce: request.nonce,
        redirectUri: state.redirect_uri,
        state: input.state,
      });
      stage = 'exchange_code';
      const tokens = await this.#provider.exchangeCode({ code: input.code, request });
      stage = 'validate_scopes';
      assertScopes(tokens.scopes, state.property_kind);
      stage = 'list_properties';
      const properties = await this.#provider.listProperties(tokens, state.property_kind);
      stage = 'resolve_site_hostname';
      const siteHostname = await this.publicHostname(actor, state.tenant_id, state.site_id);
      const eligible = properties.filter((property) => {
        try {
          this.#connectionManager.verifyProperty(property, siteHostname);
          return true;
        } catch {
          return false;
        }
      });
      stage = 'store_credential';
      const credentialId = await this.storeCredential(
        actor,
        state.tenant_id,
        state.site_id,
        tokens,
      );
      const selected = input.propertyId
        ? eligible.find((property) => property.id === input.propertyId)
        : eligible.length === 1
          ? eligible[0]
          : undefined;
      if (!selected) {
        return {
          eligibleProperties: eligible.map((property) => ({
            id: property.id,
            kind: property.kind,
            siteUrl: property.siteUrl,
          })),
          pendingSelectionId: credentialId,
          siteId: state.site_id,
          status: eligible.length === 0 ? 'no_matching_property' : 'property_selection_required',
        };
      }
      stage = 'connect_property';
      return await this.connectProperty(actor, {
        credentialId,
        property: selected,
        scopes: tokens.scopes,
        siteId: state.site_id,
        tenantId: state.tenant_id,
      });
    } catch (error) {
      throw new GoogleIntegrationCallbackError(
        error instanceof GoogleProviderError ? error.code : 'connection_failed',
        state.site_id,
        stage,
        error,
      );
    }
  }

  selectGoogleProperty(
    actor: AdminActor,
    input: {
      pendingSelectionId: string;
      propertyId: string;
      propertyKind: GoogleProperty['kind'];
      siteId: string;
    },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'integrations.google.manage', { siteId: input.siteId });
    return withPlatformTransaction(this.pool, { actorId: actor.id }, async (client) => {
      const credential = required(
        (
          await query<{
            encrypted_payload: Uint8Array;
            key_version: number;
            site_id: string;
            tenant_id: string;
          }>(
            client,
            `SELECT tenant_id, site_id, encrypted_payload, key_version
               FROM integration_credentials
              WHERE id = $1 AND site_id = $2 AND provider = 'google' AND revoked_at IS NULL`,
            [input.pendingSelectionId, input.siteId],
          )
        ).rows,
        'Pending Google credential was not found',
      );
      const tokens = this.decrypt<GoogleTokenSet>(
        credential.encrypted_payload,
        credential.tenant_id,
        credential.site_id,
        credential.key_version,
      );
      const properties = await this.#provider.listProperties(tokens, input.propertyKind);
      const hostname = required(
        (
          await query<{ hostname: string }>(
            client,
            `SELECT hostname FROM domains
              WHERE tenant_id = $1 AND site_id = $2 AND kind = 'public'
                AND active AND verification_status = 'verified' LIMIT 2`,
            [credential.tenant_id, credential.site_id],
          )
        ).rows,
        'Verified public hostname was not found',
      ).hostname;
      const property = properties.find((candidate) => candidate.id === input.propertyId);
      if (!property) throw new Error('Selected Google property is unavailable');
      this.#connectionManager.verifyProperty(property, hostname);
      return this.connectProperty(
        actor,
        {
          credentialId: input.pendingSelectionId,
          property,
          scopes: tokens.scopes,
          siteId: credential.site_id,
          tenantId: credential.tenant_id,
        },
        client,
      );
    });
  }

  list(actor: AdminActor, siteId: string): Promise<unknown> {
    assertOrapCapability(actor, 'integrations.google.view', { siteId });
    return withPlatformTransaction(this.pool, { actorId: actor.id }, async (client) => {
      const rows = await query<Record<string, unknown>>(
        client,
        `SELECT connection.id, connection.property_kind, connection.property_id,
                connection.property_mapping, connection.scopes, connection.status,
                connection.permissions_provenance, connection.last_synced_at,
                connection.token_expires_at, connection.refresh_failure_code,
                connection.disconnected_at, connection.collection_stopped_at,
                connection.created_at, connection.updated_at
           FROM integration_connections connection
          WHERE connection.site_id = $1 AND connection.provider = 'google'
          ORDER BY connection.property_kind`,
        [siteId],
      );
      return {
        connections: rows.rows.map((row) => ({
          ...row,
          source: row.property_kind === 'ga4' ? 'Google Analytics 4' : 'Google Search Console',
          freshness: freshness(row.last_synced_at, this.#now()),
        })),
      };
    });
  }

  async disconnect(
    actor: AdminActor,
    input: { connectionId: string; reason: string },
  ): Promise<unknown> {
    assertOrapCapability(actor, 'integrations.google.manage');
    const disconnected = await withPlatformTransaction(
      this.pool,
      { actorId: actor.id },
      async (client) => {
        const row = required(
          (
            await query<ConnectionRow & { encrypted_payload: Uint8Array; key_version: number }>(
              client,
              `SELECT connection.*, credential.encrypted_payload, credential.key_version
               FROM integration_connections connection
               JOIN integration_credentials credential ON credential.id::text = connection.credential_ref
              WHERE connection.id = $1 AND connection.provider = 'google'
              FOR UPDATE OF connection, credential`,
              [input.connectionId],
            )
          ).rows,
          'Google connection was not found',
        );
        const now = this.#now();
        await client.query(
          `UPDATE integration_connections
            SET status = 'disconnected', disconnected_at = $2,
                collection_stopped_at = $2, updated_at = $2
          WHERE id = $1`,
          [row.id, now],
        );
        await client.query(
          `UPDATE schedules schedule
              SET enabled = false, updated_at = $3
            WHERE schedule.tenant_id = $1 AND schedule.site_id = $2
              AND schedule.category = 'metrics_sync'
              AND NOT EXISTS (
                SELECT 1 FROM integration_connections connection
                 WHERE connection.tenant_id = schedule.tenant_id
                   AND connection.site_id = schedule.site_id
                   AND connection.provider = 'google'
                   AND connection.status = 'connected'
                   AND connection.collection_stopped_at IS NULL
              )`,
          [row.tenant_id, row.site_id, now],
        );
        await audit(client, actor, {
          action: 'integration.google.disconnected',
          metadata: { propertyKind: row.property_kind, reason: input.reason.trim() },
          siteId: row.site_id,
          targetId: row.id,
          tenantId: row.tenant_id,
        });
        return {
          credentialRef: row.credential_ref,
          tokens: this.decrypt<GoogleTokenSet>(
            row.encrypted_payload,
            row.tenant_id,
            row.site_id,
            row.key_version,
          ),
        };
      },
    );
    let providerRevocation: 'failed' | 'succeeded' = 'succeeded';
    try {
      await this.#provider.revoke(disconnected.tokens);
    } catch {
      providerRevocation = 'failed';
    }
    await withPlatformTransaction(this.pool, { actorId: actor.id }, async (client) => {
      await client.query(
        `UPDATE integration_credentials SET revoked_at = $2, updated_at = $2 WHERE id = $1`,
        [disconnected.credentialRef, this.#now()],
      );
    });
    return { providerRevocation, status: 'disconnected' };
  }

  async syncConnection(input: {
    connectionId: string;
    endDate: string;
    now?: Date;
    siteId: string;
    startDate: string;
    tenantId: string;
  }): Promise<{ inserted: number; status: 'connected' | 'error' }> {
    const loaded = await this.withWorkerSite(input, async (client) => {
      const row = required(
        (
          await query<
            ConnectionRow & {
              encrypted_payload: Uint8Array;
              key_version: number;
              token_expires_at: Date | null;
            }
          >(
            client,
            `SELECT connection.*, credential.encrypted_payload, credential.key_version,
                    connection.token_expires_at
               FROM integration_connections connection
               JOIN integration_credentials credential ON credential.id::text = connection.credential_ref
              WHERE connection.id = $1 AND connection.tenant_id = $2 AND connection.site_id = $3
                AND connection.status = 'connected' AND credential.revoked_at IS NULL`,
            [input.connectionId, input.tenantId, input.siteId],
          )
        ).rows,
        'Active Google connection was not found',
      );
      return row;
    });
    let tokens = this.decrypt<GoogleTokenSet>(
      loaded.encrypted_payload,
      input.tenantId,
      input.siteId,
      loaded.key_version,
    );
    try {
      const now = input.now ?? this.#now();
      if (new Date(tokens.expiresAt).getTime() <= now.getTime() + 60_000) {
        tokens = await this.#provider.refresh(tokens);
      }
      const property: GoogleProperty = {
        id: loaded.property_id,
        kind: loaded.property_kind,
        siteUrl: loaded.property_mapping,
      };
      const points = await this.#provider.collect({
        endDate: input.endDate,
        property,
        startDate: input.startDate,
        tokens,
      });
      const inserted = await this.persistMetrics(input, points, tokens, now);
      return { inserted, status: 'connected' };
    } catch (error) {
      const code = error instanceof GoogleProviderError ? error.code : 'collection_failed';
      await this.withWorkerSite(input, async (client) => {
        await client.query(
          `UPDATE integration_connections
              SET status = CASE WHEN $2 = 'revoked_or_expired' THEN 'expired' ELSE 'error' END,
                  refresh_failure_code = $2, updated_at = $3
            WHERE id = $1`,
          [input.connectionId, code, input.now ?? this.#now()],
        );
      });
      return { inserted: 0, status: 'error' };
    }
  }

  private async persistMetrics(
    input: {
      connectionId: string;
      endDate: string;
      now?: Date;
      siteId: string;
      startDate: string;
      tenantId: string;
    },
    points: readonly GoogleMetricPoint[],
    tokens: GoogleTokenSet,
    now: Date,
  ): Promise<number> {
    return this.withWorkerSite(input, async (client) => {
      let inserted = 0;
      for (const point of points) {
        const result = await query<{ id: string; inserted: boolean }>(
          client,
          `INSERT INTO metric_snapshots
             (tenant_id, site_id, connection_id, source, metric, dimensions,
              window_start, window_end, value, source_hash, ingested_at, expires_at)
           VALUES (
             $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9,
             encode(
               digest(
                 concat_ws(
                   chr(31), $3::text, $4, $5, ($6::jsonb)::text,
                   extract(epoch FROM $7::timestamptz)::text,
                   extract(epoch FROM $8::timestamptz)::text
                 ),
                 'sha256'
               ),
               'hex'
             ),
             $10, $11
           )
           ON CONFLICT (connection_id, source_hash) DO UPDATE
             SET value = EXCLUDED.value,
                 ingested_at = EXCLUDED.ingested_at,
                 expires_at = EXCLUDED.expires_at
             WHERE metric_snapshots.value IS DISTINCT FROM EXCLUDED.value
           RETURNING id, (xmax = 0) AS inserted`,
          [
            input.tenantId,
            input.siteId,
            input.connectionId,
            point.source,
            point.metric,
            JSON.stringify(point.dimensions),
            `${point.startDate}T00:00:00Z`,
            `${point.endDate}T23:59:59.999Z`,
            point.value,
            now,
            new Date(now.getTime() + 18 * 30 * 24 * 60 * 60_000),
          ],
        );
        inserted += result.rows.filter((row) => row.inserted).length;
      }
      await client.query(
        `UPDATE integration_credentials
            SET encrypted_payload = $2, key_version = $3, expires_at = $4, updated_at = $5
          WHERE id = (SELECT credential_ref::uuid FROM integration_connections WHERE id = $1)`,
        [
          input.connectionId,
          this.encrypt(tokens, input.tenantId, input.siteId),
          this.#keyVersion,
          new Date(tokens.expiresAt),
          now,
        ],
      );
      await client.query(
        `UPDATE integration_connections
            SET status = 'connected', last_synced_at = $2, token_expires_at = $3,
                refresh_failure_code = NULL,
                sync_cursor = $4::jsonb, updated_at = $2
          WHERE id = $1`,
        [
          input.connectionId,
          now,
          new Date(tokens.expiresAt),
          JSON.stringify({ endDate: input.endDate, startDate: input.startDate }),
        ],
      );
      return inserted;
    });
  }

  private async connectProperty(
    actor: AdminActor,
    input: {
      credentialId: string;
      property: GoogleProperty;
      scopes: readonly string[];
      siteId: string;
      tenantId: string;
    },
    existingClient?: TenantTransactionClient,
  ): Promise<unknown> {
    const operation = async (client: TenantTransactionClient) => {
      const now = this.#now();
      const connection = required(
        (
          await query<{ id: string }>(
            client,
            `INSERT INTO integration_connections
               (tenant_id, site_id, provider, property_kind, property_id, property_mapping,
                credential_ref, scopes, status, permissions_provenance,
                consented_by, consented_at, token_expires_at)
             VALUES ($1, $2, 'google', $3, $4, $5,
                     (SELECT id::text FROM integration_credentials WHERE id = $6::uuid),
                     $7::jsonb, 'connected',
                     $8::jsonb, $9, $10,
                     (SELECT expires_at FROM integration_credentials WHERE id = $6::uuid))
             ON CONFLICT (tenant_id, site_id, provider, property_kind) DO UPDATE
               SET property_id = EXCLUDED.property_id,
                   property_mapping = EXCLUDED.property_mapping,
                   credential_ref = EXCLUDED.credential_ref,
                   scopes = EXCLUDED.scopes,
                   status = 'connected',
                   permissions_provenance = EXCLUDED.permissions_provenance,
                   consented_by = EXCLUDED.consented_by,
                   consented_at = EXCLUDED.consented_at,
                   token_expires_at = EXCLUDED.token_expires_at,
                   disconnected_at = NULL, collection_stopped_at = NULL,
                   refresh_failure_code = NULL, updated_at = EXCLUDED.consented_at
             RETURNING id`,
            [
              input.tenantId,
              input.siteId,
              input.property.kind,
              input.property.id,
              input.property.siteUrl,
              input.credentialId,
              JSON.stringify(input.scopes),
              JSON.stringify({
                actorId: actor.id,
                consentedAt: now.toISOString(),
                method: 'oauth-pkce',
              }),
              actor.id,
              now,
            ],
          )
        ).rows,
        'Google connection could not be saved',
      );
      await client.query(
        `INSERT INTO schedules
           (tenant_id, site_id, category, timezone, local_hour, local_minute,
            jitter_minutes, enabled, next_attempt_at)
         VALUES ($1, $2, 'metrics_sync', 'Etc/UTC', 4, 0, 30, true, $3)
         ON CONFLICT (tenant_id, site_id, category) DO UPDATE
           SET enabled = true,
               next_attempt_at = LEAST(schedules.next_attempt_at, EXCLUDED.next_attempt_at),
               updated_at = EXCLUDED.next_attempt_at`,
        [input.tenantId, input.siteId, now],
      );
      await audit(client, actor, {
        action: 'integration.google.connected',
        metadata: {
          propertyId: input.property.id,
          propertyKind: input.property.kind,
          scopes: input.scopes,
        },
        siteId: input.siteId,
        targetId: connection.id,
        tenantId: input.tenantId,
      });
      return { connectionId: connection.id, siteId: input.siteId, status: 'connected' };
    };
    return existingClient
      ? operation(existingClient)
      : withPlatformTransaction(this.pool, { actorId: actor.id }, operation);
  }

  private async publicHostname(
    actor: AdminActor,
    tenantId: string,
    siteId: string,
  ): Promise<string> {
    return withPlatformTransaction(
      this.pool,
      { actorId: actor.id },
      async (client) =>
        required(
          (
            await query<{ hostname: string }>(
              client,
              `SELECT hostname FROM domains
              WHERE tenant_id = $1 AND site_id = $2 AND kind = 'public'
                AND active AND verification_status = 'verified' LIMIT 2`,
              [tenantId, siteId],
            )
          ).rows,
          'Verified public hostname was not found',
        ).hostname,
    );
  }

  private storeCredential(
    actor: AdminActor,
    tenantId: string,
    siteId: string,
    tokens: GoogleTokenSet,
  ): Promise<string> {
    return withPlatformTransaction(
      this.pool,
      { actorId: actor.id },
      async (client) =>
        required(
          (
            await query<{ id: string }>(
              client,
              `INSERT INTO integration_credentials
               (tenant_id, site_id, provider, encrypted_payload, key_version, expires_at)
             VALUES ($1, $2, 'google', $3, $4, $5) RETURNING id`,
              [
                tenantId,
                siteId,
                this.encrypt(tokens, tenantId, siteId),
                this.#keyVersion,
                new Date(tokens.expiresAt),
              ],
            )
          ).rows,
          'Google credential could not be saved',
        ).id,
    );
  }

  private async withWorkerSite<T>(
    scope: { siteId: string; tenantId: string },
    operation: (client: TenantTransactionClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE omnireach_worker');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [scope.tenantId]);
      await client.query(`SELECT set_config('app.site_id', $1, true)`, [scope.siteId]);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private encrypt(value: unknown, tenantId: string, siteId: string): Uint8Array {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#encryptionKey, iv);
    cipher.setAAD(Buffer.from(`${tenantId}\0${siteId}\0google-v1`));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([Buffer.from('ORGI1'), iv, cipher.getAuthTag(), ciphertext]);
  }

  private decrypt<T>(value: Uint8Array, tenantId: string, siteId: string, keyVersion: number): T {
    if (keyVersion !== this.#keyVersion)
      throw new Error('Unavailable Google integration key version');
    const payload = Buffer.from(value);
    if (payload.subarray(0, 5).toString() !== 'ORGI1')
      throw new Error('Invalid Google integration envelope');
    const decipher = createDecipheriv('aes-256-gcm', this.#encryptionKey, payload.subarray(5, 17));
    decipher.setAAD(Buffer.from(`${tenantId}\0${siteId}\0google-v1`));
    decipher.setAuthTag(payload.subarray(17, 33));
    return JSON.parse(
      Buffer.concat([decipher.update(payload.subarray(33)), decipher.final()]).toString('utf8'),
    ) as T;
  }
}

export class GoogleIntegrationCallbackError extends Error {
  override readonly name = 'GoogleIntegrationCallbackError';

  constructor(
    readonly code: string,
    readonly siteId: string,
    readonly stage: GoogleCallbackStage,
    override readonly cause: unknown,
  ) {
    super(`Google integration callback failed: ${code}`);
  }
}

export type GoogleCallbackStage =
  | 'connect_property'
  | 'decrypt_state'
  | 'exchange_code'
  | 'list_properties'
  | 'resolve_site_hostname'
  | 'store_credential'
  | 'validate_callback'
  | 'validate_scopes';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function freshness(value: unknown, now: Date): 'current' | 'delayed' | 'stale' | 'unknown' {
  if (!(value instanceof Date)) return 'unknown';
  const age = now.getTime() - value.getTime();
  if (age <= 36 * 60 * 60_000) return 'current';
  if (age <= 7 * 24 * 60 * 60_000) return 'delayed';
  return 'stale';
}

function required<T>(rows: T[], message: string): T {
  if (rows.length !== 1 || !rows[0]) throw new Error(message);
  return rows[0];
}

function scopesFor(kind: GoogleProperty['kind']): readonly string[] {
  return kind === 'ga4'
    ? ['https://www.googleapis.com/auth/analytics.readonly']
    : ['https://www.googleapis.com/auth/webmasters.readonly'];
}

function assertScopes(scopes: readonly string[], kind: GoogleProperty['kind']): void {
  const requiredScope = scopesFor(kind)[0];
  if (!requiredScope || !scopes.includes(requiredScope)) {
    throw new GoogleProviderError('insufficient_scope', false);
  }
}

async function audit(
  client: TenantTransactionClient,
  actor: AdminActor,
  input: { action: string; metadata: unknown; siteId: string; targetId: string; tenantId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (tenant_id, site_id, actor_id, action, trace_id, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5, 'integration_connection', $6, $7::jsonb)`,
    [
      input.tenantId,
      input.siteId,
      actor.id,
      input.action,
      actor.traceId,
      input.targetId,
      JSON.stringify(input.metadata),
    ],
  );
}

async function query<T extends Record<string, unknown>>(
  client: TenantTransactionClient,
  text: string,
  values: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}
