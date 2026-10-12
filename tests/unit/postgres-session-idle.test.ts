import {
  PostgresAuthenticationRepository,
  type AuthenticationTransactionClient,
  type AuthenticationTransactionPool,
} from '@omnireach/auth';
import { describe, expect, it, vi } from 'vitest';

function poolFor(handler: (sql: string, values?: unknown[]) => Promise<unknown>) {
  const client: AuthenticationTransactionClient = {
    query: vi.fn(handler),
    release: vi.fn(),
  };
  const pool: AuthenticationTransactionPool = {
    connect: vi.fn(async () => client),
  };
  return { client, pool };
}

describe('PostgreSQL authentication session idle expiry', () => {
  it('refreshes an exact-host session only after its scoped security context is valid', async () => {
    const calls: string[] = [];
    const { client, pool } = poolFor(async (sql) => {
      calls.push(sql);
      if (sql.includes('WITH customer_target AS')) {
        return {
          rows: [
            {
              email_code_enabled: false,
              has_totp: false,
              host: 'admin.alpha.test',
              normalized_email: 'owner@example.test',
              password_hash: '$argon2id$fixture',
              role: 'customer_owner',
              second_step_requirement: 'optional',
              site_id: 'site-a',
              tenant_id: 'tenant-a',
              user_id: 'user-a',
            },
          ],
        };
      }
      if (sql.includes('SET last_seen_at = now()')) return { rows: [{ id: 'session-a' }] };
      return { rows: [] };
    });
    const target = await new PostgresAuthenticationRepository(
      pool,
      'admin.omnireach.test',
    ).findAccountSecurityTarget({
      host: 'ADMIN.ALPHA.TEST:443',
      tokenHash: 'a'.repeat(64),
    });
    expect(target).toMatchObject({
      host: 'admin.alpha.test',
      role: 'customer_owner',
      siteId: 'site-a',
      tenantId: 'tenant-a',
    });
    const lookup = calls.find((sql) => sql.includes('WITH customer_target AS')) ?? '';
    const refresh = calls.find((sql) => sql.includes('SET last_seen_at = now()')) ?? '';
    expect(lookup).toContain("s.last_seen_at > now() - interval '30 minutes'");
    expect(refresh).toContain('token_hash = $1 AND host = $2');
    expect(refresh).toContain("last_seen_at > now() - interval '30 minutes'");
    expect(refresh).toContain('NOT recovery_restricted');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('fails closed when the exact session cannot be refreshed and filters idle sessions from lists', async () => {
    const calls: string[] = [];
    const { pool } = poolFor(async (sql) => {
      calls.push(sql);
      if (sql.trimStart().startsWith('SELECT s.user_id')) {
        return {
          rows: [
            {
              host: 'admin.alpha.test',
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
      repository.findSessionOwner({
        host: 'admin.alpha.test',
        tokenHash: 'b'.repeat(64),
      }),
    ).resolves.toBeUndefined();
    const lookup = calls.find((sql) => sql.trimStart().startsWith('SELECT s.user_id')) ?? '';
    expect(lookup).toContain("s.last_seen_at > now() - interval '30 minutes'");

    await repository.listSessions({
      host: 'admin.alpha.test',
      siteId: 'site-a',
      tenantId: 'tenant-a',
      userId: 'user-a',
    });
    const listing = calls.find((sql) => sql.includes('SELECT id, host')) ?? '';
    expect(listing).toContain("last_seen_at > now() - interval '30 minutes'");
    expect(listing).toContain('NOT recovery_restricted');
  });
});
