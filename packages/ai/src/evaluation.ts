import { createHash } from 'node:crypto';

import { proposalSchema, type ProposalInput, type ProposalOutput } from './provider.ts';

export type ProposalViolationCode =
  | 'duplicate_content'
  | 'prohibited_claim'
  | 'restricted_fact_changed'
  | 'seo_length_regression'
  | 'unsafe_html'
  | 'unsafe_link'
  | 'unsupported_claim';

export interface ProposalEvaluation {
  readonly inputHash: string;
  readonly passed: boolean;
  readonly schemaVersion: 1;
  readonly violations: readonly {
    readonly code: ProposalViolationCode;
    readonly message: string;
  }[];
}

/**
 * Deterministic, provider-independent safety evaluation. It intentionally records only
 * a hash of the sanitized inputs so evidence and customer copy do not leak into logs.
 */
export function evaluateProposal(input: {
  readonly proposal: ProposalOutput;
  readonly request: ProposalInput;
  readonly protectedFacts: readonly string[];
}): ProposalEvaluation {
  const proposal = proposalSchema.parse(input.proposal);
  const violations: ProposalEvaluation['violations'][number][] = [];
  const before = normalize(input.request.currentValue);
  const after = normalize(proposal.replacement);
  if (before === after) {
    violations.push({
      code: 'duplicate_content',
      message: 'The proposal does not change the field.',
    });
  }
  if (hasRepeatedSentence(proposal.replacement)) {
    violations.push({
      code: 'duplicate_content',
      message: 'The proposal repeats substantially identical sentences.',
    });
  }
  if (
    /<\/?(?:script|iframe|object|embed|style|form)\b|\bon\w+\s*=|javascript:|data:text\/html/iu.test(
      proposal.replacement,
    )
  ) {
    violations.push({ code: 'unsafe_html', message: 'Executable or unsafe HTML is forbidden.' });
  }
  if (/\bhttps?:\/\/|\bwww\./iu.test(proposal.replacement)) {
    violations.push({ code: 'unsafe_link', message: 'AI proposals may not introduce links.' });
  }
  if (
    /\b(?:guaranteed?|#\s*1|number\s+one|best\s+in|100\s*%|risk[- ]free|instant\s+results?)\b/iu.test(
      proposal.replacement,
    )
  ) {
    violations.push({
      code: 'prohibited_claim',
      message: 'The proposal contains an unapproved superlative or guarantee.',
    });
  }
  for (const fact of input.protectedFacts.filter(Boolean)) {
    if (occurrences(before, normalize(fact)) !== occurrences(after, normalize(fact))) {
      violations.push({
        code: 'restricted_fact_changed',
        message: 'A protected business fact was added, removed, or duplicated.',
      });
      break;
    }
  }
  const purpose = input.request.fieldPurpose.toLowerCase();
  const length = [...proposal.replacement.trim()].length;
  if (
    (purpose.includes('title') && length > 60) ||
    (purpose.includes('description') && length > 160)
  ) {
    violations.push({
      code: 'seo_length_regression',
      message: 'The proposal exceeds the configured SEO field length.',
    });
  }
  const evidence = normalize(
    [input.request.currentValue, ...input.request.evidence, ...input.protectedFacts].join(' '),
  );
  if (proposal.supportedClaims.some((claim) => !evidence.includes(normalize(claim)))) {
    violations.push({
      code: 'unsupported_claim',
      message: 'A declared claim is not present in the supplied evidence.',
    });
  }
  return {
    inputHash: createHash('sha256')
      .update(
        JSON.stringify({
          evidence: input.request.evidence.map((item) =>
            createHash('sha256').update(item).digest('hex'),
          ),
          fieldId: input.request.fieldId,
          fieldPurpose: input.request.fieldPurpose,
          protectedFacts: input.protectedFacts.map((item) =>
            createHash('sha256').update(item).digest('hex'),
          ),
        }),
      )
      .digest('hex'),
    passed: violations.length === 0,
    schemaVersion: 1,
    violations,
  };
}

export class ProposalEvaluationError extends Error {
  override readonly name = 'ProposalEvaluationError';

  constructor(readonly evaluation: ProposalEvaluation) {
    super(
      `AI proposal failed deterministic evaluation: ${evaluation.violations.map((item) => item.code).join(', ')}`,
    );
  }
}

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function hasRepeatedSentence(value: string): boolean {
  const sentences = value
    .split(/[.!?]+/u)
    .map(normalize)
    .filter((sentence) => sentence.length >= 20);
  return new Set(sentences).size !== sentences.length;
}
