import { createHash } from 'node:crypto';

export interface PublicationSnapshot {
  assets?: PublicationAsset[];
  assetManifestHash: string;
  codeSha: string;
  content: unknown;
  contentRevision: number;
  contractHash: string;
  contractVersion: string;
  hash: string;
  facts?: unknown;
  siteId: string;
}

export interface PublicationAsset {
  checksum: string;
  id: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  storageKey: string;
}

export function createPublicationSnapshot(
  input: Omit<PublicationSnapshot, 'hash'>,
): PublicationSnapshot {
  const canonical = stableStringify(input);
  return { ...structuredClone(input), hash: createHash('sha256').update(canonical).digest('hex') };
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
