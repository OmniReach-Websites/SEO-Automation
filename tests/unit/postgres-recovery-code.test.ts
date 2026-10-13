import {
  PostgresAuthenticationRepository,
  type AuthenticationTransactionClient,
  type AuthenticationTransactionPool,
} from '@omnireach/auth';
import { describe, expect, it, vi } from 'vitest';

const now = new Date('2026-10-11T12:00:00.000Z');

function poolFor(handler: (query: string, values?: unknown[]) => Promise<unknown>): {
  client: AuthenticationTransactionClient;
  pool: AuthenticationTransactionPool;
} {
  const client = { query: vi.fn(handler), release: vi.fn() };
  return { client, pool: { connect: vi.fn(async () => client) } };
}

function recoverySessionInput() {
  return {
    assuranceLevel: 'recovery' as const,
    authenticationMethod: 'recovery_code' as const,
    expectedAuthStateVersion: '7',
    expectedPasswordHash: '$argon2id$fixture',
    expiresAt: new Date(now.getTime() + 15 * 60_000),
    host: 'admin.alpha.test',
    recoveryCodeHash: 'a'.repeat(64),
    recoveryRestricted: true,
    role: 'customer_owner' as const,
    siteId: '20000000-0000-4000-8000-000000000001',
    tenantId: '10000000-0000-4000-8000-000000000001',
    tokenHash: 'b'.repeat(64),
    traceId: 'trace-recovery-code',
    userId: '40000000-0000-4000-8000-000000000001',
    verifiedAt: now,
  };
}

