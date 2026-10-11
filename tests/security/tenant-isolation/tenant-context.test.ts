import {
  HostResolutionError,
  normalizeHostname,
  resolveCustomerContext,
  withAuthTransaction,
  withPlatformTransaction,
  withTenantTransaction,
  withWorkerTransaction,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';
import { describe, expect, it, vi } from 'vitest';

describe('tenant isolation boundaries', () => {
  it('normalizes exact hosts, ports, trailing dots, and IDNs', () => {
    expect(normalizeHostname('ADMIN.Example.TEST:443')).toBe('admin.example.test');
    expect(normalizeHostname('admin.example.test.')).toBe('admin.example.test');
    expect(normalizeHostname('bücher.example')).toBe('xn--bcher-kva.example');
    expect(() => normalizeHostname('admin.example.test/path')).toThrow(HostResolutionError);
    expect(() => normalizeHostname('user@admin.example.test')).toThrow(HostResolutionError);
  });

  it('requires one active verified admin domain and exact active site membership', async () => {
    const repository = {
      findDomain: vi.fn(async (host: string) =>
        host === 'admin.alpha.test'
          ? {
              active: true,
              hostname: host,
              kind: 'admin' as const,
              siteId: 'site-a',
              tenantId: 'tenant-a',
              verificationStatus: 'verified' as const,
            }
          : undefined,
      ),
      findMembership: vi.fn(async ({ siteId, userId }: { siteId: string; userId: string }) =>
        siteId === 'site-a' && userId === 'user-a'
          ? { active: true, role: 'customer_owner', siteId, tenantId: 'tenant-a', userId }
          : undefined,
      ),
    };
    await expect(
      resolveCustomerContext('admin.alpha.test', 'user-a', repository),
    ).resolves.toMatchObject({
      siteId: 'site-a',
      tenantId: 'tenant-a',
    });
    await expect(resolveCustomerContext('admin.alpha.test', 'user-b', repository)).rejects.toThrow(
      'Site context unavailable',
    );
    await expect(resolveCustomerContext('admin.beta.test', 'user-a', repository)).rejects.toThrow(
      'Site context unavailable',
    );
  });

  it('sets transaction-local context on every pooled transaction and always releases', async () => {
    const queries: { query: string; values?: unknown[] }[] = [];
    const client: TenantTransactionClient & { release(): void } = {
      query: vi.fn(async (query: string, values?: unknown[]) => {
        queries.push(values ? { query, values } : { query });
      }),
      release: vi.fn(),
    };
    const pool: TenantTransactionPool = { connect: vi.fn(async () => client) };
    await withTenantTransaction(
      pool,
      { siteId: 'site-a', tenantId: 'tenant-a', userId: 'user-a' },
      async () => 'ok',
    );
    expect(queries.map(({ query }) => query)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE omnireach_app',
      `SELECT set_config('app.tenant_id', $1, true)`,
      `SELECT set_config('app.site_id', $1, true)`,
      `SELECT set_config('app.user_id', $1, true)`,
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('uses a separate transaction-local platform actor context for ORAP operations', async () => {
    const queries: { query: string; values?: unknown[] }[] = [];
    const client: TenantTransactionClient & { release(): void } = {
      query: vi.fn(async (query: string, values?: unknown[]) => {
        queries.push(values ? { query, values } : { query });
      }),
      release: vi.fn(),
    };
    const pool: TenantTransactionPool = { connect: vi.fn(async () => client) };
    await withPlatformTransaction(pool, { actorId: 'staff-a' }, async () => 'ok');
    expect(queries).toEqual([
      { query: 'BEGIN' },
      { query: 'SET LOCAL ROLE omnireach_platform' },
      {
        query: `SELECT set_config('app.platform_actor_id', $1, true)`,
        values: ['staff-a'],
      },
      { query: 'COMMIT' },
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('uses the restricted authentication role for global session resolution', async () => {
    const queries: string[] = [];
    const client: TenantTransactionClient & { release(): void } = {
      query: vi.fn(async (query: string) => void queries.push(query)),
      release: vi.fn(),
    };
    const pool: TenantTransactionPool = { connect: vi.fn(async () => client) };
    await withAuthTransaction(pool, async () => 'ok');
    expect(queries).toEqual(['BEGIN', 'SET LOCAL ROLE omnireach_auth', 'COMMIT']);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('sets isolated tenant/site/job context for worker transactions', async () => {
    const queries: { query: string; values?: unknown[] }[] = [];
    const client: TenantTransactionClient & { release(): void } = {
      query: vi.fn(async (query: string, values?: unknown[]) => {
        queries.push(values ? { query, values } : { query });
      }),
      release: vi.fn(),
    };
    const pool: TenantTransactionPool = { connect: vi.fn(async () => client) };
    await withWorkerTransaction(
      pool,
      { jobId: 'job-a', siteId: 'site-a', tenantId: 'tenant-a' },
      async () => 'ok',
    );
    expect(queries).toEqual([
      { query: 'BEGIN' },
      { query: 'SET LOCAL ROLE omnireach_worker' },
      { query: `SELECT set_config('app.tenant_id', $1, true)`, values: ['tenant-a'] },
      { query: `SELECT set_config('app.site_id', $1, true)`, values: ['site-a'] },
      { query: `SELECT set_config('app.job_id', $1, true)`, values: ['job-a'] },
      { query: 'COMMIT' },
    ]);
  });
});
