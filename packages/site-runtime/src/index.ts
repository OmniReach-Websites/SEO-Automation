import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type SiteContent = Readonly<Record<string, unknown>>;

export function loadSiteContent(fallback: SiteContent = {}): SiteContent {
  const snapshotPath = process.env.OMNIREACH_CONTENT_SNAPSHOT;
  if (!snapshotPath) return structuredClone(fallback);
  const parsed = JSON.parse(readFileSync(resolve(snapshotPath), 'utf8')) as unknown;
  if (!isPlainRecord(parsed)) throw new Error('Content snapshot must be an object');
  const content = 'content' in parsed ? parsed.content : parsed;
  if (!isPlainRecord(content)) throw new Error('Content snapshot content must be an object');
  return structuredClone(content);
}

export function textField(content: SiteContent, id: string, fallback: string): string {
  const value = content[id];
  return typeof value === 'string' ? value : fallback;
}

export function stringListField(
  content: SiteContent,
  id: string,
  fallback: readonly string[],
): string[] {
  const value = content[id];
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? [...value]
    : [...fallback];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
