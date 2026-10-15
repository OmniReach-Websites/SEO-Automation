export const planCodes = ['STARTER', 'GROWTH', 'PRO', 'ELITE'] as const;

export type PlanCode = (typeof planCodes)[number];
export type CommercialStatus = 'approved' | 'proposal';
export type CapabilityReadiness = 'deployable' | 'planned' | 'tested';
export type PlanQuotaKey =
  'aiReviewCyclesPerMonth' | 'businessLocations' | 'customerSeats' | 'standardPages';

export interface PlanDefinition {
  readonly aiReviewCyclesPerMonth: number;
  readonly businessLocations: number;
  readonly code: PlanCode;
  readonly commercialStatus: CommercialStatus;
  readonly currency: 'USD';
  readonly customerSeats: number;
  readonly monthlyPriceCents: number;
  readonly pendingInvitationsCountAsSeats: boolean;
  readonly seoAuditIntervalHours: 24 | 168;
  readonly standardPages: number;
  readonly version: number;
}

export const selectedPlanProposals: Readonly<Record<PlanCode, PlanDefinition>> = {
  STARTER: proposal('STARTER', 50_000, 2, 5, 168, 2),
  GROWTH: proposal('GROWTH', 100_000, 5, 10, 24, 8),
  PRO: proposal('PRO', 150_000, 10, 20, 24, 16),
  ELITE: proposal('ELITE', 200_000, 20, 30, 24, 30),
};

export const excludedPlanFeatureKeys = new Set([
  'ai.answer-sampling',
  'automation.content-expansion',
  'automation.google-business-profile',
  'automation.reputation-management',
  'automation.social-publishing',
  'commerce.payment-automation',
  'experiments.conversion-optimization',
  'seo.competitor-monitoring',
  'site.advanced-transactional',
]);

export class PlanQuotaExceededError extends Error {
  override readonly name = 'PlanQuotaExceededError';

  constructor(
    readonly quota: PlanQuotaKey,
    readonly limit: number,
  ) {
    super(`Plan quota exceeded: ${quota} (${limit})`);
  }
}

export function assertQuotaAvailable(
  plan: PlanDefinition,
  quota: PlanQuotaKey,
  used: number,
  requested = 1,
): void {
  if (![used, requested].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error('Quota usage must use non-negative safe integers');
  }
  if (used + requested > plan[quota]) throw new PlanQuotaExceededError(quota, plan[quota]);
}

export function assertPlanFeatureAllowed(featureKey: string): void {
  if (excludedPlanFeatureKeys.has(featureKey)) {
    throw new Error(`Feature is excluded from subscription entitlements: ${featureKey}`);
  }
}

export function assertCapabilityCanBeSold(
  capability: string,
  readiness: CapabilityReadiness,
): void {
  if (readiness !== 'deployable') {
    throw new Error(`Capability is not deployable and cannot be sold: ${capability}`);
  }
}

export function defaultGraceEndsAt(pastDueAt: Date, graceDays = 14): Date {
  if (!Number.isSafeInteger(graceDays) || graceDays < 1 || graceDays > 90) {
    throw new Error('Grace period must be between 1 and 90 days');
  }
  return new Date(pastDueAt.getTime() + graceDays * 24 * 60 * 60 * 1_000);
}

export function isSeoAuditDue(
  plan: PlanDefinition,
  lastCompletedAt: Date | undefined,
  now: Date,
): boolean {
  if (!lastCompletedAt) return true;
  return now.getTime() - lastCompletedAt.getTime() >= plan.seoAuditIntervalHours * 60 * 60 * 1_000;
}

export function planDefinition(code: string): PlanDefinition {
  if (!planCodes.includes(code as PlanCode)) throw new Error(`Unknown plan code: ${code}`);
  return selectedPlanProposals[code as PlanCode];
}

function proposal(
  code: PlanCode,
  monthlyPriceCents: number,
  customerSeats: number,
  standardPages: number,
  seoAuditIntervalHours: 24 | 168,
  aiReviewCyclesPerMonth: number,
): PlanDefinition {
  return {
    aiReviewCyclesPerMonth,
    businessLocations: 1,
    code,
    commercialStatus: 'approved',
    currency: 'USD',
    customerSeats,
    monthlyPriceCents,
    pendingInvitationsCountAsSeats: true,
    seoAuditIntervalHours,
    standardPages,
    version: 1,
  };
}
