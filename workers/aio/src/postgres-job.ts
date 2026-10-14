import type { ModelPrice, ProposalInput } from '@omnireach/ai';
import { effectiveAiMode, sourceValueHash, type EffectiveAiMode } from '@omnireach/content';
import type { JobEnvelope } from '@omnireach/queue';
import {
  assertSiteFeatureEnabled,
  SitePolicyDeniedError,
  withWorkerTransaction,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';

export interface RehydratedAiProposalJob {
  actorId: string;
  baseRevision: number;
  currentValue: string;
  evidence: readonly string[];
  existingProposalId?: string;
  fieldId: string;
  input: ProposalInput;
  materialId: string;
  mode: Exclude<EffectiveAiMode, 'PROTECTED'>;
  modelPrice: ModelPrice;
  policyVersion: number;
  protectedFacts: readonly string[];
}

export class PostgresAiProposalJobLoader {
  constructor(private readonly pool: TenantTransactionPool) {}

  load(
    envelope: JobEnvelope,
    jobId: string,
    modelAlias: string,
    providerModel: string,
    now = new Date(),
  ): Promise<RehydratedAiProposalJob> {
    return withWorkerTransaction(
      this.pool,
      { jobId, siteId: envelope.siteId, tenantId: envelope.tenantId },
      async (client) => {
        await assertSiteFeatureEnabled(client, envelope, 'content.edit');
        const source = required(
          (
            await query<{
              ai_mode: 'auto' | 'disabled' | 'suggestion';
              automation_stopped: boolean;
              autonomous_changes_stopped: boolean;
              base_revision: number;
              current_value: unknown;
              evidence: unknown;
              expires_at: Date;
              field_purpose: string;
              material_id: string;
              policy_version: number;
              proposal_id: string | null;
              protected: boolean;
              requested_by: string;
              source_value_hash: string;
              stable_id: string;
              field_type: string;
            }>(
              client,
              `SELECT material.id AS material_id, material.requested_by,
                      material.base_revision, material.policy_version,
                      material.field_purpose, material.evidence,
                      material.source_value_hash, material.expires_at,
                      material.proposal_id, field.stable_id, field.field_type,
                      field.protected, field.ai_mode,
                      COALESCE(draft.content, revision.content) -> field.stable_id
                        AS current_value,
                      COALESCE(control.automation_stopped, false) AS automation_stopped,
                      COALESCE(control.autonomous_changes_stopped, false)
                        AS autonomous_changes_stopped
                 FROM jobs job
                 JOIN ai_proposal_job_materials material
                   ON material.tenant_id = job.tenant_id AND material.site_id = job.site_id
                  AND material.id = job.record_id
                 JOIN content_fields field
                   ON field.tenant_id = material.tenant_id AND field.site_id = material.site_id
                  AND field.id = material.field_id
                 JOIN content_revisions revision
                   ON revision.tenant_id = material.tenant_id
                  AND revision.site_id = material.site_id
                  AND revision.revision = material.base_revision
                 LEFT JOIN content_drafts draft
                   ON draft.tenant_id = material.tenant_id AND draft.site_id = material.site_id
                  AND draft.state = 'active' AND draft.base_revision = material.base_revision
                 LEFT JOIN site_emergency_controls control
                   ON control.tenant_id = material.tenant_id AND control.site_id = material.site_id
                WHERE job.tenant_id = $1 AND job.site_id = $2 AND job.id = $3
                  AND job.category = 'aio_proposal' AND job.record_id = $4
                  AND job.policy_version = material.policy_version`,
              [envelope.tenantId, envelope.siteId, jobId, envelope.recordId],
            )
          ).rows[0],
          'AI proposal job material is unavailable',
        );
        if (source.proposal_id) {
          return {
            actorId: source.requested_by,
            baseRevision: source.base_revision,
            currentValue: stringValue(source.current_value, 'AI source is not text'),
            evidence: stringEvidence(source.evidence),
            existingProposalId: source.proposal_id,
            fieldId: source.stable_id,
            input: {
              currentValue: stringValue(source.current_value, 'AI source is not text'),
              evidence: stringEvidence(source.evidence),
              fieldId: source.stable_id,
              fieldPurpose: source.field_purpose,
            },
            materialId: source.material_id,
            mode: source.ai_mode === 'auto' ? 'AUTO' : 'SUGGEST',
            modelPrice: await modelPrice(client, modelAlias, providerModel, now),
            policyVersion: source.policy_version,
            protectedFacts: [],
          };
        }
        if (source.expires_at <= now) {
          throw new SitePolicyDeniedError('AI proposal material expired');
        }
        if (source.automation_stopped) {
          throw new SitePolicyDeniedError('Site policy denies AI automation');
        }
        if (
          source.protected ||
          source.ai_mode === 'disabled' ||
          !['text', 'richText'].includes(source.field_type)
        ) {
          throw new SitePolicyDeniedError('Field policy denies AI proposals');
        }
        const currentValue = stringValue(source.current_value, 'AI source is not text');
        if (sourceValueHash(currentValue) !== source.source_value_hash) {
          throw new SitePolicyDeniedError('AI proposal source changed before execution');
        }
        const currentPolicy = await query<{ policy_version: number }>(
          client,
          `SELECT COALESCE(
                    (SELECT policy_version FROM site_emergency_controls
                      WHERE tenant_id = $1 AND site_id = $2),
                    1
                  ) AS policy_version`,
          [envelope.tenantId, envelope.siteId],
        );
        if ((currentPolicy.rows[0]?.policy_version ?? 1) !== source.policy_version) {
          throw new SitePolicyDeniedError('AI proposal policy changed before execution');
        }
        let siteAutoEditingEnabled = false;
        try {
          await assertSiteFeatureEnabled(client, envelope, 'content.ai.auto');
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
        const evidence = stringEvidence(source.evidence);
        const facts = await query<{ value: unknown }>(
          client,
          `SELECT value FROM business_facts
            WHERE tenant_id = $1 AND site_id = $2
            ORDER BY stable_id
            LIMIT 200`,
          [envelope.tenantId, envelope.siteId],
        );
        const protectedFacts = facts.rows.flatMap(({ value }) => factLeaves(value)).slice(0, 500);
        return {
          actorId: source.requested_by,
          baseRevision: source.base_revision,
          currentValue,
          evidence,
          fieldId: source.stable_id,
          input: {
            currentValue,
            evidence,
            fieldId: source.stable_id,
            fieldPurpose: source.field_purpose,
          },
          materialId: source.material_id,
          mode,
          modelPrice: await modelPrice(client, modelAlias, providerModel, now),
          policyVersion: source.policy_version,
          protectedFacts,
        };
      },
    );
  }
}

async function modelPrice(
  client: TenantTransactionClient,
  modelAlias: string,
  providerModel: string,
  now: Date,
): Promise<ModelPrice> {
  const price = required(
    (
      await query<{
        effective_at: Date;
        input_usd_micros_per_million: number | string;
        model_alias: string;
        output_usd_micros_per_million: number | string;
        provider_model: string;
        version: number;
      }>(
        client,
        `SELECT model_alias, provider_model, version,
                input_usd_micros_per_million, output_usd_micros_per_million,
                effective_at
           FROM ai_model_prices
          WHERE model_alias = $1 AND provider_model = $2 AND effective_at <= $3
          ORDER BY effective_at DESC, version DESC
          LIMIT 1`,
        [modelAlias, providerModel, now],
      )
    ).rows[0],
    'A current model price matching the configured provider model is required',
  );
  return {
    effectiveAt: price.effective_at.toISOString(),
    inputUsdMicrosPerMillion: safeInteger(price.input_usd_micros_per_million),
    modelAlias: price.model_alias,
    outputUsdMicrosPerMillion: safeInteger(price.output_usd_micros_per_million),
    version: price.version,
  };
}

function stringEvidence(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 10 ||
    value.some((entry) => typeof entry !== 'string' || entry.length > 1_000)
  ) {
    throw new Error('AI proposal evidence is invalid');
  }
  return value as string[];
}

function factLeaves(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(factLeaves);
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(factLeaves);
  }
  return [];
}

function stringValue(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length > 10_000) throw new Error(message);
  return value;
}

function safeInteger(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('AI model price is invalid');
  return parsed;
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
