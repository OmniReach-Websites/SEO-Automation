import { createHash } from 'node:crypto';

import type { ProposalEvaluation } from '@omnireach/ai';
import { withTenantTransaction, type TenantTransactionPool } from '@omnireach/tenant';

export interface AiProposalStageContext {
  actorId: string;
  baseRevision: number;
  currentValue: unknown;
  fieldId: string;
  policyVersion: number;
  siteId: string;
  tenantId: string;
  traceId: string;
}

export interface AiProposalStageInput {
  costUsdMicros: number;
  evaluation: ProposalEvaluation;
  evidence: readonly string[];
  expiresAt: Date;
  latencyMs: number;
  mode: 'AUTO' | 'SUGGEST';
  model: string;
  outputTokens: number;
  promptVersion: number;
  provider: string;
  providerRequestHash?: string;
  rationale: string;
  replacement: string;
}

/**
 * Persists an evaluated provider result as a reviewable proposal. Even AUTO mode
 * remains a proposal: it never writes public files, creates a publication request,
 * or bypasses the versioned customer review/draft path.
 */
export class PostgresAiProposalStager {
  constructor(private readonly pool: TenantTransactionPool) {}

  async stage(
    context: AiProposalStageContext,
    proposal: AiProposalStageInput,
  ): Promise<{ proposalId: string }> {
    if (
      context.baseRevision < 1 ||
      context.policyVersion < 1 ||
      proposal.expiresAt <= new Date() ||
      proposal.costUsdMicros < 0 ||
      proposal.outputTokens < 0 ||
      proposal.latencyMs < 0
    ) {
      throw new Error('Invalid AI proposal staging input');
    }
    return withTenantTransaction(
      this.pool,
      {
        siteId: context.siteId,
        tenantId: context.tenantId,
        userId: context.actorId,
      },
      async (client) => {
        const field = (await client.query(
          `SELECT id, stable_id, ai_mode, protected
             FROM content_fields
            WHERE tenant_id = $1 AND site_id = $2
              AND (id::text = $3 OR stable_id = $3)
            LIMIT 2`,
          [context.tenantId, context.siteId, context.fieldId],
        )) as {
          rows: { ai_mode: string; id: string; protected: boolean; stable_id: string }[];
        };
        const selected = field.rows[0];
        if (
          field.rows.length !== 1 ||
          !selected ||
          selected.protected ||
          selected.ai_mode === 'disabled' ||
          (proposal.mode === 'AUTO' && selected.ai_mode !== 'auto')
        ) {
          throw new Error('AI proposal is not allowed for this field');
        }
        const current = (await client.query(
          `SELECT revision.content -> $4 AS field_value
             FROM content_revisions revision
            WHERE revision.tenant_id = $1 AND revision.site_id = $2
              AND revision.revision = $3`,
          [context.tenantId, context.siteId, context.baseRevision, selected.stable_id],
        )) as { rows: { field_value: unknown }[] };
        if (
          current.rows.length !== 1 ||
          sourceValueHash(current.rows[0]?.field_value) !== sourceValueHash(context.currentValue)
        ) {
          throw new Error('AI proposal source is stale');
        }
        const validation = {
          costUsdMicros: proposal.costUsdMicros,
          evaluation: proposal.evaluation,
          sourceValueHash: sourceValueHash(context.currentValue),
        };
        const inserted = (await client.query(
          `INSERT INTO content_proposals
             (tenant_id, site_id, field_id, base_revision, state, proposed_value,
              provider, model, prompt_version, evidence, rationale, output_tokens,
              latency_ms, provider_request_hash, expires_at, effective_mode,
              validation, policy_version)
           VALUES ($1, $2, $3, $4, 'pending', $5::jsonb, $6, $7, $8,
                   $9::jsonb, $10, $11, $12, $13, $14, $15, $16::jsonb, $17)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [
            context.tenantId,
            context.siteId,
            selected.id,
            context.baseRevision,
            JSON.stringify(proposal.replacement),
            proposal.provider,
            proposal.model,
            proposal.promptVersion,
            JSON.stringify(proposal.evidence),
            proposal.rationale,
            proposal.outputTokens,
            proposal.latencyMs,
            proposal.providerRequestHash ?? null,
            proposal.expiresAt,
            proposal.mode,
            JSON.stringify(validation),
            context.policyVersion,
          ],
        )) as { rows: { id: string }[] };
        const existing = inserted.rows[0]
          ? inserted
          : ((await client.query(
              `SELECT id FROM content_proposals
                WHERE tenant_id = $1 AND site_id = $2 AND field_id = $3
                  AND base_revision = $4 AND policy_version = $5
                  AND COALESCE(prompt_version, 0) = $6 AND state IN ('pending', 'approved')
                LIMIT 1`,
              [
                context.tenantId,
                context.siteId,
                selected.id,
                context.baseRevision,
                context.policyVersion,
                proposal.promptVersion,
              ],
            )) as { rows: { id: string }[] });
        const proposalId = existing.rows[0]?.id;
        if (!proposalId) throw new Error('AI proposal staging failed');
        await client.query(
          `INSERT INTO audit_events
             (tenant_id, site_id, actor_id, action, trace_id, target_type, target_id, metadata)
           VALUES ($1, $2, $3, 'ai.proposal.staged', $4, 'content_proposal', $5, $6::jsonb)`,
          [
            context.tenantId,
            context.siteId,
            context.actorId,
            context.traceId,
            proposalId,
            JSON.stringify({
              costUsdMicros: proposal.costUsdMicros,
              effectiveMode: proposal.mode,
              model: proposal.model,
              promptVersion: proposal.promptVersion,
            }),
          ],
        );
        return { proposalId };
      },
    );
  }
}

function sourceValueHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value ?? null), 'utf8')
    .digest('hex');
}
