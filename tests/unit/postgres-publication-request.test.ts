import { PostgresPublicationRequestRepository } from '@omnireach/worker-publisher';
import type { TenantTransactionPool } from '@omnireach/tenant';
import { describe, expect, it, vi } from 'vitest';

const input = {
  idempotencyKey: 'publish-1',
  siteId: '20000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000001',
  traceId: 'trace-publication-request',
};

describe('PostgreSQL queued publication loader', () => {
  it('loads a tenant-scoped request and derives current authorization from the database', async () => {
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      if (text.includes('SELECT requested_by')) {
        expect(values).toEqual([input.tenantId, input.siteId, input.idempotencyKey]);
        return {
          rows: [
            {
              content_revision: 4,
              idempotency_key: input.idempotencyKey,
              origin: 'customer',
              reason: 'Approved update',
              requested_by: '40000000-0000-4000-8000-000000000001',
              status: 'queued',
            },
          ],
        };
      }
      if (text.includes('FROM memberships m')) {
        return { rows: [{ editor_publish_grant: true, role: 'customer_editor' }] };
      }
      return { rows: [] };
    });
    const pool: TenantTransactionPool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };

    await expect(new PostgresPublicationRequestRepository(pool).load(input)).resolves.toEqual({
      actorId: '40000000-0000-4000-8000-000000000001',
      contentRevision: 4,
      editorPublishGrant: true,
      idempotencyKey: input.idempotencyKey,
      origin: 'customer',
      reason: 'Approved update',
      role: 'customer_editor',
      siteId: input.siteId,
      tenantId: input.tenantId,
      traceId: input.traceId,
    });
    expect(query).toHaveBeenCalledWith(`SELECT set_config('app.user_id', $1, true)`, [
      '40000000-0000-4000-8000-000000000001',
    ]);
  });

  it('loads a revoked actor as unauthorized so orchestration can record the terminal failure', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('SELECT requested_by')) {
        return {
          rows: [
            {
              content_revision: 1,
              idempotency_key: input.idempotencyKey,
              origin: 'customer',
              reason: 'Update',
              requested_by: '40000000-0000-4000-8000-000000000001',
              status: 'queued',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const pool: TenantTransactionPool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };
    await expect(new PostgresPublicationRequestRepository(pool).load(input)).resolves.toEqual({
      actorId: '40000000-0000-4000-8000-000000000001',
      contentRevision: 1,
      editorPublishGrant: false,
      idempotencyKey: input.idempotencyKey,
      origin: 'customer',
      reason: 'Update',
      role: '',
      siteId: input.siteId,
      tenantId: input.tenantId,
      traceId: input.traceId,
    });
    expect(query).toHaveBeenCalledWith('COMMIT');
  });
});
