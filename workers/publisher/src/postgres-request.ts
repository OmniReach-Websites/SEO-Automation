import {
  withWorkerTransaction,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';

import type { PublishRequest } from './publication.ts';

export class PostgresPublicationRequestRepository {
  constructor(private readonly pool: TenantTransactionPool) {}

  async load(input: {
    idempotencyKey: string;
    siteId: string;
    tenantId: string;
    traceId: string;
  }): Promise<PublishRequest> {
    return withWorkerTransaction(
      this.pool,
      {
        jobId: `publish:${input.idempotencyKey}`,
        siteId: input.siteId,
        tenantId: input.tenantId,
      },
      async (client) => {
        const request = (
          await query<{
            content_revision: number;
            idempotency_key: string;
            origin: 'customer' | 'orap' | 'restore';
            reason: string;
            requested_by: string;
            status: 'building' | 'queued';
          }>(
            client,
            `SELECT requested_by, origin, reason, content_revision, idempotency_key, status
               FROM publication_requests
              WHERE tenant_id = $1 AND site_id = $2 AND idempotency_key = $3
                AND status IN ('queued', 'building')`,
            [input.tenantId, input.siteId, input.idempotencyKey],
          )
        ).rows[0];
        if (!request) throw new Error('Queued publication request is unavailable');

        await client.query(`SELECT set_config('app.user_id', $1, true)`, [request.requested_by]);
        const authorization = (
          await query<{
            editor_publish_grant: boolean;
            role: string;
          }>(
            client,
            `SELECT role, editor_publish_grant
               FROM (
                 SELECT m.role,
                        COALESCE((m.permissions ->> 'content.publish')::boolean, false)
                          AS editor_publish_grant
                   FROM memberships m
                  WHERE m.tenant_id = $1 AND m.site_id = $2 AND m.user_id = $3 AND m.active
                 UNION ALL
                 SELECT pm.role, false AS editor_publish_grant
                   FROM platform_memberships pm
                  WHERE pm.user_id = $3 AND pm.active
               ) actor_roles
              WHERE role IN (
                'platform_owner', 'platform_admin', 'staff',
                'customer_owner', 'customer_editor'
              )
              LIMIT 2`,
            [input.tenantId, input.siteId, request.requested_by],
          )
        ).rows;
        if (authorization.length !== 1) {
          throw new Error('Publication actor is no longer authorized');
        }
        return {
          actorId: request.requested_by,
          contentRevision: request.content_revision,
          editorPublishGrant: authorization[0]?.editor_publish_grant ?? false,
          idempotencyKey: request.idempotency_key,
          origin: request.origin,
          reason: request.reason,
          role: authorization[0]?.role ?? '',
          siteId: input.siteId,
          tenantId: input.tenantId,
          traceId: input.traceId,
        };
      },
    );
  }
}

async function query<T extends Record<string, unknown>>(
  client: TenantTransactionClient,
  text: string,
  values: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}
