import {
  PostgresWebAuthnRepository,
  type AuthenticationTransactionClient,
  type AuthenticationTransactionPool,
} from '@omnireach/auth';
import { describe, expect, it, vi } from 'vitest';

const scopeRow = {
  created_at: new Date('2026-01-01T00:00:00Z'),
  id: '10000000-0000-4000-8000-000000000001',
  rp_id: 'admin.customer.example',
  site_id: '20000000-0000-4000-8000-000000000001',
  tenant_id: '30000000-0000-4000-8000-000000000001',
  user_handle: Buffer.alloc(64, 7),
  user_id: '40000000-0000-4000-8000-000000000001',
};

function poolWith(respond: (statement: string, values: unknown[] | undefined) => unknown): {
  pool: AuthenticationTransactionPool;
  query: ReturnType<typeof vi.fn<AuthenticationTransactionClient['query']>>;
} {
  const query = vi.fn<AuthenticationTransactionClient['query']>(async (statement, values) =>
    respond(statement, values),
  );
  return {
    pool: {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    },
    query,
  };
}

describe('PostgreSQL WebAuthn scope repository', () => {
  it('creates a random exact-host scope only behind the Auth Contract v3 transaction', async () => {
    let scopeLookups = 0;
    const fixture = poolWith((statement) => {
      if (statement.includes('FROM webauthn_scopes scope')) {
        scopeLookups += 1;
        return { rows: [] };
      }
      if (statement.includes('INSERT INTO webauthn_scopes')) return { rows: [scopeRow] };
      return { rows: [] };
    });
    const repository = new PostgresWebAuthnRepository(fixture.pool, 'admin.omnireach.cloud');
    const scope = await repository.ensureScope({
      host: 'ADMIN.CUSTOMER.EXAMPLE.',
      siteId: scopeRow.site_id,
      tenantId: scopeRow.tenant_id,
      userId: scopeRow.user_id,
    });

    expect(scope).toMatchObject({
      id: scopeRow.id,
      rpId: 'admin.customer.example',
      siteId: scopeRow.site_id,
      tenantId: scopeRow.tenant_id,
      userId: scopeRow.user_id,
    });
    expect(scope?.userHandle).toHaveLength(64);
    expect(scopeLookups).toBe(1);
    expect(fixture.query).toHaveBeenCalledWith(
      `SELECT set_config('app.authentication_contract_version', '3', true)`,
    );
    const insertion = fixture.query.mock.calls.find(([statement]) =>
      statement.includes('INSERT INTO webauthn_scopes'),
    );
    expect(insertion?.[0]).toContain("domain.kind = 'admin'");
    expect(insertion?.[0]).toContain("domain.verification_status = 'verified'");
    expect(insertion?.[0]).toContain('domain.hostname = $4');
    expect(insertion?.[1]?.slice(0, 4)).toEqual([
      scopeRow.user_id,
      scopeRow.tenant_id,
      scopeRow.site_id,
      'admin.customer.example',
    ]);
    expect(insertion?.[1]?.[4]).toBeInstanceOf(Uint8Array);
    expect((insertion?.[1]?.[4] as Uint8Array).byteLength).toBe(64);
  });

  it('keeps ORAP and customer scope shapes mutually exclusive', async () => {
    const fixture = poolWith(() => ({ rows: [] }));
    const repository = new PostgresWebAuthnRepository(fixture.pool, 'admin.omnireach.cloud');
    await expect(
      repository.findScope({
        host: 'admin.omnireach.cloud',
        siteId: scopeRow.site_id,
        tenantId: scopeRow.tenant_id,
        userId: scopeRow.user_id,
      }),
    ).rejects.toThrow('ORAP WebAuthn scope cannot be tenant-bound');
    await expect(
      repository.findScope({ host: 'admin.customer.example', userId: scopeRow.user_id }),
    ).rejects.toThrow('Customer WebAuthn scope must be tenant-bound');
    await expect(
      repository.findScope({
        host: 'admin.customer.example',
        tenantId: scopeRow.tenant_id,
        userId: scopeRow.user_id,
      }),
    ).rejects.toThrow('requires tenant and site');
    expect(fixture.query).not.toHaveBeenCalled();
  });
});
