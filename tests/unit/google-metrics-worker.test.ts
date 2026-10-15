import { createCipheriv, randomUUID } from 'node:crypto';

import { GoogleProviderError, type GoogleProviderClient } from '@omnireach/integrations';
import { createJobEnvelope } from '@omnireach/queue';
import { describe, expect, it, vi } from 'vitest';

import { runGoogleMetricsSync } from '../../workers/runner/src/google-metrics.ts';

const envelope = createJobEnvelope({
  attemptLimit: 3,
  category: 'metrics_sync',
  dedupeKey: 'fixture-window',
  expiresAt: '2026-10-14T00:00:00.000Z',
  recordId: randomUUID(),
  siteId: randomUUID(),
  tenantId: randomUUID(),
  timeoutMs: 60_000,
});

const keyHex = 'ab'.repeat(32);

function encryptedTokens(): Buffer {
  const iv = Buffer.alloc(12, 1);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  cipher.setAAD(Buffer.from(`${envelope.tenantId}\0${envelope.siteId}\0google-v1`));
  const ciphertext = Buffer.concat([
    cipher.update(
      JSON.stringify({
        accessToken: 'fixture-access',
        expiresAt: '2026-10-20T00:00:00.000Z',
        refreshToken: 'fixture-refresh',
        scopes: ['fixture-scope'],
      }),
      'utf8',
    ),
    cipher.final(),
  ]);
  return Buffer.concat([Buffer.from('ORGI1'), iv, cipher.getAuthTag(), ciphertext]);
}

