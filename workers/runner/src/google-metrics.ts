import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import {
  GoogleHttpProvider,
  GoogleProviderError,
  type GoogleMetricPoint,
  type GoogleProperty,
  type GoogleProviderClient,
  type GoogleTokenSet,
} from '@omnireach/integrations';
import { JobExecutionError, type JobEnvelope } from '@omnireach/queue';
import {
  withWorkerTransaction,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';

interface ConnectionRow extends Record<string, unknown> {
  encrypted_payload: Uint8Array;
  id: string;
  key_version: number;
  property_id: string;
  property_kind: GoogleProperty['kind'];
  property_mapping: string;
}

export async function runGoogleMetricsSync(
  envelope: JobEnvelope,
  input: {
    environment: NodeJS.ProcessEnv;
    jobId: string;
    now?: Date;
    pool: TenantTransactionPool;
    provider?: GoogleProviderClient;
  },
): Promise<{ connections: number; inserted: number }> {
  if (input.environment.GOOGLE_INTEGRATION_ENABLED !== 'true') {
    throw new JobExecutionError('Google metric collection is disabled by policy', 'cancelled');
  }
  const clientId = requiredEnvironment(input.environment, 'GOOGLE_CLIENT_ID');
  const clientSecret = requiredEnvironment(input.environment, 'GOOGLE_CLIENT_SECRET');
  const keyHex = requiredEnvironment(input.environment, 'GOOGLE_TOKEN_ENCRYPTION_KEY');
  if (!/^[a-f0-9]{64}$/iu.test(keyHex)) {
    throw new JobExecutionError('Google token key configuration is invalid', 'permanent');
  }
  const provider = input.provider ?? new GoogleHttpProvider({ clientId, clientSecret });
  const now = input.now ?? new Date();
  const connections = await workerTransaction(input.pool, envelope, input.jobId, async (client) =>
    query<ConnectionRow>(
      client,
      `SELECT connection.id, connection.property_kind, connection.property_id,
              connection.property_mapping, credential.encrypted_payload, credential.key_version
         FROM integration_connections connection
         JOIN integration_credentials credential
           ON credential.id::text = connection.credential_ref
          AND credential.tenant_id = connection.tenant_id
          AND credential.site_id = connection.site_id
        WHERE connection.tenant_id = $1 AND connection.site_id = $2
          AND connection.provider = 'google' AND connection.status = 'connected'
          AND connection.collection_stopped_at IS NULL AND credential.revoked_at IS NULL
        ORDER BY connection.property_kind, connection.id`,
      [envelope.tenantId, envelope.siteId],
    ).then(({ rows }) => rows),
  );
  let inserted = 0;
  for (const connection of connections) {
    try {
      let tokens = decryptTokens(
        connection.encrypted_payload,
        envelope.tenantId,
        envelope.siteId,
        connection.key_version,
        keyHex,
      );
      if (new Date(tokens.expiresAt).getTime() <= now.getTime() + 60_000) {
        tokens = await provider.refresh(tokens);
      }
      const endDate = isoDate(new Date(now.getTime() - 24 * 60 * 60_000));
      const startDate = isoDate(new Date(now.getTime() - 8 * 24 * 60 * 60_000));
      const points = await provider.collect({
        endDate,
        property: {
          id: connection.property_id,
          kind: connection.property_kind,
          siteUrl: connection.property_mapping,
        },
        startDate,
        tokens,
      });
      inserted += await persistMetrics(
        input.pool,
        envelope,
        input.jobId,
        connection.id,
        points,
        tokens,
        { endDate, keyHex, now, startDate },
      );
    } catch (error) {
      const providerError = error instanceof GoogleProviderError ? error : undefined;
      const code = providerError?.code ?? 'collection_failed';
      await workerTransaction(input.pool, envelope, input.jobId, (client) =>
        client.query(
          `UPDATE integration_connections
              SET status = CASE WHEN $2 IN ('revoked_or_expired','missing_refresh_token')
                                THEN 'expired' ELSE 'error' END,
                  refresh_failure_code = $2, updated_at = $3
            WHERE tenant_id = $4 AND site_id = $5 AND id = $1`,
          [connection.id, code, now, envelope.tenantId, envelope.siteId],
        ),
      );
      throw new JobExecutionError(
        'Google metric collection failed',
        providerError?.retryable ? 'retryable' : 'permanent',
      );
    }
  }
  return { connections: connections.length, inserted };
}

async function persistMetrics(
  pool: TenantTransactionPool,
  envelope: JobEnvelope,
  jobId: string,
  connectionId: string,
  points: readonly GoogleMetricPoint[],
  tokens: GoogleTokenSet,
  input: { endDate: string; keyHex: string; now: Date; startDate: string },
): Promise<number> {
  return workerTransaction(pool, envelope, jobId, async (client) => {
    let inserted = 0;
    for (const point of points) {
      const result = await query<{ id: string }>(
        client,
        `INSERT INTO metric_snapshots
           (tenant_id, site_id, connection_id, source, metric, dimensions,
            window_start, window_end, value, source_hash, ingested_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (connection_id, source_hash) DO NOTHING RETURNING id`,
        [
          envelope.tenantId,
          envelope.siteId,
          connectionId,
          point.source,
          point.metric,
          JSON.stringify(point.dimensions),
          `${point.startDate}T00:00:00Z`,
          `${point.endDate}T23:59:59.999Z`,
          point.value,
          pointHash(point),
          input.now,
          new Date(input.now.getTime() + 18 * 30 * 24 * 60 * 60_000),
        ],
      );
      inserted += result.rows.length;
    }
    await client.query(
      `UPDATE integration_credentials credential
          SET encrypted_payload = $2, key_version = 1, expires_at = $3, updated_at = $4
         FROM integration_connections connection
        WHERE connection.id = $1 AND connection.tenant_id = $5 AND connection.site_id = $6
          AND credential.id::text = connection.credential_ref
          AND credential.tenant_id = connection.tenant_id
          AND credential.site_id = connection.site_id`,
      [
        connectionId,
        encryptTokens(tokens, envelope.tenantId, envelope.siteId, input.keyHex),
        new Date(tokens.expiresAt),
        input.now,
        envelope.tenantId,
        envelope.siteId,
      ],
    );
    await client.query(
      `UPDATE integration_connections
          SET status = 'connected', last_synced_at = $2, token_expires_at = $3,
              refresh_failure_code = NULL, sync_cursor = $4::jsonb, updated_at = $2
        WHERE id = $1 AND tenant_id = $5 AND site_id = $6`,
      [
        connectionId,
        input.now,
        new Date(tokens.expiresAt),
        JSON.stringify({ endDate: input.endDate, startDate: input.startDate }),
        envelope.tenantId,
        envelope.siteId,
      ],
    );
    return inserted;
  });
}

function encryptTokens(
  tokens: GoogleTokenSet,
  tenantId: string,
  siteId: string,
  keyHex: string,
): Uint8Array {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  cipher.setAAD(Buffer.from(`${tenantId}\0${siteId}\0google-v1`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('ORGI1'), iv, cipher.getAuthTag(), ciphertext]);
}

function decryptTokens(
  value: Uint8Array,
  tenantId: string,
  siteId: string,
  keyVersion: number,
  keyHex: string,
): GoogleTokenSet {
  if (keyVersion !== 1) throw new Error('Unavailable Google integration key version');
  const payload = Buffer.from(value);
  if (payload.subarray(0, 5).toString() !== 'ORGI1')
    throw new Error('Invalid Google token envelope');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyHex, 'hex'),
    payload.subarray(5, 17),
  );
  decipher.setAAD(Buffer.from(`${tenantId}\0${siteId}\0google-v1`));
  decipher.setAuthTag(payload.subarray(17, 33));
  return JSON.parse(
    Buffer.concat([decipher.update(payload.subarray(33)), decipher.final()]).toString('utf8'),
  ) as GoogleTokenSet;
}

function pointHash(point: GoogleMetricPoint): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        dimensions: Object.fromEntries(
          Object.entries(point.dimensions).sort(([left], [right]) => left.localeCompare(right)),
        ),
        endDate: point.endDate,
        metric: point.metric,
        propertyId: point.propertyId,
        source: point.source,
        startDate: point.startDate,
        value: point.value,
      }),
    )
    .digest('hex');
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new JobExecutionError(`${name} is required for Google collection`, 'permanent');
  return value;
}

function workerTransaction<T>(
  pool: TenantTransactionPool,
  envelope: JobEnvelope,
  jobId: string,
  operation: (client: TenantTransactionClient) => Promise<T>,
): Promise<T> {
  return withWorkerTransaction(
    pool,
    { jobId, siteId: envelope.siteId, tenantId: envelope.tenantId },
    operation,
  );
}

async function query<T extends Record<string, unknown>>(
  client: TenantTransactionClient,
  text: string,
  values: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}
