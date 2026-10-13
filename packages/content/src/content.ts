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
    const normalized = normalizeContentValue(policy, rawValue);
    if (input.actor === 'ai') {
      assertProtectedTokensPreserved(input.current[fieldId] ?? null, normalized);
    }
    content[fieldId] = normalized;
  }
  return { content, version: input.currentVersion + 1 };
}

export function normalizeContentValue(policy: FieldPolicy, value: ContentValue): ContentValue {
  assertBoundedValue(value, policy.id);
  if (policy.type === 'text') {
    if (typeof value !== 'string') throw new Error(`${policy.id} requires text`);
    return cleanText(value, policy.id, 20_000);
  }
  if (policy.type === 'richText') {
    if (typeof value !== 'string') throw new Error(`${policy.id} requires a string`);
    const sanitized = sanitizeHtml(value, {
      allowedAttributes: { a: ['href', 'rel', 'target'] },
      allowedSchemes: ['http', 'https', 'mailto'],
      allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'blockquote'],
      disallowedTagsMode: 'discard',
      transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }) },
    });
    if (sanitized.length > 100_000) throw new Error(`${policy.id} exceeds the rich-text limit`);
    return sanitized;
  }
  if (policy.type === 'link') {
    if (typeof value !== 'string') throw new Error(`${policy.id} requires a URL`);
    return safeLink(value, policy.id);
  }
  if (policy.type === 'visibility') {
    if (typeof value !== 'boolean') throw new Error(`${policy.id} requires a boolean`);
    return value;
  }
  if (policy.type === 'theme') {
    if (typeof value !== 'string' || !['default', 'light', 'dark'].includes(value)) {
      throw new Error(`${policy.id} requires an approved theme`);
    }
    return value;
  }
  if (policy.type === 'sectionOrder') {
    if (
      !Array.isArray(value) ||
      value.length > 50 ||
      value.some((entry) => typeof entry !== 'string' || !stableId.test(entry)) ||
      new Set(value).size !== value.length
    ) {
      throw new Error(`${policy.id} requires a unique stable-ID list`);
    }
    return [...value];
  }
  if (policy.type === 'cards') {
    if (
      !Array.isArray(value) ||
      value.length > 100 ||
      value.some((entry) => !isPlainRecord(entry))
    ) {
      throw new Error(`${policy.id} requires a bounded card list`);
    }
    validateStructuredLinks(value, policy.id);
    return structuredClone(value);
  }
  if (policy.type === 'metadata') {
    if (!isPlainRecord(value)) throw new Error(`${policy.id} requires metadata`);
    validateStructuredLinks(value, policy.id);
    return structuredClone(value);
  }
  if (policy.type === 'image') {
    if (typeof value === 'string') return safeAssetReference(value, policy.id);
    if (!isPlainRecord(value)) throw new Error(`${policy.id} requires an image reference`);
    const src = value.src;
    const alt = value.alt;
    if (typeof src !== 'string' || typeof alt !== 'string' || !alt.trim()) {
      throw new Error(`${policy.id} requires image src and alt text`);
    }
    const normalized: Record<string, ContentValue> = {
      ...value,
      alt: cleanText(alt, policy.id, 500),
      src: safeAssetReference(src, policy.id),
    };
    for (const key of ['thumbnail', 'small']) {
      const candidate = normalized[key];
      if (candidate !== undefined) {
        if (typeof candidate !== 'string')
          throw new Error(`${policy.id} has an invalid image variant`);
        normalized[key] = safeAssetReference(candidate, policy.id);
      }
    }
    return structuredClone(normalized);
  }
  return structuredClone(value);
}

const stableId = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

function cleanText(value: string, fieldId: string, maximum: number): string {
  if (value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new Error(`${fieldId} contains invalid text`);
  }
  return value;
}

function safeLink(value: string, fieldId: string): string {
  const trimmed = cleanText(value.trim(), fieldId, 2_048);
  const parsed = new URL(trimmed, 'https://local.invalid');
  if (!['http:', 'https:', 'mailto:', 'tel:', 'sms:'].includes(parsed.protocol)) {
    throw new Error(`${fieldId} uses an unsafe URL`);
  }
  if (
    ['tel:', 'sms:'].includes(parsed.protocol) &&
    !/^\+?[0-9(). -]{7,24}$/u.test(parsed.pathname)
  ) {
    throw new Error(`${fieldId} uses an invalid phone link`);
  }
  return trimmed;
}

function safeAssetReference(value: string, fieldId: string): string {
  const trimmed = cleanText(value.trim(), fieldId, 2_048);
  if (/^\/images\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(trimmed)) return trimmed;
  if (
    /^asset:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      trimmed,
    )
  )
    return trimmed;
  throw new Error(`${fieldId} uses an unapproved image reference`);
}

function validateStructuredLinks(value: ContentValue, fieldId: string, key = ''): void {
  if (typeof value === 'string') {
    if (/(?:href|url|link)$/iu.test(key)) safeLink(value, fieldId);
    if (/(?:image|thumbnail|src|small)$/iu.test(key)) safeAssetReference(value, fieldId);
    cleanText(value, fieldId, 20_000);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) validateStructuredLinks(entry, fieldId, key);
    return;
  }
  if (isPlainRecord(value)) {
    for (const [childKey, entry] of Object.entries(value)) {
      validateStructuredLinks(entry, fieldId, childKey);
    }
  }
}

function assertBoundedValue(value: ContentValue, fieldId: string): void {
  const serialized = JSON.stringify(value);
  if (serialized.length > 250_000) throw new Error(`${fieldId} exceeds the structured value limit`);
}

function isPlainRecord(value: unknown): value is Record<string, ContentValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
