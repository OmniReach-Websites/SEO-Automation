import {
  assertSiteFeatureEnabled,
  withTenantTransaction,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';

import {
  ProtectedFieldError,
  RevisionConflictError,
  updateDraft,
  type ContentRecord,
  type ContentValue,
  type FieldPolicy,
} from './content.ts';

export interface ContentActorContext {
  role: string;
  siteId: string;
  tenantId: string;
  traceId: string;
  userId: string;
}

export interface DraftRecord {
  baseRevision: number;
  content: ContentRecord;
  id: string;
  version: number;
}

export interface PreparedPublication {
  contentRevision: number;
  status: 'building' | 'failed' | 'published' | 'queued';
}

export class PostgresContentRepository {
  constructor(private readonly pool: TenantTransactionPool) {}

  async createDraft(context: ContentActorContext): Promise<DraftRecord> {
    return this.transaction(context, async (client) => {
      await assertSiteFeatureEnabled(client, context, 'content.edit');
      const latest = await query<{ content: ContentRecord; revision: number }>(
        client,
        `SELECT revision, content
           FROM content_revisions
          WHERE tenant_id = $1 AND site_id = $2
          ORDER BY revision DESC
          LIMIT 1`,
        [context.tenantId, context.siteId],
      );
      const revision = latest.rows[0];
      if (!revision) throw new Error('A published content revision is required before drafting');
      const created = await query<{
        base_revision: number;
        content: ContentRecord;
        id: string;
        version: number;
      }>(
        client,
        `INSERT INTO content_drafts
           (tenant_id, site_id, base_revision, content, created_by)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         RETURNING id, base_revision, version, content`,
        [
          context.tenantId,
          context.siteId,
          revision.revision,
          JSON.stringify(revision.content),
          context.userId,
        ],
      );
      const draft = required(created.rows[0], 'Draft creation failed');
      await audit(client, context, {
        action: 'content.draft.created',
        metadata: { baseRevision: draft.base_revision },
        targetId: draft.id,
        targetType: 'content_draft',
      });
      return mapDraft(draft);
    });
  }

  async listPages(context: ContentActorContext): Promise<unknown[]> {
    return this.transaction(context, async (client) => {
      const pages = await query<{
        fields: unknown;
        id: string;
        route: string;
        schema_version: number;
        stable_id: string;
      }>(
        client,
        `SELECT p.id, p.stable_id, p.route, p.schema_version,
                COALESCE(jsonb_agg(
                  jsonb_build_object(
                    'id', f.stable_id,
                    'type', f.field_type,
                    'protected', f.protected,
                    'aiMode', f.ai_mode,
                    'editableBy', f.editable_by
                  ) ORDER BY f.stable_id
                ) FILTER (WHERE f.id IS NOT NULL), '[]'::jsonb) AS fields
           FROM content_pages p
           LEFT JOIN content_fields f
             ON f.tenant_id = p.tenant_id AND f.site_id = p.site_id AND f.page_id = p.id
          WHERE p.tenant_id = $1 AND p.site_id = $2
          GROUP BY p.id
          ORDER BY p.route`,
        [context.tenantId, context.siteId],
      );
      return pages.rows.map((page) => ({
        fields: page.fields,
        id: page.id,
        route: page.route,
        schemaVersion: page.schema_version,
        stableId: page.stable_id,
      }));
    });
  }

  async listHistory(context: ContentActorContext): Promise<unknown[]> {
    return this.transaction(context, async (client) => {
      const history = await query<{
        created_at: Date;
        created_by: string;
        origin: string;
        restored_from: number | null;
        revision: number;
      }>(
        client,
        `SELECT revision, origin, restored_from, created_by, created_at
           FROM content_revisions
          WHERE tenant_id = $1 AND site_id = $2
          ORDER BY revision DESC`,
        [context.tenantId, context.siteId],
      );
      return history.rows.map((revision) => ({
        createdAt: revision.created_at,
        createdBy: revision.created_by,
        origin: revision.origin,
        ...(revision.restored_from ? { restoredFrom: revision.restored_from } : {}),
        revision: revision.revision,
      }));
    });
  }

  async listDrafts(context: ContentActorContext): Promise<DraftRecord[]> {
    return this.transaction(context, async (client) => {
      const drafts = await query<{
        base_revision: number;
        content: ContentRecord;
        id: string;
        version: number;
      }>(
        client,
        `SELECT id, base_revision, version, content
           FROM content_drafts
          WHERE tenant_id = $1 AND site_id = $2
          ORDER BY updated_at DESC`,
        [context.tenantId, context.siteId],
      );
      return drafts.rows.map(mapDraft);
    });
  }

  async updateDraftField(
    context: ContentActorContext,
    input: { draftId: string; expectedVersion: number; fieldId: string; value: unknown },
  ): Promise<DraftRecord> {
    return this.updateDraftFields(context, {
      draftId: input.draftId,
      expectedVersion: input.expectedVersion,
      patch: { [input.fieldId]: input.value },
    });
  }

  async updateDraftFields(
    context: ContentActorContext,
    input: { draftId: string; expectedVersion: number; patch: Record<string, unknown> },
  ): Promise<DraftRecord> {
    const entries = Object.entries(input.patch);
    if (entries.length === 0 || entries.length > 100) {
      throw new Error('Draft patch must include between 1 and 100 fields');
    }
    if (entries.some(([, value]) => !isContentValue(value))) {
      throw new Error('Field value is not valid structured content');
    }
    const patch = Object.fromEntries(entries) as ContentRecord;
    const fieldIds = entries.map(([fieldId]) => fieldId);
    return this.transaction(context, async (client) => {
      await assertSiteFeatureEnabled(client, context, 'content.edit');
      const draftResult = await query<{
        base_revision: number;
        content: ContentRecord;
        id: string;
        version: number;
      }>(
        client,
        `SELECT id, base_revision, version, content
           FROM content_drafts
          WHERE tenant_id = $1 AND site_id = $2 AND id = $3
          FOR UPDATE`,
        [context.tenantId, context.siteId, input.draftId],
      );
      const draft = required(draftResult.rows[0], 'Draft was not found');
      const fieldResult = await query<{
        ai_mode: FieldPolicy['aiMode'];
        editable_by: string[];
        field_type: string;
        protected: boolean;
        stable_id: string;
      }>(
        client,
        `SELECT stable_id, field_type, protected, ai_mode, editable_by
           FROM content_fields
          WHERE tenant_id = $1 AND site_id = $2
            AND stable_id = ANY($3::varchar(100)[])`,
        [context.tenantId, context.siteId, fieldIds],
      );
      if (fieldResult.rows.length !== fieldIds.length) {
        throw new Error('One or more content fields were not found');
      }
      for (const field of fieldResult.rows) {
        if (!Array.isArray(field.editable_by) || !field.editable_by.includes(context.role)) {
          throw new ProtectedFieldError('Role cannot edit this content field');
        }
      }
      const policies = new Map(
        fieldResult.rows.map((field) => [
          field.stable_id,
          {
            aiMode: field.ai_mode,
            id: field.stable_id,
            protected: field.protected,
            type: field.field_type,
          },
        ]),
      );
      const changed = updateDraft({
        actor: 'human',
        current: draft.content,
        currentVersion: draft.version,
        expectedVersion: input.expectedVersion,
        fieldPolicies: policies,
        patch,
      });
      const updated = await query<{
        base_revision: number;
        content: ContentRecord;
        id: string;
        version: number;
      }>(
        client,
        `UPDATE content_drafts
            SET content = $1::jsonb, version = $2, updated_at = now()
          WHERE tenant_id = $3 AND site_id = $4 AND id = $5 AND version = $6
          RETURNING id, base_revision, version, content`,
        [
          JSON.stringify(changed.content),
          changed.version,
          context.tenantId,
          context.siteId,
          input.draftId,
          input.expectedVersion,
        ],
      );
      if (!updated.rows[0]) throw new RevisionConflictError('Draft revision is stale');
      const fieldId = fieldIds.length === 1 ? fieldIds[0] : undefined;
      await audit(client, context, {
        action:
          fieldIds.length === 1 ? 'content.draft.field_updated' : 'content.draft.fields_updated',
        metadata: {
          ...(fieldId ? { fieldId } : {}),
          fieldIds,
          version: changed.version,
        },
        targetId: input.draftId,
        targetType: 'content_draft',
      });
      return mapDraft(updated.rows[0]);
    });
  }

  async prepareDraftPublication(
    context: ContentActorContext,
    input: { draftId: string; idempotencyKey: string; reason: string },
  ): Promise<PreparedPublication> {
    return this.preparePublication(
      context,
      input.idempotencyKey,
      'content.publish',
      async (client) => {
        const draftResult = await query<{
          base_revision: number;
          content: ContentRecord;
          id: string;
        }>(
          client,
          `SELECT id, base_revision, content
           FROM content_drafts
          WHERE tenant_id = $1 AND site_id = $2 AND id = $3
          FOR UPDATE`,
          [context.tenantId, context.siteId, input.draftId],
        );
        const draft = required(draftResult.rows[0], 'Draft was not found');
        const latest = await latestRevision(client, context);
        if (draft.base_revision !== latest) {
          throw new RevisionConflictError('Draft base revision is stale');
        }
        const revision = latest + 1;
        const facts = await factsSnapshot(client, context);
        const schemaVersion = await currentSchemaVersion(client, context);
        await client.query(
          `INSERT INTO content_revisions
           (tenant_id, site_id, revision, schema_version, content, facts_snapshot, created_by, origin)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, 'human')`,
          [
            context.tenantId,
            context.siteId,
            revision,
            schemaVersion,
            JSON.stringify(draft.content),
            JSON.stringify(facts),
            context.userId,
          ],
        );
        await insertPublicationRequest(client, context, {
          contentRevision: revision,
          idempotencyKey: input.idempotencyKey,
          origin: 'customer',
          reason: input.reason,
        });
        await audit(client, context, {
          action: 'content.publication_queued',
          metadata: { draftId: input.draftId, idempotencyKey: input.idempotencyKey, revision },
          targetId: input.draftId,
          targetType: 'content_draft',
        });
        return { contentRevision: revision, status: 'queued' };
      },
    );
  }

  async prepareRestorePublication(
    context: ContentActorContext,
    input: { idempotencyKey: string; reason: string; revision: number },
  ): Promise<PreparedPublication> {
    return this.preparePublication(
      context,
      input.idempotencyKey,
      'content.publish',
      async (client) => {
        const targetResult = await query<{
          content: ContentRecord;
          facts_snapshot: unknown;
          revision: number;
          schema_version: number;
        }>(
          client,
          `SELECT revision, schema_version, content, facts_snapshot
           FROM content_revisions
          WHERE tenant_id = $1 AND site_id = $2 AND revision = $3`,
          [context.tenantId, context.siteId, input.revision],
        );
        const target = required(targetResult.rows[0], 'Revision was not found');
        const revision = (await latestRevision(client, context)) + 1;
        await client.query(
          `INSERT INTO content_revisions
           (tenant_id, site_id, revision, schema_version, content, facts_snapshot,
            created_by, origin, restored_from)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, 'restore', $8)`,
          [
            context.tenantId,
            context.siteId,
            revision,
            target.schema_version,
            JSON.stringify(target.content),
            JSON.stringify(target.facts_snapshot),
            context.userId,
            target.revision,
          ],
        );
        await insertPublicationRequest(client, context, {
          contentRevision: revision,
          idempotencyKey: input.idempotencyKey,
          origin: 'restore',
          reason: input.reason,
        });
        await audit(client, context, {
          action: 'content.restore_queued',
          metadata: {
            idempotencyKey: input.idempotencyKey,
            restoredFrom: target.revision,
            revision,
          },
          targetId: context.siteId,
          targetType: 'site',
        });
        return { contentRevision: revision, status: 'queued' };
      },
    );
  }

  private async preparePublication(
    context: ContentActorContext,
    idempotencyKey: string,
    featureKey: string,
    create: (client: TenantTransactionClient) => Promise<PreparedPublication>,
  ): Promise<PreparedPublication> {
    return this.transaction(context, async (client) => {
      await assertSiteFeatureEnabled(client, context, featureKey);
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `${context.tenantId}:${context.siteId}:content-revision`,
      ]);
      const existing = await query<{
        content_revision: number;
        status: PreparedPublication['status'];
      }>(
        client,
        `SELECT content_revision, status
           FROM publication_requests
          WHERE tenant_id = $1 AND site_id = $2 AND idempotency_key = $3`,
        [context.tenantId, context.siteId, idempotencyKey],
      );
      return existing.rows[0]
        ? {
            contentRevision: existing.rows[0].content_revision,
            status: existing.rows[0].status,
          }
        : create(client);
    });
  }

  private transaction<T>(
    context: ContentActorContext,
    operation: (client: TenantTransactionClient) => Promise<T>,
  ): Promise<T> {
    return withTenantTransaction(
      this.pool,
      { siteId: context.siteId, tenantId: context.tenantId, userId: context.userId },
      operation,
    );
  }
}