describe('PostgreSQL recovery-code session issuance', () => {
  it('checks a recovery code without consuming it before the challenge is claimed', async () => {
    const calls: string[] = [];
    const { pool } = poolFor(async (sql) => {
      calls.push(sql);
      if (sql.includes('SELECT id FROM account_recovery_codes')) {
        return { rows: [{ id: 'recovery-code-a' }] };
      }
      return { rows: [] };
    });

    await expect(
      new PostgresAuthenticationRepository(pool, 'admin.omnireach.test').checkRecoveryCode({
        codeHash: 'a'.repeat(64),
        userId: '40000000-0000-4000-8000-000000000001',
      }),
    ).resolves.toBe(true);

    expect(calls.some((sql) => sql.includes('UPDATE account_recovery_codes'))).toBe(false);
    expect(calls.at(-1)).toBe('COMMIT');
  });

  it('consumes the code, revokes its siblings, and inserts the restricted session atomically', async () => {
    const calls: string[] = [];
    const { pool } = poolFor(async (sql) => {
      calls.push(sql.trimStart());
      if (sql.includes("SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE")) {
        return { rows: [{ id: recoverySessionInput().userId }] };
      }
      if (sql.includes('SELECT c.password_hash')) {
        return { rows: [{ password_hash: '$argon2id$fixture' }] };
      }
      if (sql.includes('SELECT m.role, policy.auth_state_version')) {
        return {
          rows: [
            {
              auth_state_version: '7',
              email_code_enabled: true,
              has_active_platform_membership: false,
              role: 'customer_owner',
              second_step_requirement: 'required',
            },
          ],
        };
      }
      if (sql.includes('UPDATE account_recovery_codes') && sql.includes('RETURNING id')) {
        return { rows: [{ id: 'recovery-code-a', set_version: 4 }] };
      }
      return { rows: [] };
    });

    await expect(
      new PostgresAuthenticationRepository(pool, 'admin.omnireach.test').createSession(
        recoverySessionInput(),
      ),
    ).resolves.toBe(true);

    const consumeIndex = calls.findIndex(
      (sql) => sql.startsWith('UPDATE account_recovery_codes') && sql.includes('RETURNING id'),
    );
    const siblingIndex = calls.findIndex(
      (sql) => sql.startsWith('UPDATE account_recovery_codes') && sql.includes('id <> $3'),
    );
    const versionIndex = calls.findIndex((sql) =>
      sql.startsWith('UPDATE account_authentication_policies'),
    );
    const sessionIndex = calls.findIndex((sql) => sql.startsWith('INSERT INTO sessions'));
    const commitIndex = calls.indexOf('COMMIT');
    const accountLockIndex = calls.findIndex((sql) =>
      sql.startsWith('SELECT id FROM users WHERE id = $1'),
    );
    const scopeLock = calls.find((sql) => sql.startsWith('SELECT m.role'));
    expect(accountLockIndex).toBeGreaterThan(-1);
    expect(accountLockIndex).toBeLessThan(consumeIndex);
    expect(scopeLock).toContain('FOR SHARE OF m, policy');
    expect(consumeIndex).toBeGreaterThan(-1);
    expect(siblingIndex).toBeGreaterThan(consumeIndex);
    expect(versionIndex).toBeGreaterThan(siblingIndex);
    expect(sessionIndex).toBeGreaterThan(versionIndex);
    expect(commitIndex).toBeGreaterThan(sessionIndex);
  });

  it('rolls back code consumption when restricted session insertion fails', async () => {
    const calls: string[] = [];
    const { pool } = poolFor(async (sql) => {
      calls.push(sql.trimStart());
      if (sql.includes("SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE")) {
        return { rows: [{ id: recoverySessionInput().userId }] };
      }
      if (sql.includes('SELECT c.password_hash')) {
        return { rows: [{ password_hash: '$argon2id$fixture' }] };
      }
      if (sql.includes('SELECT m.role, policy.auth_state_version')) {
        return {
          rows: [
            {
              auth_state_version: '7',
              email_code_enabled: true,
              has_active_platform_membership: false,
              role: 'customer_owner',
              second_step_requirement: 'required',
            },
          ],
        };
      }
      if (sql.includes('UPDATE account_recovery_codes') && sql.includes('RETURNING id')) {
        return { rows: [{ id: 'recovery-code-a', set_version: 4 }] };
      }
      if (sql.includes('INSERT INTO sessions')) throw new Error('injected session failure');
      return { rows: [] };
    });

    await expect(
      new PostgresAuthenticationRepository(pool, 'admin.omnireach.test').createSession(
        recoverySessionInput(),
      ),
    ).rejects.toThrow('injected session failure');
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
  });

  it('retries a deadlocked recovery transaction and then completes cleanly', async () => {
    let accountLockAttempts = 0;
    const calls: string[] = [];
    const { pool } = poolFor(async (sql) => {
      calls.push(sql.trimStart());
      if (sql.includes("SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE")) {
        accountLockAttempts += 1;
        if (accountLockAttempts === 1) {
          throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
        }
        return { rows: [{ id: recoverySessionInput().userId }] };
      }
      if (sql.includes('SELECT c.password_hash')) {
        return { rows: [{ password_hash: '$argon2id$fixture' }] };
      }
      if (sql.includes('SELECT m.role, policy.auth_state_version')) {
        return {
          rows: [
            {
              auth_state_version: '7',
              email_code_enabled: true,
              has_active_platform_membership: false,
              role: 'customer_owner',
              second_step_requirement: 'required',
            },
          ],
        };
      }
      if (sql.includes('UPDATE account_recovery_codes') && sql.includes('RETURNING id')) {
        return { rows: [{ id: 'recovery-code-a', set_version: 4 }] };
      }
      return { rows: [] };
    });

    await expect(
      new PostgresAuthenticationRepository(pool, 'admin.omnireach.test').createSession(
        recoverySessionInput(),
      ),
    ).resolves.toBe(true);

    expect(accountLockAttempts).toBe(2);
    expect(calls.filter((sql) => sql === 'ROLLBACK')).toHaveLength(1);
    expect(calls.filter((sql) => sql === 'COMMIT')).toHaveLength(1);
  });
});
