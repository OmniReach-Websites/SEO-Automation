import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { GoogleCollectionResult, GoogleProviderClient } from '@omnireach/integrations';
import type { TenantTransactionClient } from '@omnireach/tenant';
import { describe, expect, it, vi } from 'vitest';

import { PostgresGoogleIntegrationService } from '../../apps/api/src/postgres-google.ts';

describe('Google metric observation identity', () => {
  it('migrates duplicate observations by natural identity without treating value as identity', () => {
    const migration = readFileSync(
      resolve(
        import.meta.dirname,
        '../../packages/database/prisma/migrations/20261013170000_google_metric_observation_identity/migration.sql',
      ),
      'utf8',
    );
    const digestExpression = migration.match(/digest\(([\s\S]*?),\s*'sha256'/u)?.[1] ?? '';

    expect(migration).toContain(
      'PARTITION BY connection_id, source, metric, dimensions, window_start, window_end',
    );
    expect(digestExpression).toContain('connection_id::text');
    expect(digestExpression).toContain('dimensions::text');
    expect(digestExpression).not.toMatch(/\bvalue\b/u);
  });

  it('upserts corrected values and reports an update separately from a new insert', async () => {
    const calls: { sql: string; values?: unknown[] }[] = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, ...(values ? { values } : {}) });
        return sql.includes('INSERT INTO metric_snapshots')
          ? { rows: [{ id: '70000000-0000-4000-8000-000000000001', inserted: false }] }
          : { rows: [] };
      }),
      release: vi.fn(),
    } as unknown as TenantTransactionClient & { release(): void };
    const service = new PostgresGoogleIntegrationService(
      { connect: vi.fn(async () => client) },
      {
        allowedRedirectUris: ['https://admin.omnireach.test/v1/orap/integrations/google/callback'],
        encryptionKeyHex: '11'.repeat(32),
        provider: {} as GoogleProviderClient,
      },
    );
    const persist = service as unknown as {
      persistMetrics(
        input: {
          connectionId: string;
          endDate: string;
          siteId: string;
          startDate: string;
          tenantId: string;
        },
        collection: GoogleCollectionResult,
        tokens: { accessToken: string; expiresAt: string; refreshToken: string; scopes: string[] },
        now: Date,
      ): Promise<number>;
    };
    const now = new Date('2026-10-13T05:00:00.000Z');

    await expect(
      persist.persistMetrics(
        {
          connectionId: '70000000-0000-4000-8000-000000000001',
          endDate: '2026-10-12',
          siteId: '20000000-0000-4000-8000-000000000001',
          startDate: '2026-10-06',
          tenantId: '10000000-0000-4000-8000-000000000001',
        },
        {
          complete: true,
          diagnostics: [
            {
              complete: true,
              dataset: 'search_console_query',
              pageCount: 1,
              rows: 1,
              totalRows: null,
            },
          ],
          points: [
            {
              dimensions: { aggregation: 'query', query: 'fixture' },
              endDate: '2026-10-12',
              metric: 'clicks',
              propertyId: 'sc-domain:example.test',
              source: 'search_console',
              startDate: '2026-10-12',
              value: 12,
            },
          ],
        },
        {
          accessToken: 'fixture-access-token',
          expiresAt: '2026-10-14T05:00:00.000Z',
          refreshToken: 'fixture-refresh-token',
          scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
        },
        now,
      ),
    ).resolves.toBe(0);

    const insert = calls.find(({ sql }) => sql.includes('INSERT INTO metric_snapshots'));
    expect(insert?.sql).toContain('ON CONFLICT (connection_id, source_hash) DO UPDATE');
    expect(insert?.sql).toContain('metric_snapshots.value IS DISTINCT FROM EXCLUDED.value');
    expect(insert?.sql).toContain('RETURNING id, (xmax = 0) AS inserted');
    expect(insert?.values).toHaveLength(11);
    expect(insert?.values?.[8]).toBe(12);
    expect(insert?.values?.[9]).toEqual(now);
  });
});
