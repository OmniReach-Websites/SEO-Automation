import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import {
  assertSiteFeatureEnabled,
  withTenantTransaction,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';

import type { LocalArtifactStore } from './artifacts.ts';
import type { PublicationDependencies, PublishRequest, PublishResult } from './publication.ts';

export type PublicationStateDependencies = Omit<PublicationDependencies, 'build'>;

export class PostgresPublicationState implements PublicationStateDependencies {
  constructor(
    private readonly pool: TenantTransactionPool,
    private readonly artifacts: LocalArtifactStore,
  ) {}

  async lock(request: PublishRequest): Promise<false | (() => Promise<void>)> {
    const client = await this.pool.connect();
    const key = `${request.tenantId}:${request.siteId}:publication`;
    try {
      const result = (await client.query(
        `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired`,
        [key],
      )) as { rows: { acquired: boolean }[] };
      if (!result.rows[0]?.acquired) {
        client.release();
        return false;
      }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [key]);
        } finally {
          client.release();
        }
      };
    } catch (error) {
      client.release();
      throw error;
    }
  }

  async findResult(request: PublishRequest): Promise<PublishResult | undefined> {
    return this.transaction(request, async (client) => {
      const result = await resultQuery(client, request);
      return result && ['failed', 'published'].includes(result.status)
        ? completedResult(result)
        : undefined;
    });
  }

  async activeArtifact(request: PublishRequest): Promise<string | undefined> {
    return this.transaction(request, async (client) => {
      const result = await query<{ artifact_hash: string }>(
        client,
        `SELECT b.artifact_hash
           FROM active_artifacts a
           JOIN build_artifacts b
             ON b.tenant_id = a.tenant_id AND b.site_id = a.site_id AND b.id = a.artifact_id
          WHERE a.tenant_id = $1 AND a.site_id = $2`,
        [request.tenantId, request.siteId],
      );
      return result.rows[0]?.artifact_hash;
    });
  }

  async begin(
    request: PublishRequest,
    previousArtifact: string | undefined,
  ): Promise<PublishResult | undefined> {
    return this.transaction(request, async (client) => {
      const inserted = await query<{ id: string }>(
        client,
        `INSERT INTO publication_requests
           (tenant_id, site_id, idempotency_key, requested_by, origin, reason,
            content_revision, status, previous_artifact_id, trace_id)
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, 'building',
           (SELECT id FROM build_artifacts
             WHERE tenant_id = $1 AND site_id = $2 AND artifact_hash = $8),
           $9
         )
         ON CONFLICT (tenant_id, site_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          request.tenantId,
          request.siteId,
          request.idempotencyKey,
          request.actorId,
          request.origin,
          request.reason,
          request.contentRevision,
          previousArtifact ?? null,
          request.traceId,
        ],
      );
      if (inserted.rows[0]) return undefined;
      const existing = await resultQuery(client, request);
      if (!existing) throw new Error('Publication idempotency state is inconsistent');
      if (['failed', 'published'].includes(existing.status)) return completedResult(existing);
      await client.query(
        `UPDATE publication_requests
            SET status = 'building', error_code = NULL
          WHERE tenant_id = $1 AND site_id = $2 AND idempotency_key = $3`,
        [request.tenantId, request.siteId, request.idempotencyKey],
      );
      return undefined;
    });
  }

  async revalidate(request: PublishRequest): Promise<void> {
    await this.transaction(request, async (client) => {
      await assertSiteFeatureEnabled(client, request, 'content.publish');
      const valid = await query<{
        editor_publish_grant: boolean;
        role: string;
      }>(
        client,
        `SELECT actor.role, actor.editor_publish_grant
           FROM sites s
           JOIN content_revisions r
             ON r.tenant_id = s.tenant_id AND r.site_id = s.id AND r.revision = $3
           LEFT JOIN site_emergency_controls e
             ON e.tenant_id = s.tenant_id AND e.site_id = s.id
           CROSS JOIN LATERAL (
             SELECT role, editor_publish_grant
               FROM (
                 SELECT m.role,
                        COALESCE((m.permissions ->> 'content.publish')::boolean, false)
                          AS editor_publish_grant
                   FROM memberships m
                  WHERE m.tenant_id = $1 AND m.site_id = $2 AND m.user_id = $4 AND m.active
                 UNION ALL
                 SELECT pm.role, false
                   FROM platform_memberships pm
                  WHERE pm.user_id = $4 AND pm.active
               ) actor_roles
              WHERE role IN (
                'platform_owner', 'platform_admin', 'staff',
                'customer_owner', 'customer_editor'
              )
           ) actor
          WHERE s.tenant_id = $1 AND s.id = $2 AND s.status = 'active'
            AND COALESCE(e.editing_frozen, false) = false
            AND NOT EXISTS (
              SELECT 1
                FROM active_artifacts active
                JOIN build_artifacts artifact
                  ON artifact.tenant_id = active.tenant_id
                 AND artifact.site_id = active.site_id
                 AND artifact.id = active.artifact_id
               WHERE active.tenant_id = $1 AND active.site_id = $2
                 AND artifact.content_revision > $3
            )
            AND NOT EXISTS (
              SELECT 1
                FROM publication_requests newer
               WHERE newer.tenant_id = $1 AND newer.site_id = $2
                 AND newer.content_revision > $3 AND newer.status = 'published'
            )`,
        [request.tenantId, request.siteId, request.contentRevision, request.actorId],
      );
      const authorization = valid.rows;
      if (
        authorization.length !== 1 ||
        authorization[0]?.role !== request.role ||
        (request.role === 'customer_editor' && !authorization[0].editor_publish_grant)
      ) {
        throw new Error('Publication inputs are no longer eligible');
      }
    });
  }

  async healthCheck(request: PublishRequest, artifactHash: string): Promise<void> {
    await this.transaction(request, async (client) => {
      const result = await query<{ manifest: { healthPaths?: unknown } }>(
        client,
        `SELECT manifest FROM build_artifacts
          WHERE tenant_id = $1 AND site_id = $2 AND artifact_hash = $3
            AND status = 'verified'`,
        [request.tenantId, request.siteId, artifactHash],
      );
      const manifest = result.rows[0]?.manifest;
      if (!manifest || !Array.isArray(manifest.healthPaths) || manifest.healthPaths.length === 0) {
        throw new Error('Verified artifact health manifest is unavailable');
      }
      const root = this.artifacts.artifactPath(request.siteId, artifactHash);
      for (const healthPath of manifest.healthPaths) {
        if (
          typeof healthPath !== 'string' ||
          healthPath.includes('..') ||
          healthPath.includes('\\')
        ) {
          throw new Error('Artifact health path is unsafe');
        }
        const relative = healthPath.endsWith('/')
          ? `${healthPath.replace(/^\//u, '')}index.html`
          : healthPath.replace(/^\//u, '');
        const path = resolve(root, relative || 'index.html');
        if (!path.startsWith(`${root}${sep}`) || !(await stat(path)).isFile()) {
          throw new Error('Artifact health check failed');
        }
      }
    });
  }

  async activate(request: PublishRequest, artifactHash: string): Promise<void> {
    const priorFilePointer = await this.artifacts.activeHash(request.siteId);
    await this.artifacts.activate(request.siteId, artifactHash);
    try {
      await this.transaction(request, async (client) => {
        const artifact = await query<{ content_revision: number; id: string }>(
          client,
          `SELECT id, content_revision FROM build_artifacts
            WHERE tenant_id = $1 AND site_id = $2 AND artifact_hash = $3 AND status = 'verified'
              AND content_revision = $4
            FOR UPDATE`,
          [request.tenantId, request.siteId, artifactHash, request.contentRevision],
        );
        if (!artifact.rows[0]) throw new Error('Only verified artifacts can be activated');
        const current = await query<{ content_revision: number }>(
          client,
          `SELECT artifact.content_revision
             FROM active_artifacts active
             JOIN build_artifacts artifact
               ON artifact.tenant_id = active.tenant_id
              AND artifact.site_id = active.site_id
              AND artifact.id = active.artifact_id
            WHERE active.tenant_id = $1 AND active.site_id = $2
            FOR UPDATE OF active`,
          [request.tenantId, request.siteId],
        );
        if ((current.rows[0]?.content_revision ?? 0) > request.contentRevision) {
          throw new Error('Publication revision is older than the active artifact');
        }
        await client.query(
          `UPDATE build_artifacts
              SET status = 'superseded'
            WHERE tenant_id = $1 AND site_id = $2 AND status = 'active' AND id <> $3`,
          [request.tenantId, request.siteId, artifact.rows[0].id],
        );
        await client.query(
          `UPDATE build_artifacts SET status = 'active'
            WHERE tenant_id = $1 AND site_id = $2 AND id = $3`,
          [request.tenantId, request.siteId, artifact.rows[0].id],
        );
        await client.query(
          `INSERT INTO active_artifacts (tenant_id, site_id, artifact_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, site_id) DO UPDATE
             SET artifact_id = EXCLUDED.artifact_id,
                 version = active_artifacts.version + 1,
                 updated_at = now()`,
          [request.tenantId, request.siteId, artifact.rows[0].id],
        );
      });
    } catch (error) {
      await this.artifacts.restoreActive(request.siteId, priorFilePointer);
      throw error;
    }
  }

  async rollbackActivation(
    request: PublishRequest,
    previousArtifact: string | undefined,
  ): Promise<void> {
    await this.artifacts.restoreActive(request.siteId, previousArtifact);
    await this.transaction(request, async (client) => {
      if (!previousArtifact) {
        await client.query(`DELETE FROM active_artifacts WHERE tenant_id = $1 AND site_id = $2`, [
          request.tenantId,
          request.siteId,
        ]);
        return;
      }
      await client.query(
        `UPDATE active_artifacts a
            SET artifact_id = b.id, version = a.version + 1, updated_at = now()
           FROM build_artifacts b
          WHERE a.tenant_id = $1 AND a.site_id = $2
            AND b.tenant_id = a.tenant_id AND b.site_id = a.site_id
            AND b.artifact_hash = $3`,
        [request.tenantId, request.siteId, previousArtifact],
      );
      await client.query(
        `UPDATE build_artifacts
            SET status = CASE WHEN artifact_hash = $3 THEN 'active' ELSE 'superseded' END
          WHERE tenant_id = $1 AND site_id = $2 AND status IN ('active', 'superseded')`,
        [request.tenantId, request.siteId, previousArtifact],
      );
    });
  }

  async record(request: PublishRequest, result: PublishResult): Promise<void> {
    await this.transaction(request, async (client) => {
      const updated = await query<{ id: string }>(
        client,
        `UPDATE publication_requests p
            SET status = $4::varchar,
                artifact_id = CASE WHEN $4::varchar = 'published' THEN b.id ELSE NULL END,
                completed_at = now(),
                error_code = CASE WHEN $4::varchar = 'failed' THEN 'publication_failed' ELSE NULL END
           FROM build_artifacts b
          WHERE p.tenant_id = $1 AND p.site_id = $2 AND p.idempotency_key = $3
            AND b.tenant_id = p.tenant_id AND b.site_id = p.site_id
            AND ($5::text IS NULL OR b.artifact_hash = $5)
          RETURNING p.id`,
        [
          request.tenantId,
          request.siteId,
          request.idempotencyKey,
          result.status,
          result.artifactHash ?? null,
        ],
      );
      let publicationId = updated.rows[0]?.id;
      if (!updated.rows[0] && result.status === 'failed') {
        const failed = await query<{ id: string }>(
          client,
          `UPDATE publication_requests
              SET status = 'failed', completed_at = now(), error_code = 'publication_failed'
            WHERE tenant_id = $1 AND site_id = $2 AND idempotency_key = $3
            RETURNING id`,
          [request.tenantId, request.siteId, request.idempotencyKey],
        );
        if (!failed.rows[0]) throw new Error('Publication result could not be recorded');
        publicationId = failed.rows[0].id;
      } else if (!updated.rows[0]) {
        throw new Error('Publication artifact could not be recorded');
      }
      await client.query(
        `INSERT INTO audit_events
           (tenant_id, site_id, actor_id, action, reason, trace_id, target_type, target_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, 'publication', $7, $8::jsonb)`,
        [
          request.tenantId,
          request.siteId,
          request.actorId,
          result.status === 'published' ? 'content.published' : 'content.publication_failed',
          request.reason,
          request.traceId,
          publicationId,
          JSON.stringify({
            artifactHash: result.artifactHash ?? null,
            contentRevision: request.contentRevision,
            idempotencyKey: request.idempotencyKey,
            origin: request.origin,
            previousArtifact: result.previousArtifact ?? null,
          }),
        ],
      );
    });
  }

  private transaction<T>(
    request: PublishRequest,
    operation: (client: TenantTransactionClient) => Promise<T>,
  ): Promise<T> {
    return withTenantTransaction(
      this.pool,
      { siteId: request.siteId, tenantId: request.tenantId, userId: request.actorId },
      operation,
    );
  }
}

async function resultQuery(
  client: TenantTransactionClient,
  request: PublishRequest,
): Promise<PublicationRowResult | undefined> {
  const result = await query<{
    artifact_hash: string | null;
    idempotency_key: string;
    previous_artifact_hash: string | null;
    status: 'building' | 'failed' | 'published' | 'queued';
  }>(
    client,
    `SELECT p.idempotency_key, p.status, current.artifact_hash,
            previous.artifact_hash AS previous_artifact_hash
       FROM publication_requests p
       LEFT JOIN build_artifacts current
         ON current.tenant_id = p.tenant_id AND current.site_id = p.site_id
        AND current.id = p.artifact_id
       LEFT JOIN build_artifacts previous
         ON previous.tenant_id = p.tenant_id AND previous.site_id = p.site_id
        AND previous.id = p.previous_artifact_id
      WHERE p.tenant_id = $1 AND p.site_id = $2 AND p.idempotency_key = $3`,
    [request.tenantId, request.siteId, request.idempotencyKey],
  );
  const row = result.rows[0];
  return row
    ? {
        ...(row.artifact_hash ? { artifactHash: row.artifact_hash } : {}),
        ...(row.previous_artifact_hash ? { previousArtifact: row.previous_artifact_hash } : {}),
        requestKey: row.idempotency_key,
        status: row.status,
      }
    : undefined;
}

interface PublicationRowResult {
  artifactHash?: string;
  previousArtifact?: string;
  requestKey: string;
  status: 'building' | 'failed' | 'published' | 'queued';
}

function completedResult(result: PublicationRowResult): PublishResult {
  if (result.status !== 'failed' && result.status !== 'published') {
    throw new Error('Publication result is not complete');
  }
  return { ...result, status: result.status };
}

async function query<T extends Record<string, unknown>>(
  client: TenantTransactionClient,
  text: string,
  values: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}
