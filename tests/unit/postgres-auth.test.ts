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
              host: 'admin.alpha.test',
              password_hash: '$argon2id$fixture',
              role: 'customer_owner',
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
        .mock.calls.slice(0, 2)
        .map(([query]) => query),
    ).toEqual(['BEGIN', 'SET LOCAL ROLE omnireach_auth']);
    const lookup = vi.mocked(client.query).mock.calls[2];
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
      if (query.includes('UPDATE credentials')) return { rows: [{ user_id: 'user-a' }] };
      return { rows: [] };
    });
    const completed = await new PostgresAuthenticationRepository(
      pool,
      'admin.omnireach.test',
    ).completePasswordRecovery({
      newPasswordHash: '$argon2id$new',
      now: new Date('2026-10-10T12:00:00.000Z'),
      traceId: 'trace-recovery',
      tokenHash: 'a'.repeat(64),
    });
    expect(completed).toBe(true);
    expect(calls.some((query) => query.startsWith('UPDATE sessions'))).toBe(true);
    expect(calls.some((query) => query.startsWith('INSERT INTO audit_events'))).toBe(true);
    expect(calls.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rejects half-scoped sessions before opening a transaction', async () => {
    const { pool } = poolFor(async () => ({ rows: [] }));
    const repository = new PostgresAuthenticationRepository(pool, 'admin.omnireach.test');
    await expect(
      repository.createSession({
        expiresAt: new Date('2026-10-10T20:00:00.000Z'),
        host: 'admin.alpha.test',
        siteId: 'site-a',
        authenticationMethod: 'password',
        tokenHash: 'a'.repeat(64),
        traceId: 'trace-session',
        userId: 'user-a',
      }),
    ).rejects.toThrow('scope');
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
