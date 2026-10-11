import { createOwnerBootstrapToken, type OwnerBootstrapClient } from '@omnireach/database';
import { describe, expect, it } from 'vitest';

function client(responses: Record<string, Record<string, unknown>[]> = {}): OwnerBootstrapClient & {
  queries: { text: string; values?: unknown[] }[];
} {
  const queries: { text: string; values?: unknown[] }[] = [];
  return {
    queries,
    async query<T extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, ...(values ? { values } : {}) });
      const key = Object.keys(responses).find((candidate) => text.includes(candidate));
      return { rows: (key ? responses[key] : []) as T[] };
    },
  };
}

describe('owner bootstrap token creation', () => {
  it('stores only a digest and creates an expiring token under a transaction lock', async () => {
    const db = client({
      'count(*)': [{ count: '0' }],
      'FROM owner_bootstrap': [],
    });
    const now = new Date('2026-10-10T12:00:00.000Z');
    const result = await createOwnerBootstrapToken(db, now);
    expect(result.expiresAt).toEqual(new Date('2026-10-10T12:30:00.000Z'));
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const insert = db.queries.find((query) => query.text.includes('INSERT INTO owner_bootstrap'));
    expect(insert?.values?.[0]).toMatch(/^[a-f0-9]{64}$/u);
    expect(insert?.values?.[0]).not.toBe(result.token);
    expect(db.queries.some((query) => query.text.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(db.queries.at(-1)?.text).toBe('COMMIT');
  });

  it('refuses to reopen bootstrap after a platform membership exists', async () => {
    const db = client({ 'count(*)': [{ count: '1' }] });
    await expect(createOwnerBootstrapToken(db)).rejects.toThrow('permanently closed');
    expect(db.queries.at(-1)?.text).toBe('ROLLBACK');
    expect(db.queries.some((query) => query.text.includes('INSERT INTO owner_bootstrap'))).toBe(
      false,
    );
  });
});
