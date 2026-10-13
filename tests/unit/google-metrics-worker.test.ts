import { randomUUID } from 'node:crypto';

import type { GoogleProviderClient } from '@omnireach/integrations';
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

  it('rehydrates only the envelope tenant/site and succeeds truthfully with no connections', async () => {
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
    ).resolves.toEqual({ connections: 0, inserted: 0 });
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
});
