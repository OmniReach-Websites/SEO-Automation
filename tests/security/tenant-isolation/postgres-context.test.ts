import { createHash } from 'node:crypto';

import { PostgresRequestContextResolver, type ContextQueryPool } from '@omnireach/api';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

function request(hostname: string, token = 'fictional-session'): FastifyRequest {
  return {
    cookies: { '__Host-omnireach_session': token },
    headers: {},
    hostname,
    id: 'trace-context-0001',
  } as unknown as FastifyRequest;
}

function contextPool(rows: Record<string, unknown>[]) {
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    void values;
    if (text.trimStart().startsWith('SELECT s.user_id')) return { rows };
    if (text.trimStart().startsWith('UPDATE sessions')) {
      return { rows: rows.length === 1 ? [{ id: 'session-a' }] : [] };
    }
    return { rows: [] };
  });
  return {
    pool: {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    } as ContextQueryPool,
    query,
  };
}

describe('PostgreSQL-backed request context', () => {
  it('resolves one exact customer host/session membership without exposing the token', async () => {
    const { pool, query } = contextPool([
      {
        editor_publish_grant: true,
        role: 'customer_editor',
        site_id: 'site-a',
        tenant_id: 'tenant-a',
        user_id: 'user-a',
      },
    ]);
    const resolver = new PostgresRequestContextResolver(pool, 'admin.omnireach.test');
    await expect(resolver.customer(request('admin.alpha.test'))).resolves.toEqual({
      editorPublishGrant: true,
      role: 'customer_editor',
      siteId: 'site-a',
      tenantId: 'tenant-a',
      traceId: 'trace-context-0001',
      userId: 'user-a',
    });
    expect(query.mock.calls.slice(0, 3).map(([text]) => text)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE omnireach_auth',
      `SELECT set_config('app.authentication_contract_version', '2', true)`,
    ]);
    const values = query.mock.calls[3]?.[1];
    expect(values).toEqual([
      createHash('sha256').update('fictional-session').digest('hex'),
      'admin.alpha.test',
    ]);
    const contextSql = String(query.mock.calls[3]?.[0]);
    expect(contextSql).toContain('account_authentication_policies');
    expect(contextSql).toContain("authentication_assurance IN ('baseline', 'strong')");
    expect(contextSql).toContain('s.verified_at IS NOT NULL');
    expect(contextSql).toContain("s.last_seen_at > now() - interval '30 minutes'");
    const refreshSql = String(query.mock.calls[4]?.[0]);
    expect(refreshSql).toContain('SET last_seen_at = now()');
    expect(refreshSql).toContain('token_hash = $1 AND host = $2');
    expect(refreshSql).toContain("last_seen_at > now() - interval '30 minutes'");
    expect(JSON.stringify(query.mock.calls)).not.toContain('fictional-session"');
  });

  it('fails closed on duplicate rows, invalid roles, and a mismatched ORAP host', async () => {
    const duplicate = {
      editor_publish_grant: false,
      role: 'customer_owner',
      site_id: 'site-a',
      tenant_id: 'tenant-a',
      user_id: 'user-a',
    };
    const { pool: customerPool, query: customerQuery } = contextPool([duplicate, duplicate]);
    await expect(
      new PostgresRequestContextResolver(customerPool, 'admin.omnireach.test').customer(
        request('admin.alpha.test'),
      ),
    ).resolves.toBeUndefined();
    expect(
      customerQuery.mock.calls.some(([sql]) => String(sql).includes('SET last_seen_at = now()')),
    ).toBe(false);

    const { pool: platformPool, query: platformQuery } = contextPool([]);
    const resolver = new PostgresRequestContextResolver(platformPool, 'admin.omnireach.test');
    await expect(resolver.platform(request('admin.attacker.test'))).resolves.toBeUndefined();
    expect(platformQuery).not.toHaveBeenCalled();
  });

  it('resolves active global platform membership only on the configured ORAP host', async () => {
    const { pool, query } = contextPool([{ role: 'platform_admin', user_id: 'staff-a' }]);
    const resolver = new PostgresRequestContextResolver(pool, 'ADMIN.OMNIREACH.TEST');
    await expect(resolver.platform(request('admin.omnireach.test'))).resolves.toEqual({
      id: 'staff-a',
      role: 'platform_admin',
      traceId: 'trace-context-0001',
    });
    const contextSql = String(query.mock.calls[3]?.[0]);
    expect(contextSql).toContain("s.authentication_assurance IN ('baseline', 'strong')");
    expect(contextSql).toContain('s.verified_at IS NOT NULL');
    expect(contextSql).toContain('NOT s.recovery_restricted');
    expect(contextSql).toContain("s.last_seen_at > now() - interval '30 minutes'");
    expect(String(query.mock.calls[4]?.[0])).toContain('SET last_seen_at = now()');
  });
});