async function latestRevision(
  client: TenantTransactionClient,
  context: ContentActorContext,
): Promise<number> {
  const result = await query<{ revision: number }>(
    client,
    `SELECT revision FROM content_revisions
      WHERE tenant_id = $1 AND site_id = $2
      ORDER BY revision DESC LIMIT 1`,
    [context.tenantId, context.siteId],
  );
  return required(result.rows[0], 'A current revision is required').revision;
}

async function currentSchemaVersion(
  client: TenantTransactionClient,
  context: ContentActorContext,
): Promise<number> {
  const result = await query<{ schema_version: number }>(
    client,
    `SELECT COALESCE(max(schema_version), 1)::integer AS schema_version
       FROM content_pages WHERE tenant_id = $1 AND site_id = $2`,
    [context.tenantId, context.siteId],
  );
  return result.rows[0]?.schema_version ?? 1;
}

async function factsSnapshot(
  client: TenantTransactionClient,
  context: ContentActorContext,
): Promise<unknown> {
  const result = await query<{ facts: unknown }>(
    client,
    `SELECT COALESCE(
       jsonb_object_agg(stable_id, jsonb_build_object('value', value, 'version', version)),
       '{}'::jsonb
     ) AS facts
       FROM business_facts WHERE tenant_id = $1 AND site_id = $2`,
    [context.tenantId, context.siteId],
  );
  return result.rows[0]?.facts ?? {};
}