describe('Google metrics worker', () => {
  it('cancels before touching storage or provider when the centralized gate is off', async () => {
    const connect = vi.fn(async () => {
      throw new Error('must not connect');
    });
    await expect(
      runGoogleMetricsSync(envelope, {
        environment: { GOOGLE_INTEGRATION_ENABLED: 'false' },
        jobId: randomUUID(),
        pool: { connect },
      }),
    ).rejects.toMatchObject({ category: 'cancelled' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('rehydrates only the envelope tenant/site and cancels a stale job with no connections', async () => {
    const calls: { text: string; values?: unknown[] }[] = [];
    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        calls.push({ text, ...(values ? { values } : {}) });
        return { rows: text.includes('FROM integration_connections connection') ? [] : [] };
      }),
      release: vi.fn(),
    };
    const provider = {
      authorizationUrl: vi.fn(),
      collect: vi.fn(),
      exchangeCode: vi.fn(),
      listProperties: vi.fn(),
      refresh: vi.fn(),
      revoke: vi.fn(),
    } as unknown as GoogleProviderClient;
    await expect(
      runGoogleMetricsSync(envelope, {
        environment: {
          GOOGLE_CLIENT_ID: 'fixture-client',
          GOOGLE_CLIENT_SECRET: 'fixture-secret',
          GOOGLE_INTEGRATION_ENABLED: 'true',
          GOOGLE_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
        },
        jobId: randomUUID(),
        pool: { connect: vi.fn(async () => client) },
        provider,
      }),
    ).rejects.toMatchObject({ category: 'cancelled' });
    expect(calls).toContainEqual({
      text: `SELECT set_config('app.tenant_id', $1, true)`,
      values: [envelope.tenantId],
    });
    expect(calls).toContainEqual({
      text: `SELECT set_config('app.site_id', $1, true)`,
      values: [envelope.siteId],
    });
    expect(provider.collect).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('retries recoverable error and partial connections without selecting expired credentials', async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (text: string) => {
        queries.push(text);
        if (text.includes('FROM integration_connections connection')) return { rows: [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    await expect(
      runGoogleMetricsSync(envelope, {
        environment: {
          GOOGLE_CLIENT_ID: 'fixture-client',
          GOOGLE_CLIENT_SECRET: 'fixture-secret',
          GOOGLE_INTEGRATION_ENABLED: 'true',
          GOOGLE_TOKEN_ENCRYPTION_KEY: keyHex,
        },
        jobId: randomUUID(),
        pool: { connect: vi.fn(async () => client) },
        provider: {} as GoogleProviderClient,
      }),
    ).rejects.toMatchObject({ category: 'cancelled' });

    const loadQuery = queries.find((text) => text.includes('FROM integration_connections'));
    expect(loadQuery).toContain("connection.status IN ('connected', 'error', 'partial')");
    expect(loadQuery).not.toContain(
      "connection.status IN ('connected', 'error', 'partial', 'expired')",
    );
  });

  it('persists a bounded partial collection with durable diagnostics', async () => {
    const calls: { text: string; values?: unknown[] }[] = [];
    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        calls.push({ text, ...(values ? { values } : {}) });
        if (text.includes('FROM integration_connections connection')) {
          return {
            rows: [
              {
                encrypted_payload: encryptedTokens(),
                id: '70000000-0000-4000-8000-000000000001',
                key_version: 1,
                property_id: 'properties/123',
                property_kind: 'ga4',
                property_mapping: 'https://fixture.example/',
              },
            ],
          };
        }
        if (text.includes('INSERT INTO metric_snapshots')) {
          return { rows: [{ id: randomUUID(), inserted: true }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const provider = {
      collect: vi.fn(async () => ({
        complete: false,
        diagnostics: [
          {
            complete: false,
            dataset: 'ga4_source_medium' as const,
            pageCount: 4,
            rows: 100_000,
            totalRows: 100_001,
          },
        ],
        points: [
          {
            dimensions: { sessionMedium: 'organic', sessionSource: 'google' },
            endDate: '2026-10-12',
            metric: 'sessions',
            propertyId: 'properties/123',
            source: 'ga4' as const,
            startDate: '2026-10-12',
            value: 3,
          },
        ],
      })),
      refresh: vi.fn(),
    } as unknown as GoogleProviderClient;

    await expect(
      runGoogleMetricsSync(envelope, {
        environment: {
          GOOGLE_CLIENT_ID: 'fixture-client',
          GOOGLE_CLIENT_SECRET: 'fixture-secret',
          GOOGLE_INTEGRATION_ENABLED: 'true',
          GOOGLE_TOKEN_ENCRYPTION_KEY: keyHex,
        },
        jobId: randomUUID(),
        now: new Date('2026-10-13T05:00:00.000Z'),
        pool: { connect: vi.fn(async () => client) },
        provider,
      }),
    ).resolves.toEqual({ connections: 1, inserted: 1, partialConnections: 1 });

    const statusUpdate = calls.find(({ text }) => text.includes('collection_truncated'));
    expect(statusUpdate?.values?.[3]).toEqual(
      expect.stringContaining('"dataset":"ga4_source_medium"'),
    );
    expect(statusUpdate?.values?.[6]).toBe('partial');
    const insert = calls.find(({ text }) => text.includes('INSERT INTO metric_snapshots'));
    expect(insert?.text).toContain('$3::uuid');
    expect(insert?.text).toContain('$3::uuid::text');
    expect(insert?.text).toContain('$4::varchar(40)');
    expect(insert?.text).toContain('$5::varchar(100)');
    expect(insert?.text).toContain('$9::numeric(20,6)');
  });

  it('continues remaining property backfills before surfacing one safe provider failure', async () => {
    const calls: { text: string; values?: unknown[] }[] = [];
    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        calls.push({ text, ...(values ? { values } : {}) });
        if (text.includes('FROM integration_connections connection')) {
          return {
            rows: [
              {
                encrypted_payload: encryptedTokens(),
                id: '70000000-0000-4000-8000-000000000001',
                key_version: 1,
                property_id: 'sc-domain:missing.example',
                property_kind: 'search_console',
                property_mapping: 'sc-domain:missing.example',
              },
              {
                encrypted_payload: encryptedTokens(),
                id: '70000000-0000-4000-8000-000000000002',
                key_version: 1,
                property_id: 'properties/123',
                property_kind: 'ga4',
                property_mapping: 'https://fixture.example/',
              },
            ],
          };
        }
        if (text.includes('INSERT INTO metric_snapshots')) {
          return { rows: [{ id: randomUUID(), inserted: true }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const collect = vi
      .fn()
      .mockRejectedValueOnce(new GoogleProviderError('property_not_found', false, 404))
      .mockResolvedValueOnce({
        complete: true,
        diagnostics: [
          {
            complete: true,
            dataset: 'ga4_source_medium',
            pageCount: 1,
            rows: 1,
            totalRows: 1,
          },
        ],
        points: [
          {
            dimensions: { sessionMedium: 'organic', sessionSource: 'google' },
            endDate: '2026-10-12',
            metric: 'sessions',
            propertyId: 'properties/123',
            source: 'ga4',
            startDate: '2026-10-12',
            value: 3,
          },
        ],
      });
    const provider = { collect, refresh: vi.fn() } as unknown as GoogleProviderClient;

    await expect(
      runGoogleMetricsSync(envelope, {
        environment: {
          GOOGLE_CLIENT_ID: 'fixture-client',
          GOOGLE_CLIENT_SECRET: 'fixture-secret',
          GOOGLE_INTEGRATION_ENABLED: 'true',
          GOOGLE_TOKEN_ENCRYPTION_KEY: keyHex,
        },
        jobId: randomUUID(),
        now: new Date('2026-10-13T05:00:00.000Z'),
        pool: { connect: vi.fn(async () => client) },
        provider,
      }),
    ).rejects.toMatchObject({ category: 'permanent' });

    expect(collect).toHaveBeenCalledTimes(2);
    expect(calls.some(({ text }) => text.includes('INSERT INTO metric_snapshots'))).toBe(true);
    const failureUpdate = calls.find(
      ({ text, values }) =>
        text.includes('refresh_failure_code = $2') && values?.[1] === 'property_not_found',
    );
    expect(failureUpdate).toBeDefined();
  });
});
