import sanitizeHtml from 'sanitize-html';

export type ContentValue =
  boolean | number | string | null | ContentValue[] | { [key: string]: ContentValue };
export type ContentRecord = Record<string, ContentValue>;

export interface FieldPolicy {
  aiMode: 'auto' | 'suggestion' | 'disabled';
  id: string;
  protected: boolean;
  type: string;
}

export class RevisionConflictError extends Error {
  override readonly name = 'RevisionConflictError';
}

export class ProtectedFieldError extends Error {
  override readonly name = 'ProtectedFieldError';
}

export class PublicationPendingError extends Error {
  override readonly name = 'PublicationPendingError';
}

export function updateDraft(input: {
  actor: 'human' | 'ai';
  current: ContentRecord;
  currentVersion: number;
  expectedVersion: number;
  fieldPolicies: ReadonlyMap<string, FieldPolicy>;
  patch: ContentRecord;
}): { content: ContentRecord; version: number } {
  if (input.expectedVersion !== input.currentVersion)
    throw new RevisionConflictError('Draft revision is stale');
  const content = structuredClone(input.current);
  for (const [fieldId, rawValue] of Object.entries(input.patch)) {
    const policy = input.fieldPolicies.get(fieldId);
    if (!policy) throw new Error(`Unknown field: ${fieldId}`);
    if (policy.protected || (input.actor === 'ai' && policy.aiMode !== 'auto')) {
      throw new ProtectedFieldError(`Field cannot be modified by this path: ${fieldId}`);
    }
    const normalized = normalizeValue(policy, rawValue);
    if (input.actor === 'ai') {
      assertProtectedTokensPreserved(input.current[fieldId] ?? null, normalized);
    }
    content[fieldId] = normalized;
  }
  return { content, version: input.currentVersion + 1 };
}

function normalizeValue(policy: FieldPolicy, value: ContentValue): ContentValue {
  if (policy.type === 'richText') {
    if (typeof value !== 'string') throw new Error(`${policy.id} requires a string`);
    return sanitizeHtml(value, {
      allowedAttributes: { a: ['href', 'rel', 'target'] },
      allowedSchemes: ['http', 'https', 'mailto'],
      allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'blockquote'],
      disallowedTagsMode: 'discard',
      transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }) },
    });
  }
  if (policy.type === 'link') {
    if (typeof value !== 'string') throw new Error(`${policy.id} requires a URL`);
    const parsed = new URL(value, 'https://local.invalid');
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol))
      throw new Error(`${policy.id} uses an unsafe URL`);
  }
  return structuredClone(value);
}

const factToken = /\{\{fact:([a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)\}\}/gu;

export function extractFactTokens(value: ContentValue): string[] {
  const serialized = JSON.stringify(value);
  return [...serialized.matchAll(factToken)].map((match) => match[1] ?? '').sort();
}

export function assertProtectedTokensPreserved(before: ContentValue, after: ContentValue): void {
  if (JSON.stringify(extractFactTokens(before)) !== JSON.stringify(extractFactTokens(after))) {
    throw new ProtectedFieldError('Protected fact tokens changed');
  }
}

export type ProposalState = 'pending' | 'approved' | 'rejected' | 'applied' | 'stale';

const transitions: Readonly<Record<ProposalState, ReadonlySet<ProposalState>>> = {
  pending: new Set(['approved', 'rejected', 'stale']),
  approved: new Set(['applied', 'stale']),
  rejected: new Set(),
  applied: new Set(),
  stale: new Set(),
};

export function transitionProposal(current: ProposalState, next: ProposalState): ProposalState {
  if (!transitions[current].has(next))
    throw new Error(`Invalid proposal transition: ${current} -> ${next}`);
  return next;
}

export interface ImmutableRevision {
  content: ContentRecord;
  createdAt: string;
  number: number;
  restoredFrom?: number;
}

export function restoreRevision(
  history: readonly ImmutableRevision[],
  number: number,
  now: string,
): ImmutableRevision {
  const target = history.find((revision) => revision.number === number);
  if (!target) throw new Error(`Revision does not exist: ${number}`);
  return {
    content: structuredClone(target.content),
    createdAt: now,
    number: Math.max(...history.map((revision) => revision.number)) + 1,
    restoredFrom: number,
  };
}
