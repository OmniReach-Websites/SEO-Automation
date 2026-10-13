import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type SiteContent = Readonly<Record<string, unknown>>;

export interface SiteSnapshot {
  readonly assets: Readonly<Record<string, string>>;
  readonly content: SiteContent;
  readonly facts: SiteContent;
}

export function loadSiteSnapshot(fallback: SiteContent = {}): SiteSnapshot {
  const snapshotPath = process.env.OMNIREACH_CONTENT_SNAPSHOT;
  if (!snapshotPath) return { assets: {}, content: structuredClone(fallback), facts: {} };
  const parsed = JSON.parse(readFileSync(resolve(snapshotPath), 'utf8')) as unknown;
  if (!isPlainRecord(parsed)) throw new Error('Content snapshot must be an object');
  const content = 'content' in parsed ? parsed.content : parsed;
  if (!isPlainRecord(content)) throw new Error('Content snapshot content must be an object');
  const rawFacts = 'facts' in parsed ? parsed.facts : {};
  if (!isPlainRecord(rawFacts)) throw new Error('Content snapshot facts must be an object');
  const facts = Object.fromEntries(
    Object.entries(rawFacts).map(([id, entry]) => [
      id,
      isPlainRecord(entry) && Object.hasOwn(entry, 'value')
        ? structuredClone(entry.value)
        : structuredClone(entry),
    ]),
  );
  const rawAssets = 'assets' in parsed ? parsed.assets : [];
  if (!Array.isArray(rawAssets)) throw new Error('Content snapshot assets must be an array');
  const assets = Object.fromEntries(
    rawAssets.map((entry) => {
      if (!isPlainRecord(entry) || typeof entry.id !== 'string' || typeof entry.mime !== 'string') {
        throw new Error('Content snapshot asset is invalid');
      }
      const extension = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
      }[entry.mime];
      if (!extension || !/^[0-9a-f-]{36}$/iu.test(entry.id)) {
        throw new Error('Content snapshot asset identity is invalid');
      }
      return [entry.id, `/managed-assets/${entry.id}.${extension}`];
    }),
  );
  return { assets, content: structuredClone(content), facts };
}

export function loadSiteContent(fallback: SiteContent = {}): SiteContent {
  return loadSiteSnapshot(fallback).content;
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

export function booleanField(content: SiteContent, id: string, fallback: boolean): boolean {
  const value = content[id];
  return typeof value === 'boolean' ? value : fallback;
}

export function objectField<T>(
  content: SiteContent,
  id: string,
  fallback: T,
  validate: (value: unknown) => value is T,
): T {
  const value = content[id];
  return validate(value) ? structuredClone(value) : structuredClone(fallback);
}

export function arrayField<T>(
  content: SiteContent,
  id: string,
  fallback: readonly T[],
  validate: (value: unknown) => value is T,
): T[] {
  const value = content[id];
  return Array.isArray(value) && value.every(validate)
    ? structuredClone(value)
    : fallback.map((entry) => structuredClone(entry));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
