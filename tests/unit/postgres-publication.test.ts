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

  it('preserves the publication trace when the compatibility path admits a request', async () => {
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.includes('INSERT INTO publication_requests'))
        return { rows: [{ id: 'request-id' }] };
      return { rows: [] };
    });
    const state = new PostgresPublicationState(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      {} as never,
    );

    await expect(state.begin(request, undefined)).resolves.toBeUndefined();
    const publicationInsert = query.mock.calls.find(([text]) =>
      text.includes('INSERT INTO publication_requests'),
    );
    expect(publicationInsert?.[0]).toContain('trace_id');
    expect(publicationInsert?.[1]?.[8]).toBe(request.traceId);
    expect(query.mock.calls.some(([text]) => text.includes('INSERT INTO jobs'))).toBe(false);
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
    const revalidationSql = query.mock.calls.find(([text]) =>
      text.includes('CROSS JOIN LATERAL'),
    )?.[0];
    expect(revalidationSql).toContain('artifact.content_revision > $3');
    expect(revalidationSql).toContain('newer.content_revision > $3');
    await expect(state.revalidate({ ...request, role: 'customer_editor' })).rejects.toThrow(
      'no longer eligible',
    );
  });

  it('restores the file pointer and rejects an out-of-order activation older than live content', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('SELECT id, content_revision FROM build_artifacts')) {
        return { rows: [{ content_revision: 2, id: 'artifact-two' }] };
      }
      if (text.includes('SELECT artifact.content_revision')) {
        return { rows: [{ content_revision: 3 }] };
      }
      return { rows: [] };
    });
    const pool: TenantTransactionPool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };
    const artifacts = {
      activeHash: vi.fn(async () => 'newer-active-hash'),
      activate: vi.fn(async () => undefined),
      artifactPath: vi.fn(),
      restoreActive: vi.fn(async () => undefined),
    } as never;
    const state = new PostgresPublicationState(pool, artifacts);

    await expect(state.activate(request, 'candidate-hash')).rejects.toThrow(
      'older than the active artifact',
    );
    expect((artifacts as { activate: ReturnType<typeof vi.fn> }).activate).toHaveBeenCalledWith(
      request.siteId,
      'candidate-hash',
    );
    expect(
      (artifacts as { restoreActive: ReturnType<typeof vi.fn> }).restoreActive,
    ).toHaveBeenCalledWith(request.siteId, 'newer-active-hash');
    expect(query.mock.calls.some(([text]) => text.includes('INSERT INTO active_artifacts'))).toBe(
      false,
    );
  });
});
