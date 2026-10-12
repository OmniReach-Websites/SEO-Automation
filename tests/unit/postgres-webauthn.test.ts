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

  it('prepares enrollment only from a recent exact-host non-recovery session', async () => {
    const fixture = poolWith((statement) => {
      if (statement.includes('WITH target AS')) {
        return {
          rows: [
            {
              auth_state_version: '8',
              display_name: 'Customer Owner',
              email_code_enabled: true,
              has_totp: false,
              has_webauthn: false,
              host: 'admin.customer.example',
              normalized_email: 'owner@example.test',
              password_hash: 'fictional-password-hash',
              role: 'customer_owner',
              scope_id: null,
              second_step_requirement: 'optional',
              site_id: scopeRow.site_id,
              tenant_id: scopeRow.tenant_id,
              user_handle: null,
              user_id: scopeRow.user_id,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const repository = new PostgresWebAuthnRepository(fixture.pool, 'admin.omnireach.cloud');
    const target = await repository.findEnrollmentTarget({
      host: 'ADMIN.CUSTOMER.EXAMPLE.',
      now: new Date('2026-10-11T12:00:00Z'),
      sessionTokenHash: 'a'.repeat(64),
    });

    expect(target).toMatchObject({
      activeCredentialCount: 0,
      authStateVersion: '8',
      host: 'admin.customer.example',
      role: 'customer_owner',
      rpId: 'admin.customer.example',
    });
    expect(target?.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(target?.userHandle).toHaveLength(64);
    const lookup = fixture.query.mock.calls.find(([statement]) =>
      statement.includes('WITH target AS'),
    );
    expect(lookup?.[0]).toContain('session.revoked_at IS NULL');
    expect(lookup?.[0]).toContain('NOT session.recovery_restricted');
    expect(lookup?.[0]).toContain("session.last_seen_at > $4 - interval '10 minutes'");
    expect(lookup?.[0]).toContain("session.verified_at > $4 - interval '10 minutes'");
    expect(lookup?.[0]).toContain("session.authentication_assurance = 'strong'");
    expect(lookup?.[0]).toContain('strong_credential.revoked_at IS NULL');
    expect(lookup?.[0]).toContain('domain.hostname = session.host');
    expect(lookup?.[0]).toContain("domain.verification_status = 'verified'");
  });

  it('atomically enrolls, replaces recovery codes, updates policy, revokes sessions, and audits', async () => {
    const fixture = poolWith((statement) => {
      if (statement.includes('FROM users auth_user') && statement.includes('FOR UPDATE')) {
        return { rows: [{ id: scopeRow.user_id }] };
      }
      if (statement.includes('FROM credentials credential') && statement.includes('FOR UPDATE')) {
        return { rows: [{ password_hash: 'fictional-current-hash' }] };
      }
      if (
        statement.includes('FROM account_authentication_policies policy') &&
        statement.includes('FOR UPDATE')
      ) {
        return {
          rows: [
            {
              auth_state_version: '7',
              email_code_enabled: true,
              second_step_requirement: 'optional',
            },
          ],
        };
      }
      if (statement.includes('FROM sessions') && statement.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              authentication_assurance: 'baseline',
              site_id: scopeRow.site_id,
              tenant_id: scopeRow.tenant_id,
              verified_at: new Date('2026-10-11T11:55:00Z'),
            },
          ],
        };
      }
      if (statement.includes('SELECT membership.role'))
        return { rows: [{ role: 'customer_owner' }] };
      if (statement.includes('FROM mfa_factors') && statement.includes('FOR UPDATE')) {
        return { rows: [{ id: '70000000-0000-4000-8000-000000000001' }] };
      }
      if (statement.includes('FOR UPDATE OF webauthn_credential')) return { rows: [] };
      if (statement.includes('SELECT webauthn_credential.id')) return { rows: [] };
      if (statement.includes('FROM webauthn_scopes') && statement.includes('FOR UPDATE')) {
        return { rows: [] };
      }
      if (statement.includes('UPDATE account_recovery_codes')) {
        return { rows: [{ id: '50000000-0000-4000-8000-000000000001' }] };
      }
      if (statement.includes('COALESCE(max(set_version)')) return { rows: [{ set_version: 3 }] };
      if (statement.includes('UPDATE sessions') && statement.includes('RETURNING id')) {
        return { rows: [{ id: '60000000-0000-4000-8000-000000000001' }] };
      }
      return { rows: [] };
    });
    const repository = new PostgresWebAuthnRepository(fixture.pool, 'admin.omnireach.cloud');
    const recoveryCodeHashes = Array.from({ length: 10 }, (_, index) =>
      index.toString(16).padStart(64, '0'),
    );
    const completed = await repository.completeEnrollment({
      backedUp: false,
      backupEligible: false,
      credentialId: new Uint8Array([1, 2, 3]),
      credentialName: 'Windows Hello',
      credentialStateDigest: 'b'.repeat(64),
      deviceType: 'singleDevice',
      expectedAuthStateVersion: '7',
      host: 'admin.customer.example',
      now: new Date('2026-10-11T12:00:00Z'),
      publicKey: new Uint8Array([4, 5, 6]),
      recoveryCodeHashes,
      scopeId: scopeRow.id,
      sessionTokenHash: 'a'.repeat(64),
      signCount: 0,
      siteId: scopeRow.site_id,
      tenantId: scopeRow.tenant_id,
      traceId: 'trace-enrollment',
      transports: ['internal'],
      userHandle: scopeRow.user_handle,
      userId: scopeRow.user_id,
      verifyCredentialState: (hash, digest) =>
        hash === 'fictional-current-hash' && digest === 'b'.repeat(64),
    });

    expect(completed).toBe(true);
    const statements = fixture.query.mock.calls.map(([statement]) => statement);
    const sql = statements.join('\n');
    const userLock = statements.findIndex(
      (statement) => statement.includes('FROM users auth_user') && statement.includes('FOR UPDATE'),
    );
    const credentialLock = statements.findIndex(
      (statement) =>
        statement.includes('FROM credentials credential') && statement.includes('FOR UPDATE'),
    );
    const sessionLock = statements.findIndex(
      (statement) => statement.includes('FROM sessions') && statement.includes('FOR UPDATE'),
    );
    const authorizationLock = statements.findIndex(
      (statement) =>
        statement.includes('SELECT membership.role') && statement.includes('FOR UPDATE'),
    );
    const policyLock = statements.findIndex(
      (statement) =>
        statement.includes('FROM account_authentication_policies policy') &&
        statement.includes('FOR UPDATE'),
    );
    const factorLock = statements.findIndex(
      (statement) => statement.includes('FROM mfa_factors') && statement.includes('FOR UPDATE'),
    );
    expect([
      userLock,
      credentialLock,
      sessionLock,
      authorizationLock,
      policyLock,
      factorLock,
    ]).toEqual([0, 1, 2, 3, 4, 5].map((offset) => userLock + offset));
    expect(sql).not.toContain('FOR UPDATE OF auth_user, credential');
    expect(sql).toContain('INSERT INTO webauthn_credentials');
    expect(sql).toContain('UPDATE account_recovery_codes');
    expect(sql).toContain("second_step_requirement = 'required'");
    expect(sql).toContain("preferred_method = 'webauthn'");
    expect(sql).toContain("revoke_reason = 'webauthn-enrollment'");
    expect(sql).toContain("'auth.webauthn.enrolled'");
    expect(fixture.query).toHaveBeenCalledWith('COMMIT');
    const audit = fixture.query.mock.calls.find(([statement]) =>
      statement.includes("'auth.webauthn.enrolled'"),
    );
    expect(JSON.stringify(audit?.[1])).not.toContain(Buffer.from([1, 2, 3]).toString('hex'));
    expect(JSON.stringify(audit?.[1])).not.toContain(recoveryCodeHashes[0]);
  });

  it('does not write credentials when the bound session was revoked before completion', async () => {
    const fixture = poolWith((statement) => {
      if (statement.includes('FROM users auth_user') && statement.includes('FOR UPDATE')) {
        return { rows: [{ id: scopeRow.user_id }] };
      }
      if (statement.includes('FROM credentials credential') && statement.includes('FOR UPDATE')) {
        return { rows: [{ password_hash: 'fictional-current-hash' }] };
      }
      return { rows: [] };
    });
    const repository = new PostgresWebAuthnRepository(fixture.pool, 'admin.omnireach.cloud');
    const completed = await repository.completeEnrollment({
      backedUp: false,
      backupEligible: false,
      credentialId: new Uint8Array([1]),
      credentialName: 'Windows Hello',
      credentialStateDigest: 'b'.repeat(64),
      deviceType: 'singleDevice',
      expectedAuthStateVersion: '7',
      host: 'admin.customer.example',
      now: new Date('2026-10-11T12:00:00Z'),
      publicKey: new Uint8Array([2]),
      recoveryCodeHashes: Array.from({ length: 10 }, (_, index) =>
        index.toString(16).padStart(64, '0'),
      ),
      scopeId: scopeRow.id,
      sessionTokenHash: 'a'.repeat(64),
      signCount: 0,
      siteId: scopeRow.site_id,
      tenantId: scopeRow.tenant_id,
      traceId: 'trace-revoked-session',
      transports: ['internal'],
      userHandle: scopeRow.user_handle,
      userId: scopeRow.user_id,
      verifyCredentialState: () => true,
    });

    expect(completed).toBe(false);
    expect(
      fixture.query.mock.calls.some(([statement]) =>
        statement.includes('INSERT INTO webauthn_credentials'),
      ),
    ).toBe(false);
  });
});
