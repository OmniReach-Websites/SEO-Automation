import {
  estimateCostUsdMicros,
  evaluateProposal,
  ProposalEvaluationError,
  type AiBudgetLedger,
  type BudgetReservation,
  type ModelPrice,
  type ProposalInput,
  type ProposalProvider,
} from '@omnireach/ai';
import { validateAiFieldMutation, type EffectiveAiMode } from '@omnireach/content';
import type { AiReviewCycleQuota, PlanQuotaReservation } from '@omnireach/tenant';

export { PostgresAiBudgetLedger } from './postgres-budget.ts';
export { PostgresAiProposalJobLoader, type RehydratedAiProposalJob } from './postgres-job.ts';
export {
  PostgresAiProposalStager,
  type AiProposalStageContext,
  type AiProposalStageInput,
} from './postgres-proposals.ts';

export async function generateFieldProposal(options: {
  readonly budget: AiBudgetLedger;
  readonly budgetCapUsdMicros?: number;
  readonly input: ProposalInput;
  readonly mode: EffectiveAiMode;
  readonly maxOutputTokens?: number;
  readonly modelPrice: ModelPrice;
  readonly now: Date;
  readonly provider: ProposalProvider;
  readonly providerEnabled: boolean;
  readonly protectedFacts: readonly string[];
  readonly platformBudgetCapUsdMicros?: number;
  readonly reviewCycles: AiReviewCycleQuota;
  readonly siteId: string;
  readonly tenantId: string;
}): Promise<{
  readonly action: 'draft_candidate' | 'review';
  readonly costUsdMicros: number;
  readonly evaluation: ReturnType<typeof evaluateProposal>;
  readonly latencyMs: number;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly promptVersion: number;
  readonly providerRequestHash?: string;
  readonly rationale: string;
  readonly replacement: string;
  readonly reservationId: string;
}> {
  if (!options.providerEnabled)
    throw new Error('AI provider is disabled by the centralized provider gate');
  if (options.mode === 'PROTECTED')
    throw new Error('Protected fields are rejected before provider admission');
  const maxOutputTokens = options.maxOutputTokens ?? 800;
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 20_000) {
    throw new Error('AI maximum output tokens are invalid');
  }
  const reviewCycle = await options.reviewCycles.reserve({
    expiresAt: new Date(options.now.getTime() + 10 * 60_000),
    now: options.now,
    siteId: options.siteId,
    tenantId: options.tenantId,
  });
  let budgetReservation: BudgetReservation | undefined;
  let budgetFinalized = false;
  const estimate = estimateCostUsdMicros(
    options.modelPrice,
    Buffer.byteLength(JSON.stringify(options.input), 'utf8'),
    maxOutputTokens,
  );
  try {
    budgetReservation = await options.budget.reserve({
      amountUsdMicros: estimate,
      ...(options.budgetCapUsdMicros !== undefined
        ? { capUsdMicros: options.budgetCapUsdMicros }
        : {}),
      expiresAt: new Date(options.now.getTime() + 10 * 60_000),
      now: options.now,
      ...(options.platformBudgetCapUsdMicros !== undefined
        ? { platformCapUsdMicros: options.platformBudgetCapUsdMicros }
        : {}),
      siteId: options.siteId,
      tenantId: options.tenantId,
    });
    const result = await options.provider.generate(options.input);
    const actual = Math.ceil(
      (result.usage.inputTokens * options.modelPrice.inputUsdMicrosPerMillion +
        result.usage.outputTokens * options.modelPrice.outputUsdMicrosPerMillion) /
        1_000_000,
    );
    // Provider usage is incurred before local safety evaluation. Reconcile it
    // immediately so rejected proposals remain billed and auditable even though
    // they are never staged or applied.
    await options.budget.reconcile(budgetReservation, actual, options.modelPrice.version);
    budgetFinalized = true;
    const evaluation = evaluateProposal({
      proposal: result.output,
      protectedFacts: options.protectedFacts,
      request: options.input,
    });
    if (!evaluation.passed) throw new ProposalEvaluationError(evaluation);
    validateAiFieldMutation({
      after: result.output.replacement,
      before: options.input.currentValue,
      facts: options.protectedFacts,
      mode: options.mode,
    });
    await options.reviewCycles.consume(reviewCycle);
    return {
      action: options.mode === 'AUTO' ? 'draft_candidate' : 'review',
      costUsdMicros: actual,
      evaluation,
      latencyMs: result.latencyMs,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      promptVersion: result.promptVersion,
      ...(result.providerRequestHash ? { providerRequestHash: result.providerRequestHash } : {}),
      rationale: result.output.rationale,
      replacement: result.output.replacement,
      reservationId: budgetReservation.id,
    };
  } catch (error) {
    if (budgetReservation && !budgetFinalized) await options.budget.release(budgetReservation);
    await releaseReviewCycle(options.reviewCycles, reviewCycle);
    throw error;
  }
}

async function releaseReviewCycle(
  quota: AiReviewCycleQuota,
  reservation: PlanQuotaReservation,
): Promise<void> {
  try {
    await quota.release(reservation);
  } catch {
    // A successful consume before a later response-path failure must not be reversed.
  }
}

export async function executeAiAutomation(
  options: Parameters<typeof generateFieldProposal>[0] & {
    readonly stageProposal: (proposal: {
      readonly costUsdMicros: number;
      readonly evaluation: ReturnType<typeof evaluateProposal>;
      readonly latencyMs: number;
      readonly mode: 'AUTO' | 'SUGGEST';
      readonly model: string;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly promptVersion: number;
      readonly providerRequestHash?: string;
      readonly rationale: string;
      readonly replacement: string;
    }) => Promise<{ readonly draftId?: string; readonly proposalId: string }>;
    readonly raiseAlert: (safeMessage: string) => Promise<void>;
  },
): Promise<
  | { readonly action: 'draft_staged'; readonly draftId?: string; readonly proposalId: string }
  | { readonly action: 'review_staged'; readonly proposalId: string }
> {
  try {
    const proposal = await generateFieldProposal(options);
    const staged = await options.stageProposal({
      costUsdMicros: proposal.costUsdMicros,
      evaluation: proposal.evaluation,
      latencyMs: proposal.latencyMs,
      mode: options.mode === 'AUTO' ? 'AUTO' : 'SUGGEST',
      model: proposal.model,
      inputTokens: proposal.inputTokens,
      outputTokens: proposal.outputTokens,
      promptVersion: proposal.promptVersion,
      ...(proposal.providerRequestHash
        ? { providerRequestHash: proposal.providerRequestHash }
        : {}),
      rationale: proposal.rationale,
      replacement: proposal.replacement,
    });
    return { action: 'review_staged', proposalId: staged.proposalId };
  } catch (error) {
    if (options.mode === 'AUTO') {
      await options.raiseAlert('AI proposal failed safely; live content was unchanged.');
    }
    throw error;
  }
}
