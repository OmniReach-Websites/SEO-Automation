import {
  PostgresAuthenticationRepository,
  type AuthenticationTransactionClient,
  type AuthenticationTransactionPool,
} from '@omnireach/auth';
import { describe, expect, it, vi } from 'vitest';

function poolFor(handler: (query: string, values?: unknown[]) => Promise<unknown>): {
  pool: AuthenticationTransactionPool;
} {
  const client: AuthenticationTransactionClient = {
    query: vi.fn(handler),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => client) } };
}

describe('PostgreSQL password-recovery issuance', () => {
  it('locks the identity and freshly rechecks eligibility before replacing its active token', async () => {
    const calls: string[] = [];
    const userId = '40000000-0000-4000-8000-000000000001';
    const { pool } = poolFor(async (sql) => {
      calls.push(sql.trimStart());
      if (sql.includes('SELECT DISTINCT u.id AS user_id')) {
        return { rows: [{ normalized_email: 'owner@example.test', user_id: userId }] };
      }
      if (sql.includes("SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE")) {
        return { rows: [{ id: userId }] };
      }
      if (sql.includes('SELECT u.id') && sql.includes('AND EXISTS')) {
        return { rows: [{ id: userId }] };
      }
      return { rows: [] };
    });

    await expect(
      new PostgresAuthenticationRepository(pool, 'admin.omnireach.test').createPasswordRecovery({
        expiresAt: new Date('2026-10-11T12:15:00.000Z'),
        host: 'admin.alpha.test',
        normalizedEmail: 'owner@example.test',
        tokenHash: 'a'.repeat(64),
        traceId: 'trace-password-recovery',
      }),
    ).resolves.toEqual({ normalizedEmail: 'owner@example.test' });

    const accountLockIndex = calls.findIndex((sql) =>
      sql.startsWith('SELECT id FROM users WHERE id = $1'),
    );
    const eligibilityIndex = calls.findIndex(
      (sql) => sql.startsWith('SELECT u.id') && sql.includes('AND EXISTS'),
    );
    const invalidateIndex = calls.findIndex((sql) =>
      sql.startsWith('UPDATE password_recovery_tokens'),
    );
    const insertIndex = calls.findIndex((sql) =>
      sql.startsWith('INSERT INTO password_recovery_tokens'),
    );
    expect(accountLockIndex).toBeGreaterThan(-1);
    expect(eligibilityIndex).toBeGreaterThan(accountLockIndex);
    expect(invalidateIndex).toBeGreaterThan(eligibilityIndex);
    expect(insertIndex).toBeGreaterThan(invalidateIndex);
    expect(calls.at(-1)).toBe('COMMIT');
  });

  it('does not replace a token when the fresh post-lock eligibility check fails', async () => {
    const calls: string[] = [];
    const userId = '40000000-0000-4000-8000-000000000001';
    const { pool } = poolFor(async (sql) => {
      calls.push(sql.trimStart());
      if (sql.includes('SELECT DISTINCT u.id AS user_id')) {
        return { rows: [{ normalized_email: 'owner@example.test', user_id: userId }] };
      }
      if (sql.includes("SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE")) {
        return { rows: [{ id: userId }] };
      }
      return { rows: [] };
    });

    await expect(
      new PostgresAuthenticationRepository(pool, 'admin.omnireach.test').createPasswordRecovery({
        expiresAt: new Date('2026-10-11T12:15:00.000Z'),
        host: 'admin.alpha.test',
        normalizedEmail: 'owner@example.test',
        tokenHash: 'a'.repeat(64),
        traceId: 'trace-password-recovery',
      }),
    ).resolves.toBeUndefined();

    expect(calls.some((sql) => sql.startsWith('UPDATE password_recovery_tokens'))).toBe(false);
    expect(calls.some((sql) => sql.startsWith('INSERT INTO password_recovery_tokens'))).toBe(false);
    expect(calls.at(-1)).toBe('COMMIT');
  });
});