async function insertPublicationRequest(
  client: TenantTransactionClient,
  context: ContentActorContext,
  input: {
    contentRevision: number;
    idempotencyKey: string;
    origin: 'customer' | 'restore';
    reason: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO publication_requests
       (tenant_id, site_id, idempotency_key, requested_by, origin, reason,
        content_revision, status, previous_artifact_id)
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, 'queued',
       (SELECT artifact_id FROM active_artifacts WHERE tenant_id = $1 AND site_id = $2)
     )`,
    [
      context.tenantId,
      context.siteId,
      input.idempotencyKey,
      context.userId,
      input.origin,
      input.reason,
      input.contentRevision,
    ],
  );
}

async function audit(
  client: TenantTransactionClient,
  context: ContentActorContext,
  event: {
    action: string;
    metadata: Record<string, unknown>;
    targetId: string;
    targetType: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (tenant_id, site_id, actor_id, action, trace_id, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      context.tenantId,
      context.siteId,
      context.userId,
      event.action,
      context.traceId,
      event.targetType,
      event.targetId,
      JSON.stringify(event.metadata),
    ],
  );
}

async function query<T extends Record<string, unknown>>(
  client: TenantTransactionClient,
  text: string,
  values: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}

function mapDraft(input: {
  base_revision: number;
  content: ContentRecord;
  id: string;
  version: number;
}): DraftRecord {
  return {
    baseRevision: input.base_revision,
    content: structuredClone(input.content),
    id: input.id,
    version: input.version,
  };
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function isContentValue(value: unknown, seen = new Set<object>()): value is ContentValue {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) return true;
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isContentValue(entry, seen))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value as Record<string, unknown>).every((entry) => isContentValue(entry, seen));
  seen.delete(value);
  return valid;
}
