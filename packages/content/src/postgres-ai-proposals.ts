import { createHash, randomUUID } from 'node:crypto';

import {
  assertSiteFeatureEnabled,
  SitePolicyDeniedError,
  withTenantTransaction,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';

import { effectiveAiMode, type EffectiveAiMode } from './ai-policy.ts';
import type { ContentActorContext } from './postgres.ts';

export interface AiProposalRequestInput {
  evidence: readonly string[];
  fieldId: string;
  fieldPurpose: string;
  idempotencyKey: string;
}

export interface AiProposalRequestResult {
  jobId: string;
  materialId: string;
  mode: Exclude<EffectiveAiMode, 'PROTECTED'>;
  state: string;
}

/**
 * Admits a bounded field-scoped request and its durable job atomically. The BullMQ
 * envelope contains only the resulting identifiers; current copy and evidence remain
 * in tenant-scoped PostgreSQL and are revalidated by the worker before provider use.
 */
export class PostgresAiProposalRequestRepository {
  constructor(private readonly pool: TenantTransactionPool) {}

  request(
    context: ContentActorContext,
    input: AiProposalRequestInput,
  ): Promise<AiProposalRequestResult> {
    validateRequest(input);
    return withTenantTransaction(
      this.pool,
      { siteId: context.siteId, tenantId: context.tenantId, userId: context.userId },
      async (client) => {
        await assertSiteFeatureEnabled(client, context, 'content.edit');
        const source = required(
          (
            await query<{
              ai_mode: 'auto' | 'disabled' | 'suggestion';
              automation_stopped: boolean;
              autonomous_changes_stopped: boolean;
              base_revision: number;
              current_value: unknown;
              field_id: string;
              field_type: string;
              policy_version: number;
              protected: boolean;
              stable_id: string;
            }>(
              client,
              `WITH base AS (
                 SELECT revision.revision, revision.content
                   FROM content_revisions revision
                  WHERE revision.tenant_id = $1 AND revision.site_id = $2
                    AND revision.revision = COALESCE(
                      (SELECT artifact.content_revision
                         FROM active_artifacts active
                         JOIN build_artifacts artifact
                           ON artifact.tenant_id = active.tenant_id
                          AND artifact.site_id = active.site_id
                          AND artifact.id = active.artifact_id
                        WHERE active.tenant_id = $1 AND active.site_id = $2),
                      (SELECT published.content_revision
                         FROM publication_requests published
                        WHERE published.tenant_id = $1 AND published.site_id = $2
                          AND published.status = 'published'
                        ORDER BY published.content_revision DESC, published.created_at DESC
                        LIMIT 1),
                      (SELECT seed.revision
                         FROM content_revisions seed
                        WHERE seed.tenant_id = $1 AND seed.site_id = $2
                          AND seed.origin = 'seed'
                        ORDER BY seed.revision DESC LIMIT 1)
                    )
               )
               SELECT field.id AS field_id, field.stable_id, field.field_type,
                      field.protected, field.ai_mode, base.revision AS base_revision,
                      COALESCE(draft.content, base.content) -> field.stable_id AS current_value,
                      COALESCE(control.policy_version, 1) AS policy_version,
                      COALESCE(control.automation_stopped, false) AS automation_stopped,
                      COALESCE(control.autonomous_changes_stopped, false)
                        AS autonomous_changes_stopped
                 FROM content_fields field
                 CROSS JOIN base
                 LEFT JOIN content_drafts draft
                   ON draft.tenant_id = field.tenant_id AND draft.site_id = field.site_id
                  AND draft.state = 'active' AND draft.base_revision = base.revision
                 LEFT JOIN site_emergency_controls control
                   ON control.tenant_id = field.tenant_id AND control.site_id = field.site_id
                WHERE field.tenant_id = $1 AND field.site_id = $2
                  AND (field.id::text = $3 OR field.stable_id = $3)
                LIMIT 2`,
              [context.tenantId, context.siteId, input.fieldId],
            )
          ).rows[0],
          'AI proposal field or source revision was not found',
        );
        if (source.automation_stopped) {
          throw new SitePolicyDeniedError('Site policy denies AI automation');
        }
        if (
          source.protected ||
          source.ai_mode === 'disabled' ||
          !['text', 'richText'].includes(source.field_type) ||
          typeof source.current_value !== 'string'
        ) {
          throw new SitePolicyDeniedError('Field policy denies AI proposals');
        }
        let siteAutoEditingEnabled = false;
        try {
          await assertSiteFeatureEnabled(client, context, 'content.ai.auto');
          siteAutoEditingEnabled = true;
        } catch (error) {
          if (!(error instanceof SitePolicyDeniedError)) throw error;
        }
        const mode = effectiveAiMode({
          autonomousChangesStopped: source.autonomous_changes_stopped,
          field: {
            aiMode: source.ai_mode,
            id: source.stable_id,
            protected: source.protected,
            type: source.field_type,
          },
          globalGenerationEnabled: true,
          policyVersion: source.policy_version,
          siteAutoEditingEnabled,
        });
        if (mode === 'PROTECTED') {
          throw new SitePolicyDeniedError('Field policy denies AI proposals');
        }

        const requestKey = createHash('sha256')
          .update(`${context.userId}\0${input.idempotencyKey.trim()}`)
          .digest('hex');
        const materialId = randomUUID();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
        await client.query(
          `INSERT INTO ai_proposal_job_materials
             (id, tenant_id, site_id, field_id, requested_by, request_key,
              base_revision, policy_version, field_purpose, evidence,
              source_value_hash, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
           ON CONFLICT (tenant_id, site_id, request_key) DO NOTHING`,
          [
            materialId,
            context.tenantId,
            context.siteId,
            source.field_id,
            context.userId,
            requestKey,
            source.base_revision,
            source.policy_version,
            input.fieldPurpose.trim(),
            JSON.stringify(input.evidence),
            sourceValueHash(source.current_value),
            expiresAt,
          ],
        );
        const material = required(
          (
            await query<{
              base_revision: number;
              evidence: unknown;
              expires_at: Date;
              field_id: string;
              field_purpose: string;
              id: string;
              policy_version: number;
              source_value_hash: string;
            }>(
              client,
              `SELECT id, field_id, base_revision, policy_version, field_purpose,
                      evidence, source_value_hash, expires_at
                 FROM ai_proposal_job_materials
                WHERE tenant_id = $1 AND site_id = $2 AND request_key = $3`,
              [context.tenantId, context.siteId, requestKey],
            )
          ).rows[0],
          'AI proposal material admission failed',
        );
        if (
          material.field_id !== source.field_id ||
          material.base_revision !== source.base_revision ||
          material.policy_version !== source.policy_version ||
          material.field_purpose !== input.fieldPurpose.trim() ||
          JSON.stringify(material.evidence) !== JSON.stringify(input.evidence) ||
          material.source_value_hash !== sourceValueHash(source.current_value)
        ) {
          throw new Error('AI proposal idempotency key was reused for a different request');
        }
        const dedupeKey = `ai-proposal:${requestKey}`;
        const job = required(
          (
            await query<{ id: string; state: string }>(
              client,
              `INSERT INTO jobs
                 (tenant_id, site_id, category, schema_version, record_id, dedupe_key,
                  trace_id, state, policy_version, attempt_limit, expires_at)
               VALUES ($1, $2, 'aio_proposal', 1, $3, $4, $5, 'queued', $6, 3, $7)
               ON CONFLICT (tenant_id, site_id, category, dedupe_key) DO UPDATE
                 SET updated_at = jobs.updated_at
               RETURNING id, state`,
              [
                context.tenantId,
                context.siteId,
                material.id,
                dedupeKey,
                context.traceId,
                material.policy_version,
                material.expires_at,
              ],
            )
          ).rows[0],
          'AI proposal job admission failed',
        );
        await client.query(
          `INSERT INTO audit_events
             (tenant_id, site_id, actor_id, action, trace_id, target_type, target_id, metadata)
           VALUES ($1, $2, $3, 'ai.proposal.requested', $4,
                   'ai_proposal_job_material', $5, $6::jsonb)`,
          [
            context.tenantId,
            context.siteId,
            context.userId,
            context.traceId,
            material.id,
            JSON.stringify({
              baseRevision: material.base_revision,
              fieldId: source.stable_id,
              mode,
              policyVersion: material.policy_version,
            }),
          ],
        );
        return { jobId: job.id, materialId: material.id, mode, state: job.state };
      },
    );
  }
}

export function sourceValueHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value ?? null), 'utf8')
    .digest('hex');
}

function validateRequest(input: AiProposalRequestInput): void {
  if (
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(input.fieldId) ||
    input.fieldId.length > 100 ||
    input.fieldPurpose.trim().length < 1 ||
    input.fieldPurpose.trim().length > 200 ||
    input.idempotencyKey.trim().length < 8 ||
    input.idempotencyKey.trim().length > 128 ||
    input.evidence.length > 10 ||
    input.evidence.some((entry) => entry.length > 1_000) ||
    Buffer.byteLength(JSON.stringify(input.evidence), 'utf8') > 10_000
  ) {
    throw new Error('Invalid AI proposal request');
  }
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

async function query<T extends Record<string, unknown>>(
  client: TenantTransactionClient,
  text: string,
  values?: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}
