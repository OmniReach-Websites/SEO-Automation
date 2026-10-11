import { PostgresPublicationState, type PublishRequest } from '@omnireach/worker-publisher';
import type { TenantTransactionPool } from '@omnireach/tenant';
import { describe, expect, it, vi } from 'vitest';

const request: PublishRequest = {
  actorId: '40000000-0000-4000-8000-000000000001',
  contentRevision: 2,
  editorPublishGrant: false,
  idempotencyKey: 'publish-1',
  origin: 'customer',
  reason: 'Approved fictional update',
  role: 'customer_owner',
  siteId: '20000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000001',
  traceId: 'trace-publication-1',
};

describe('PostgreSQL publication state', () => {
  it('uses a tenant-and-site advisory lock and releases its dedicated connection once', async () => {
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      return text.includes('pg_try_advisory_lock') ? { rows: [{ acquired: true }] } : { rows: [] };
    });
    const release = vi.fn();
    const pool: TenantTransactionPool = {
      connect: vi.fn(async () => ({ query, release })),
    };
    const artifacts = {
      activeHash: vi.fn(),
      activate: vi.fn(),
      artifactPath: vi.fn(),
      restoreActive: vi.fn(),
    } as never;
    const state = new PostgresPublicationState(pool, artifacts);
    const unlock = await state.lock(request);
    expect(unlock).not.toBe(false);
    expect(query.mock.calls[0]?.[1]).toEqual([`${request.tenantId}:${request.siteId}:publication`]);
    if (!unlock) throw new Error('Expected publication lock');
    await unlock();
    await unlock();
    expect(query.mock.calls.filter(([text]) => text.includes('pg_advisory_unlock'))).toHaveLength(
      1,
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it('looks up idempotency only inside the transaction-scoped tenant and site', async () => {
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      if (text.includes('FROM publication_requests')) {
        expect(values).toEqual([request.tenantId, request.siteId, request.idempotencyKey]);
        return {
          rows: [
            {
              artifact_hash: 'a'.repeat(64),
              idempotency_key: request.idempotencyKey,
              previous_artifact_hash: null,
              status: 'published',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const pool: TenantTransactionPool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };
    const state = new PostgresPublicationState(pool, {} as never);
    await expect(state.findResult(request)).resolves.toEqual({
      artifactHash: 'a'.repeat(64),
      requestKey: request.idempotencyKey,
      status: 'published',
    });
    expect(query.mock.calls.slice(0, 5).map(([text]) => text)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE omnireach_app',
      `SELECT set_config('app.tenant_id', $1, true)`,
      `SELECT set_config('app.site_id', $1, true)`,
      `SELECT set_config('app.user_id', $1, true)`,
    ]);
  });

  it('revalidates the actor role and editor grant at execution time', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('WITH latest_feature')) {
        return {
          rows: [
            {
              editing_frozen: false,
              feature_enabled: true,
              grace_ends_at: null,
              subscription_status: 'active',
            },
          ],
        };
      }
      if (text.includes('CROSS JOIN LATERAL')) {
        return { rows: [{ editor_publish_grant: false, role: 'customer_owner' }] };
      }
      return { rows: [] };
    });
    const pool: TenantTransactionPool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };
    const state = new PostgresPublicationState(pool, {} as never);
    await expect(state.revalidate(request)).resolves.toBeUndefined();
    await expect(state.revalidate({ ...request, role: 'customer_editor' })).rejects.toThrow(
      'no longer eligible',
    );
  });
});
