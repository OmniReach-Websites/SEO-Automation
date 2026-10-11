import {
  estimateCostUsdMicros,
  type AiBudgetLedger,
  type BudgetReservation,
  type ModelPrice,
  type ProposalInput,
  type ProposalProvider,
} from '@omnireach/ai';
import { validateAiFieldMutation, type EffectiveAiMode } from '@omnireach/content';
import type { AiReviewCycleQuota, PlanQuotaReservation } from '@omnireach/tenant';

export { PostgresAiBudgetLedger } from './postgres-budget.ts';

export async function generateFieldProposal(options: {
  readonly budget: AiBudgetLedger;
  readonly input: ProposalInput;
  readonly mode: EffectiveAiMode;
  readonly modelPrice: ModelPrice;
  readonly now: Date;
  readonly provider: ProposalProvider;
  readonly protectedFacts: readonly string[];
  readonly reviewCycles: AiReviewCycleQuota;
  readonly siteId: string;
  readonly tenantId: string;
}): Promise<{
  readonly action: 'publish_candidate' | 'review';
  readonly replacement: string;
  readonly reservationId: string;
}> {
  if (options.mode === 'PROTECTED')
    throw new Error('Protected fields are rejected before provider admission');
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
    JSON.stringify(options.input).length,
    800,
  );
  try {
    budgetReservation = await options.budget.reserve({
      amountUsdMicros: estimate,
      expiresAt: new Date(options.now.getTime() + 10 * 60_000),
      now: options.now,
      siteId: options.siteId,
      tenantId: options.tenantId,
    });
    const result = await options.provider.generate(options.input);
    validateAiFieldMutation({
      after: result.output.replacement,
      before: options.input.currentValue,
      facts: options.protectedFacts,
      mode: options.mode,
    });
    const actual = Math.ceil(
      (result.usage.inputTokens * options.modelPrice.inputUsdMicrosPerMillion +
        result.usage.outputTokens * options.modelPrice.outputUsdMicrosPerMillion) /
        1_000_000,
    );
    await options.budget.reconcile(budgetReservation, actual, options.modelPrice.version);
    budgetFinalized = true;
    await options.reviewCycles.consume(reviewCycle);
    return {
      action: options.mode === 'AUTO' ? 'publish_candidate' : 'review',
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
    readonly publishCandidate: (replacement: string) => Promise<{ readonly artifactId: string }>;
    readonly raiseAlert: (safeMessage: string) => Promise<void>;
  },
): Promise<
  | { readonly action: 'published'; readonly artifactId: string }
  | { readonly action: 'review'; readonly replacement: string }
> {
  try {
    const proposal = await generateFieldProposal(options);
    if (proposal.action === 'review')
      return { action: 'review', replacement: proposal.replacement };
    const publication = await options.publishCandidate(proposal.replacement);
    return { action: 'published', artifactId: publication.artifactId };
  } catch (error) {
    if (options.mode === 'AUTO') {
      await options.raiseAlert(
        error instanceof Error
          ? `AI publication failed safely: ${error.message}`
          : 'AI publication failed safely',
      );
    }
    throw error;
  }
}
