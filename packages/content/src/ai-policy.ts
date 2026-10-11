import type { ContentValue, FieldPolicy } from './content.ts';

export type EffectiveAiMode = 'AUTO' | 'PROTECTED' | 'SUGGEST';
export interface AiPolicyContext {
  readonly autonomousChangesStopped: boolean;
  readonly field: FieldPolicy;
  readonly globalGenerationEnabled: boolean;
  readonly policyVersion: number;
  readonly siteAutoEditingEnabled: boolean;
}

export function effectiveAiMode(context: AiPolicyContext): EffectiveAiMode {
  if (context.field.protected || !context.globalGenerationEnabled) return 'PROTECTED';
  if (
    context.field.aiMode === 'auto' &&
    context.siteAutoEditingEnabled &&
    !context.autonomousChangesStopped
  )
    return 'AUTO';
  return 'SUGGEST';
}

export function validateAiFieldMutation(input: {
  readonly after: ContentValue;
  readonly before: ContentValue;
  readonly facts: readonly string[];
  readonly mode: EffectiveAiMode;
}): void {
  if (input.mode === 'PROTECTED')
    throw new Error('AI generation and mutation are forbidden for protected fields');
  const before = canonicalize(input.before);
  const after = canonicalize(input.after);
  for (const rawFact of input.facts) {
    const fact = canonicalize(rawFact);
    if (fact.length >= 3 && countOccurrences(before, fact) !== countOccurrences(after, fact))
      throw new Error(
        'AI output changed, removed, introduced, or duplicated protected business information',
      );
  }
}

export interface ReviewableProposal {
  readonly baseRevision: number;
  readonly expiresAt: string;
  readonly fieldId: string;
  readonly policyVersion: number;
  readonly state: 'approved' | 'pending' | 'rejected' | 'stale';
}
export function authorizeProposalAcceptance(input: {
  readonly canPublish: boolean;
  readonly currentPolicyVersion: number;
  readonly currentRevision: number;
  readonly now: Date;
  readonly proposal: ReviewableProposal;
}): 'approved' {
  if (input.proposal.state !== 'pending') throw new Error('Proposal is not pending');
  if (input.proposal.baseRevision !== input.currentRevision) throw new Error('Proposal is stale');
  if (input.proposal.policyVersion !== input.currentPolicyVersion)
    throw new Error('Proposal policy is stale');
  if (new Date(input.proposal.expiresAt) <= input.now) throw new Error('Proposal expired');
  if (!input.canPublish) throw new Error('Current actor lacks proposal publication permission');
  return 'approved';
}

function canonicalize(value: ContentValue | string): string {
  return (typeof value === 'string' ? value : JSON.stringify(value))
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
function countOccurrences(value: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while ((offset = value.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
}
