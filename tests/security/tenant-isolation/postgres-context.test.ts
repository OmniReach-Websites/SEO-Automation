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
    expect(query.mock.calls.slice(0, 2).map(([text]) => text)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE omnireach_auth',
    ]);
    const values = query.mock.calls[2]?.[1];
    expect(values).toEqual([
      createHash('sha256').update('fictional-session').digest('hex'),
      'admin.alpha.test',
    ]);
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
    const { pool: customerPool } = contextPool([duplicate, duplicate]);
    await expect(
      new PostgresRequestContextResolver(customerPool, 'admin.omnireach.test').customer(
        request('admin.alpha.test'),
      ),
    ).resolves.toBeUndefined();

    const { pool: platformPool, query: platformQuery } = contextPool([]);
    const resolver = new PostgresRequestContextResolver(platformPool, 'admin.omnireach.test');
    await expect(resolver.platform(request('admin.attacker.test'))).resolves.toBeUndefined();
    expect(platformQuery).not.toHaveBeenCalled();
  });

  it('resolves active global platform membership only on the configured ORAP host', async () => {
    const { pool } = contextPool([{ role: 'platform_admin', user_id: 'staff-a' }]);
    const resolver = new PostgresRequestContextResolver(pool, 'ADMIN.OMNIREACH.TEST');
    await expect(resolver.platform(request('admin.omnireach.test'))).resolves.toEqual({
      id: 'staff-a',
      role: 'platform_admin',
      traceId: 'trace-context-0001',
    });
  });
});
