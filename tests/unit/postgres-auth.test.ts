import {
  PostgresAuthenticationRepository,
  type AuthenticationTransactionClient,
  type AuthenticationTransactionPool,
} from '@omnireach/auth';
import { describe, expect, it, vi } from 'vitest';

function poolFor(handler: (query: string, values?: unknown[]) => Promise<unknown>): {
  client: AuthenticationTransactionClient;
  pool: AuthenticationTransactionPool;
} {
  const client = { query: vi.fn(handler), release: vi.fn() };
  return { client, pool: { connect: vi.fn(async () => client) } };
}

describe('PostgreSQL authentication repository', () => {
  it('atomically rejects reuse of an accepted TOTP counter', async () => {
    let accepted = false;
    const { client, pool } = poolFor(async (sql) => {
      if (sql.includes('UPDATE mfa_factors') && sql.includes('last_used_counter')) {
        if (accepted) return { rows: [] };
        accepted = true;
        return { rows: [{ id: 'factor-a' }] };
      }
      return { rows: [] };
    });
    const repository = new PostgresAuthenticationRepository(pool, 'admin.omnireach.test');

    await expect(
      repository.consumeTotpCounter({ counter: 59_700_000, factorId: 'factor-a' }),
    ).resolves.toBe(true);
    await expect(
      repository.consumeTotpCounter({ counter: 59_700_000, factorId: 'factor-a' }),
    ).resolves.toBe(false);
    const updates = vi
      .mocked(client.query)
      .mock.calls.filter(([sql]) => sql.includes('UPDATE mfa_factors'));
    expect(updates).toHaveLength(2);
    expect(updates[0]?.[1]).toEqual([59_700_000, 'factor-a']);
  });

  it('accepts a new-user invitation, membership, and audit in one exact-host transaction', async () => {
    const calls: string[] = [];
    const { pool } = poolFor(async (sql) => {
      calls.push(sql);
      if (sql.includes('SELECT p.customer_seat_limit')) {
        return {
          rows: [
            {
              active_memberships: 0,
              customer_seat_limit: 2,
              existing_membership: false,
              pending_other: 0,
            },
          ],
        };
      }
      if (sql.includes('FROM customer_invitations')) {
        return {
          rows: [
            {
              id: '70000000-0000-4000-8000-000000000001',
              normalized_email: 'owner@example.test',
              role: 'customer_owner',
              site_id: '20000000-0000-4000-8000-000000000001',
              tenant_id: '10000000-0000-4000-8000-000000000001',
            },
          ],
        };
      }
      if (sql.includes('SELECT id FROM users')) return { rows: [] };
      if (sql.includes('INSERT INTO users')) {
        return { rows: [{ id: '40000000-0000-4000-8000-000000000001' }] };
      }
      if (sql.includes('FROM account_authentication_policies policy')) {
        return {
          rows: [
            {
              email_code_enabled: false,
              has_recovery_codes: false,
              preferred_method: null,
              second_step_requirement: 'optional',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const result = await new PostgresAuthenticationRepository(
      pool,
      'admin.omnireach.test',
    ).acceptInvitation({
      displayName: 'Invited Owner',
      host: 'ADMIN.Alpha.Test:443',
      now: new Date('2026-10-10T12:00:00.000Z'),
      passwordHash: '$argon2id$fixture',
      tokenHash: 'a'.repeat(64),
      traceId: 'trace-invitation-1',
      verifyExistingPassword: vi.fn(async () => false),
    });
    expect(result).toMatchObject({
      host: 'admin.alpha.test',
      role: 'customer_owner',
      userId: '40000000-0000-4000-8000-000000000001',
    });
    expect(calls.some((sql) => sql.includes('INSERT INTO memberships'))).toBe(true);
    expect(calls.some((sql) => sql.includes('INSERT INTO audit_events'))).toBe(true);
    expect(calls.at(-1)).toBe('COMMIT');
  });

  it('accepts an existing active account only after verifying its current password', async () => {
    const calls: string[] = [];
    const verifyExistingPassword = vi.fn(async (hash: string) => hash === '$argon2id$existing');
    const { pool } = poolFor(async (sql) => {
      calls.push(sql);
      if (sql.includes('SELECT p.customer_seat_limit')) {
        return {
          rows: [
            {
              active_memberships: 1,
              customer_seat_limit: 2,
              existing_membership: true,
              pending_other: 0,
            },
          ],
        };
      }
      if (sql.includes('FROM customer_invitations')) {
        return {
          rows: [
            {
              id: '70000000-0000-4000-8000-000000000002',
              normalized_email: 'existing@example.test',
              role: 'customer_editor',
              site_id: '20000000-0000-4000-8000-000000000001',
              tenant_id: '10000000-0000-4000-8000-000000000001',
            },
          ],
        };
      }
      if (sql.includes('JOIN credentials c')) {
        return {
          rows: [
            {
              id: '40000000-0000-4000-8000-000000000099',
              password_hash: '$argon2id$existing',
              status: 'active',
            },
          ],
        };
      }
      if (sql.includes('FROM account_authentication_policies policy')) {
        return {
          rows: [
            {
              email_code_enabled: false,
              has_recovery_codes: false,
              preferred_method: null,
              second_step_requirement: 'optional',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const result = await new PostgresAuthenticationRepository(
      pool,
      'admin.omnireach.test',
    ).acceptInvitation({
      displayName: 'Ignored Existing Name',
      host: 'admin.alpha.test',
      now: new Date('2026-10-10T12:00:00.000Z'),
      passwordHash: '$argon2id$new-unused',
      tokenHash: 'b'.repeat(64),
      traceId: 'trace-invitation-existing',
      verifyExistingPassword,
    });
    expect(result).toMatchObject({
      passwordHash: '$argon2id$existing',
      role: 'customer_editor',
      userId: '40000000-0000-4000-8000-000000000099',
    });
    expect(verifyExistingPassword).toHaveBeenCalledWith('$argon2id$existing');
    expect(calls.some((sql) => sql.includes('INSERT INTO users'))).toBe(false);
    expect(calls.some((sql) => sql.includes('ON CONFLICT'))).toBe(true);
  });

  it('rechecks the plan seat limit under a site admission lock before accepting', async () => {
    const calls: string[] = [];
    const { pool } = poolFor(async (sql) => {
      calls.push(sql);
      if (sql.includes('SELECT p.customer_seat_limit')) {
        return {
          rows: [
            {
              active_memberships: 2,
              customer_seat_limit: 2,
              existing_membership: false,
              pending_other: 0,
            },
          ],
        };
      }
      if (sql.includes('FROM customer_invitations')) {
        return {
          rows: [
            {
              id: '70000000-0000-4000-8000-000000000003',
              normalized_email: 'full@example.test',
              role: 'customer_viewer',
              site_id: '20000000-0000-4000-8000-000000000001',
              tenant_id: '10000000-0000-4000-8000-000000000001',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const result = await new PostgresAuthenticationRepository(
      pool,
      'admin.omnireach.test',
    ).acceptInvitation({
      displayName: 'No Seat Available',
      host: 'admin.alpha.test',
      now: new Date('2026-10-10T12:00:00.000Z'),
      passwordHash: '$argon2id$unused',
      tokenHash: 'c'.repeat(64),
      traceId: 'trace-invitation-capacity',
      verifyExistingPassword: vi.fn(async () => false),
    });

    expect(result).toBeUndefined();
    expect(calls.some((sql) => sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(calls.some((sql) => sql.includes('INSERT INTO memberships'))).toBe(false);
  });

  it('resolves exactly one active identity for the exact normalized host under the auth role', async () => {
    const { client, pool } = poolFor(async (query) => {
      if (query.includes('WITH customer_target')) {
        return {
          rows: [
            {
              blocked_until: null,
              email_code_enabled: false,
              has_recovery_codes: false,
              host: 'admin.alpha.test',
              normalized_email: 'owner@example.test',
              password_hash: '$argon2id$fixture',
              preferred_method: null,
              role: 'customer_owner',
              second_step_requirement: 'optional',
              site_id: 'site-a',
              tenant_id: 'tenant-a',
              user_id: 'user-a',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const repository = new PostgresAuthenticationRepository(pool, 'admin.omnireach.test');
    await expect(
      repository.findLoginTarget({
        host: 'ADMIN.Alpha.Test:443',
        normalizedEmail: 'owner@example.test',
      }),
    ).resolves.toMatchObject({
      host: 'admin.alpha.test',
      role: 'customer_owner',
      siteId: 'site-a',
      tenantId: 'tenant-a',
    });
    expect(
      vi
        .mocked(client.query)
        .mock.calls.slice(0, 3)
        .map(([query]) => query),
    ).toEqual([
      'BEGIN',
      'SET LOCAL ROLE omnireach_auth',
      `SELECT set_config('app.authentication_contract_version', '3', true)`,
    ]);
    const lookup = vi.mocked(client.query).mock.calls[3];
    expect(lookup?.[1]).toEqual(['owner@example.test', 'admin.alpha.test', 'admin.omnireach.test']);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('fails closed when host resolution returns an ambiguous identity', async () => {
    const row = {
      blocked_until: null,
      host: 'admin.omnireach.test',
      password_hash: '$argon2id$fixture',
      role: 'platform_admin',
      site_id: null,
      tenant_id: null,
      user_id: 'user-a',
    };
    const { pool } = poolFor(async (query) =>
      query.includes('WITH customer_target') ? { rows: [row, row] } : { rows: [] },
    );
    await expect(
      new PostgresAuthenticationRepository(pool, 'admin.omnireach.test').findLoginTarget({
        host: 'admin.omnireach.test',
        normalizedEmail: 'staff@example.test',
      }),
    ).resolves.toBeUndefined();
  });

  it('completes recovery and revokes every session in one auth-role transaction', async () => {
    const calls: string[] = [];
    const { client, pool } = poolFor(async (query) => {
      calls.push(query.trimStart());
      if (query.includes('FROM password_recovery_tokens')) {
        return { rows: [{ id: 'recovery-a', user_id: 'user-a' }] };
      }
      if (query.includes('SELECT id FROM users')) return { rows: [{ id: 'user-a' }] };
      if (query.includes('FROM platform_memberships')) return { rows: [] };
      if (query.includes('UPDATE credentials')) return { rows: [{ user_id: 'user-a' }] };
      return { rows: [] };
    });
    const completed = await new PostgresAuthenticationRepository(
      pool,
      'admin.omnireach.test',
    ).completePasswordRecovery({
      host: 'admin.alpha.test',
      newPasswordHash: '$argon2id$new',
      now: new Date('2026-10-10T12:00:00.000Z'),
      traceId: 'trace-recovery',
      tokenHash: 'a'.repeat(64),
    });
    expect(completed).toBe(true);
    expect(calls.some((query) => query.startsWith('UPDATE sessions'))).toBe(true);
    expect(calls.some((query) => query.startsWith('INSERT INTO audit_events'))).toBe(true);
    expect(calls.findIndex((query) => query.includes('SELECT id FROM users'))).toBeLessThan(
      calls.findIndex((query) => query.includes('SELECT id\n           FROM platform_memberships')),
    );
    expect(calls.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('aborts password recovery when privileged membership appears before the user lock is held', async () => {
    const calls: string[] = [];
    const { pool } = poolFor(async (query) => {
      calls.push(query.trimStart());
      if (query.includes('FROM password_recovery_tokens')) {
        return { rows: [{ id: 'recovery-a', user_id: 'user-a' }] };
      }
      if (query.includes('SELECT id FROM users')) return { rows: [{ id: 'user-a' }] };
      if (query.includes('SELECT id\n           FROM platform_memberships')) {
        return { rows: [{ id: 'platform-membership-a' }] };
      }
      return { rows: [] };
    });

    await expect(
      new PostgresAuthenticationRepository(pool, 'admin.omnireach.test').completePasswordRecovery({
        host: 'admin.alpha.test',
        newPasswordHash: '$argon2id$new',
        now: new Date('2026-10-10T12:00:00.000Z'),
        traceId: 'trace-recovery-race',
        tokenHash: 'a'.repeat(64),
      }),
    ).resolves.toBe(false);
    expect(calls.some((query) => query.startsWith('UPDATE credentials'))).toBe(false);
    expect(calls.at(-1)).toBe('COMMIT');
  });

  it('aborts customer email-policy changes after a concurrent privileged promotion', async () => {
    const calls: string[] = [];
    const { pool } = poolFor(async (query) => {
      calls.push(query.trimStart());
      if (query.includes('SELECT id FROM users')) return { rows: [{ id: 'user-a' }] };
      if (query.includes('SELECT id\n           FROM platform_memberships')) {
        return { rows: [{ id: 'platform-membership-a' }] };
      }
      return { rows: [] };
    });

    await expect(
      new PostgresAuthenticationRepository(
        pool,
        'admin.omnireach.test',
      ).updateCustomerEmailCodePolicy({
        enabled: true,
        host: 'admin.alpha.test',
        now: new Date('2026-10-10T12:00:00.000Z'),
        recoveryCodeHashes: ['a'.repeat(64)],
        sessionTokenHash: 'b'.repeat(64),
        traceId: 'trace-policy-race',
        userId: 'user-a',
      }),
    ).resolves.toBe(false);
    expect(calls.some((query) => query.includes('FROM credentials'))).toBe(false);
    expect(
      calls.some((query) => query.includes('INSERT INTO account_authentication_policies')),
    ).toBe(false);
  });

  it('finishes restricted customer recovery by atomically removing lockout factors', async () => {
    const calls: string[] = [];
    const verifyCurrentPassword = vi.fn(async (hash: string) => hash === '$argon2id$current');
    const { client, pool } = poolFor(async (query) => {
      calls.push(query.trimStart());
      if (query.includes('FROM sessions s') && !query.includes('FOR UPDATE OF s')) {
        return { rows: [{ site_id: 'site-a', tenant_id: 'tenant-a', user_id: 'user-a' }] };
      }
      if (query.includes('SELECT id FROM users')) return { rows: [{ id: 'user-a' }] };
      if (query.includes('FOR UPDATE OF s')) {
        return { rows: [{ id: 'session-a', site_id: 'site-a', tenant_id: 'tenant-a' }] };
      }
      if (query.includes('FROM platform_memberships')) return { rows: [] };
      if (query.includes('FROM credentials') && query.includes('FOR UPDATE')) {
        return { rows: [{ password_hash: '$argon2id$current', user_id: 'user-a' }] };
      }
      if (query.includes('FROM account_authentication_policies') && query.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              email_code_enabled: true,
              second_step_requirement: 'required',
              user_id: 'user-a',
            },
          ],
        };
      }
      if (query.includes('COALESCE(max(set_version)')) return { rows: [{ set_version: 4 }] };
      if (query.includes('UPDATE account_recovery_codes')) {
        return { rows: [{ id: 'recovery-code-a' }, { id: 'recovery-code-b' }] };
      }
      if (query.includes('UPDATE mfa_factors')) return { rows: [{ id: 'totp-a' }] };
      if (query.includes('UPDATE webauthn_credentials')) {
        return { rows: [{ id: 'passkey-a' }, { id: 'passkey-b' }] };
      }
      if (query.includes('UPDATE password_recovery_tokens')) {
        return { rows: [{ id: 'reset-a' }] };
      }
      if (query.includes('UPDATE sessions')) {
        return { rows: [{ id: 'session-a' }, { id: 'session-b' }] };
      }
      return { rows: [] };
    });

    await expect(
      new PostgresAuthenticationRepository(pool, 'admin.omnireach.test').completeCustomerRecovery({
        confirmed: true,
        host: 'admin.alpha.test',
        now: new Date('2026-10-10T12:00:00.000Z'),
        recoveryCodeHashes: ['a'.repeat(64), 'b'.repeat(64)],
        sessionTokenHash: 'c'.repeat(64),
        traceId: 'trace-customer-recovery',
        verifyCurrentPassword,
      }),
    ).resolves.toBe(true);

    expect(verifyCurrentPassword).toHaveBeenCalledOnce();
    expect(verifyCurrentPassword).toHaveBeenCalledWith('$argon2id$current');
    expect(calls.some((query) => query.startsWith('UPDATE mfa_factors'))).toBe(true);
    expect(calls.some((query) => query.startsWith('UPDATE webauthn_credentials'))).toBe(true);
    expect(calls.some((query) => query.startsWith('UPDATE password_recovery_tokens'))).toBe(true);
    expect(
      calls.some(
        (query) =>
          query.startsWith('UPDATE account_authentication_policies') &&
          query.includes("second_step_requirement = 'optional'") &&
          query.includes('email_code_enabled = false') &&
          query.includes('preferred_method = NULL') &&
          query.includes('auth_state_version = auth_state_version + 1'),
      ),
    ).toBe(true);
    const auditCall = vi
      .mocked(client.query)
      .mock.calls.find(([query]) => query.includes('INSERT INTO audit_events'));
    expect(auditCall?.[1]?.[7]).toContain('"accountWide":true');
    expect(auditCall?.[1]?.[7]).toContain('"emailCodeDisabled":true');
    expect(auditCall?.[1]?.[7]).toContain('"emailCodePreviouslyEnabled":true');
    expect(auditCall?.[1]?.[7]).toContain('"reason":"customer-recovery-lockout-reset"');
    expect(auditCall?.[1]?.[7]).toContain('"sessionsRevoked":2');
    expect(auditCall?.[1]?.[7]).toContain('"webauthnCredentialsRevoked":2');
    expect(calls.at(-1)).toBe('COMMIT');
  });

  it('does not mutate recovery state when the locked current password is invalid', async () => {
    const calls: string[] = [];
    const { pool } = poolFor(async (query) => {
      calls.push(query.trimStart());
      if (query.includes('FROM sessions s')) {
        return { rows: [{ site_id: 'site-a', tenant_id: 'tenant-a', user_id: 'user-a' }] };
      }
      if (query.includes('SELECT id FROM users')) return { rows: [{ id: 'user-a' }] };
      if (query.includes('FROM platform_memberships')) return { rows: [] };
      if (query.includes('FROM credentials')) {
        return { rows: [{ password_hash: '$argon2id$current', user_id: 'user-a' }] };
      }
      return { rows: [] };
    });

    await expect(
      new PostgresAuthenticationRepository(pool, 'admin.omnireach.test').completeCustomerRecovery({
        confirmed: true,
        host: 'admin.alpha.test',
        now: new Date('2026-10-10T12:00:00.000Z'),
        recoveryCodeHashes: ['a'.repeat(64)],
        sessionTokenHash: 'c'.repeat(64),
        traceId: 'trace-customer-recovery-invalid-password',
        verifyCurrentPassword: vi.fn(async () => false),
      }),
    ).resolves.toBe(false);

    expect(calls.some((query) => query.startsWith('UPDATE '))).toBe(false);
    expect(calls.at(-1)).toBe('COMMIT');
  });

  it('aborts restricted customer recovery after a concurrent platform promotion', async () => {
    const calls: string[] = [];
    const verifyCurrentPassword = vi.fn(async () => true);
    const { pool } = poolFor(async (query) => {
      calls.push(query.trimStart());
      if (query.includes('FROM sessions s')) {
        return { rows: [{ site_id: 'site-a', tenant_id: 'tenant-a', user_id: 'user-a' }] };
      }
      if (query.includes('SELECT id FROM users')) return { rows: [{ id: 'user-a' }] };
      if (query.includes('FROM platform_memberships')) {
        return { rows: [{ id: 'platform-membership-a' }] };
      }
      return { rows: [] };
    });

    await expect(
      new PostgresAuthenticationRepository(pool, 'admin.omnireach.test').completeCustomerRecovery({
        confirmed: true,
        host: 'admin.alpha.test',
        now: new Date('2026-10-10T12:00:00.000Z'),
        recoveryCodeHashes: ['a'.repeat(64)],
        sessionTokenHash: 'c'.repeat(64),
        traceId: 'trace-customer-recovery-promotion-race',
        verifyCurrentPassword,
      }),
    ).resolves.toBe(false);

    expect(verifyCurrentPassword).not.toHaveBeenCalled();
    expect(calls.some((query) => query.startsWith('UPDATE '))).toBe(false);
    expect(calls.at(-1)).toBe('COMMIT');
  });

  it('rejects half-scoped sessions before opening a transaction', async () => {
    const { pool } = poolFor(async () => ({ rows: [] }));
    const repository = new PostgresAuthenticationRepository(pool, 'admin.omnireach.test');
    await expect(
      repository.createSession({
        assuranceLevel: 'basic',
        authenticationMethod: 'password',
        expectedAuthStateVersion: '1',
        expectedPasswordHash: '$argon2id$old',
        expiresAt: new Date('2026-10-10T20:00:00.000Z'),
        host: 'admin.alpha.test',
        recoveryRestricted: false,
        role: 'customer_owner',
        siteId: 'site-a',
        tokenHash: 'a'.repeat(64),
        traceId: 'trace-session',
        userId: 'user-a',
      }),
    ).rejects.toThrow('scope');
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
