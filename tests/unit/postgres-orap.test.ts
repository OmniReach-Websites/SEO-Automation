import { PostgresOrapService, type InvitationNotifier } from '@omnireach/api/postgres-orap';
import type { TenantTransactionPool } from '@omnireach/tenant';
import { describe, expect, it, vi } from 'vitest';

const actor = {
  id: '40000000-0000-4000-8000-000000000001',
  role: 'platform_owner' as const,
  traceId: 'trace-orap-1',
};
const deniedStaff = {
  ...actor,
  role: 'staff' as const,
};
const sessionAdministrator = actor;

describe('PostgreSQL ORAP service', () => {
  it('reports platform backup freshness without exposing archive contents or storage credentials', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('FROM platform_ai_budget b')) {
        return {
          rows: [
            {
              cap_usd_micros: '50000000',
              period_start: new Date('2026-10-01T00:00:00.000Z'),
              reserved_usd_micros: '0',
              used_usd_micros: '0',
            },
          ],
        };
      }
      if (text.includes('FROM backup_records record')) {
        expect(text).not.toMatch(/storage_ref|off_server_ref|manifest|envelope_hash/iu);
        return {
          rows: [
            {
              byte_size: '1572864',
              created_at: new Date('2026-10-14T00:00:00.000Z'),
              error_code: 'provider detail that must not be exposed',
              id: '90000000-0000-4000-8000-000000000001',
              kind: 'daily',
              last_restore_tested_at: new Date('2026-10-01T00:00:00.000Z'),
              off_server_copied_at: new Date('2026-10-14T00:10:00.000Z'),
              state: 'healthy',
              verified_at: new Date('2026-10-14T00:05:00.000Z'),
            },
          ],
        };
      }
      return { rows: [] };
    });
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { send: vi.fn() },
      vi.fn(),
    );

    await expect(service.listOperations(actor)).resolves.toMatchObject({
      backup: {
        byteSize: 1_572_864,
        createdAt: '2026-10-14T00:00:00.000Z',
        errorCode: 'backup_failed',
        state: 'healthy',
      },
    });
  });

  it('reports bounded email provider readiness without credentials or recipients', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('FROM platform_ai_budget b')) {
        return {
          rows: [
            {
              cap_usd_micros: '50000000',
              period_start: new Date('2026-10-01T00:00:00.000Z'),
              reserved_usd_micros: '0',
              used_usd_micros: '0',
            },
          ],
        };
      }
      if (text.includes('FROM email_delivery_policy policy')) {
        expect(text).not.toMatch(/recipient|api_key|message|subject/iu);
        return {
          rows: [
            {
              cap_count: 3000,
              daily_cap_count: 100,
              daily_reserved_count: 0,
              daily_sent_count: 7,
              day_start: new Date('2026-10-14T00:00:00.000Z'),
              failed_attempt_count: 2,
              last_attempt_at: new Date('2026-10-14T01:00:00.000Z'),
              last_error_code: 'provider detail that must not be exposed',
              period_start: new Date('2026-10-01T00:00:00.000Z'),
              provider_observed_at: new Date('2026-10-14T01:00:00.000Z'),
              reserved_count: 1,
              sent_count: 12,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { send: vi.fn() },
      vi.fn(),
      new Map(),
      {
        alertEnabled: false,
        alertSender: 'alerts@updates.omnireach.cloud',
        authenticationEnabled: false,
        authenticationSender: 'auth@updates.omnireach.cloud',
        contactEnabled: false,
        contactSender: 'forms@updates.omnireach.cloud',
        credentialConfigured: true,
        turnstileConfigured: false,
      },
    );

    await expect(service.listOperations(actor)).resolves.toMatchObject({
      email: {
        credentialConfigured: true,
        dailyLimit: 100,
        dailyUsedCount: 7,
        failedAttemptCount: 2,
        lastErrorCode: 'provider_failure',
        monthlyLimit: 3000,
        reservedCount: 1,
        sentCount: 12,
      },
    });
  });

  it('replaces a staff password through the owner-only audited database function', async () => {
    const targetUserId = '40000000-0000-4000-8000-000000000099';
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      if (text.includes('orap_owner_update_staff_account')) {
        expect(values?.[0]).toBe(targetUserId);
        expect(values?.[1]).toBe('Updated Employee');
        expect(values?.[2]).toBe('updated@example.test');
        expect(values?.[4]).toEqual(expect.stringMatching(/^\$argon2id\$/u));
        expect(values?.[4]).not.toBe('replacement-password-123');
        expect(values?.[5]).toBe('Owner-approved recovery');
        expect(values?.[6]).toBe(actor.traceId);
        return {
          rows: [
            {
              password_replaced: true,
              revoked_sessions: 2,
              updated_display_name: 'Updated Employee',
              updated_job_title: 'Operations Lead',
              updated_normalized_email: 'updated@example.test',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { send: vi.fn() },
      vi.fn(),
    );

    await expect(
      service.updateStaffAccount(actor, {
        displayName: ' Updated Employee ',
        email: 'UPDATED@example.test',
        jobTitle: 'Operations Lead',
        newPassword: 'replacement-password-123',
        reason: 'Owner-approved recovery',
        userId: targetUserId,
      }),
    ).resolves.toEqual({
      displayName: 'Updated Employee',
      jobTitle: 'Operations Lead',
      normalizedEmail: 'updated@example.test',
      passwordReplaced: true,
      revokedSessions: 2,
    });
  });

  it('protects the last owner without requiring a separate strong-factor step-up', async () => {
    const targetOwnerId = '40000000-0000-4000-8000-000000000099';
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.includes('FROM orap_staff_memberships membership')) {
        return {
          rows: [
            {
              identity_kind: 'platform_owner',
              membership_id: '60000000-0000-4000-8000-000000000099',
              status: 'active',
              user_id: targetOwnerId,
            },
          ],
        };
      }
      if (text.includes("identity_kind = 'platform_owner'")) {
        return { rows: [{ id: '60000000-0000-4000-8000-000000000099' }] };
      }
      return { rows: [] };
    });
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { send: vi.fn() },
      vi.fn(),
    );

    await expect(
      service.disableStaff(actor, {
        reason: 'Fictional owner departure',
        userId: targetOwnerId,
      }),
    ).rejects.toThrow('last active Platform Owner');
    expect(query.mock.calls.some(([text]) => text.includes('UPDATE platform_memberships'))).toBe(
      false,
    );
  });

  it('promotes existing staff to Platform Owner and revokes their active sessions', async () => {
    const targetUserId = '40000000-0000-4000-8000-000000000099';
    const targetMembershipId = '60000000-0000-4000-8000-000000000099';
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (text.includes("WHERE user_id = $1 AND status = 'active'")) {
        return {
          rows: [{ identity_kind: 'staff', membership_id: targetMembershipId }],
        };
      }
      if (text.includes('FROM staff_roles role')) {
        expect(values).toEqual(['platform-owner', true]);
        return {
          rows: [
            {
              id: 'role-owner',
              name: 'Platform Owner',
              owner_identity_only: true,
              role_version_id: 'role-owner-v1',
              slug: 'platform-owner',
            },
          ],
        };
      }
      if (text.includes('SELECT assignment.id')) {
        return {
          rows: [{ id: 'assignment-a', name: 'Operations Manager', slug: 'operations-manager' }],
        };
      }
      if (text.includes('UPDATE sessions')) return { rows: [{ id: 'session-a' }] };
      return { rows: [] };
    });
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { send: vi.fn() },
      vi.fn(),
    );

    await expect(
      service.changeStaffRole(actor, {
        reason: 'Platform Owner changed a staff role through Team & access',
        roleSlug: 'platform-owner',
        userId: targetUserId,
      }),
    ).resolves.toEqual({
      identityKind: 'platform_owner',
      roleName: 'Platform Owner',
      revokedSessions: 1,
    });
    expect(
      query.mock.calls.some(([text]) => text.includes('INSERT INTO staff_role_assignments')),
    ).toBe(false);
    expect(
      query.mock.calls.find(([text]) => text.includes('UPDATE platform_memberships'))?.[1],
    ).toEqual([targetUserId, 'platform_owner']);
    expect(query.mock.calls.find(([text]) => text.includes('staff_access_audits'))?.[1]).toEqual(
      expect.arrayContaining([actor.id, targetUserId, 'staff.owner_assigned']),
    );
  });

  it('refuses to demote the final active Platform Owner', async () => {
    const targetUserId = '40000000-0000-4000-8000-000000000099';
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (text.includes("WHERE user_id = $1 AND status = 'active'")) {
        return {
          rows: [
            {
              identity_kind: 'platform_owner',
              membership_id: '60000000-0000-4000-8000-000000000099',
            },
          ],
        };
      }
      if (text.includes('FROM staff_roles role')) {
        return {
          rows: [
            {
              id: 'role-admin',
              name: 'Platform Admin',
              owner_identity_only: false,
              role_version_id: 'role-admin-v1',
              slug: 'platform-admin',
            },
          ],
        };
      }
      if (text.includes('SELECT assignment.id')) return { rows: [] };
      if (text.includes("identity_kind = 'platform_owner'")) {
        return { rows: [{ id: '60000000-0000-4000-8000-000000000099' }] };
      }
      return { rows: [] };
    });
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { send: vi.fn() },
      vi.fn(),
    );

    await expect(
      service.changeStaffRole(actor, {
        reason: 'Platform Owner changed a staff role through Team & access',
        roleSlug: 'platform-admin',
        userId: targetUserId,
      }),
    ).rejects.toThrow('last active Platform Owner cannot be demoted');
    expect(query.mock.calls.some(([text]) => text.includes('UPDATE staff_role_assignments'))).toBe(
      false,
    );
    expect(query.mock.calls.some(([text]) => text.includes('UPDATE platform_memberships'))).toBe(
      false,
    );
  });

  it('revokes privileged staff sessions and records an immutable access audit', async () => {
    const targetUserId = '40000000-0000-4000-8000-000000000099';
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.includes('SELECT user_id FROM orap_staff_memberships')) {
        return { rows: [{ user_id: targetUserId }] };
      }
      if (text.includes('UPDATE sessions')) {
        return { rows: [{ id: 'session-a' }, { id: 'session-b' }] };
      }
      return { rows: [] };
    });
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { send: vi.fn() },
      vi.fn(),
    );

    await expect(
      service.revokeStaffSessions(actor, {
        reason: 'Owner-approved fictional session revocation',
        userId: targetUserId,
      }),
    ).resolves.toEqual({ revokedSessions: 2 });
    const audit = query.mock.calls.find(([text]) => text.includes('staff_access_audits'));
    expect(audit?.[1]).toEqual(
      expect.arrayContaining([
        actor.id,
        targetUserId,
        'staff.sessions_revoked',
        'Owner-approved fictional session revocation',
      ]),
    );
  });

  it('filters website reads to the grant scope and rechecks the authorization version', async () => {
    const scopedActor = {
      authorization: {
        grants: [
          {
            assignmentId: 'assignment-a',
            permissionKeys: ['websites.list'],
            portfolio: false,
            siteIds: ['20000000-0000-4000-8000-000000000001'],
            tenantIds: ['10000000-0000-4000-8000-000000000001'],
          },
        ],
        membershipId: '60000000-0000-4000-8000-000000000001',
        version: 7,
      },
      ...deniedStaff,
    };
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      if (text.includes('FROM orap_staff_memberships membership')) {
        return { rows: [{ id: scopedActor.authorization.membershipId }] };
      }
      if (text.includes('FROM sites s JOIN tenants')) {
        expect(values).toEqual([
          false,
          ['10000000-0000-4000-8000-000000000001'],
          ['20000000-0000-4000-8000-000000000001'],
        ]);
        return {
          rows: [
            {
              id: '20000000-0000-4000-8000-000000000001',
              name: 'Scoped site',
              status: 'active',
              tenant_id: '10000000-0000-4000-8000-000000000001',
              tenant_name: 'Scoped customer',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { send: vi.fn() },
      vi.fn(),
    );

    await expect(service.listSites(scopedActor)).resolves.toEqual([
      {
        id: '20000000-0000-4000-8000-000000000001',
        name: 'Scoped site',
        status: 'active',
        tenantId: '10000000-0000-4000-8000-000000000001',
        tenantName: 'Scoped customer',
      },
    ]);
    expect(
      String(query.mock.calls.find(([text]) => text.includes('FROM orap_staff'))?.[0]),
    ).toContain('authorization_version = $4');
  });

  it('rejects a stale authorization version before reading protected records', async () => {
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void text;
      void values;
      return { rows: [] };
    });
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { send: vi.fn() },
      vi.fn(),
    );
    const staleActor = {
      authorization: {
        grants: [
          {
            assignmentId: 'assignment-a',
            permissionKeys: ['websites.list'],
            portfolio: true,
            siteIds: [],
            tenantIds: [],
          },
        ],
        membershipId: '60000000-0000-4000-8000-000000000001',
        version: 2,
      },
      ...deniedStaff,
    };

    await expect(service.listSites(staleActor)).rejects.toMatchObject({
      code: 'orap_authorization_denied',
    });
    expect(query.mock.calls.some(([text]) => text.includes('FROM sites s JOIN tenants'))).toBe(
      false,
    );
  });

  it('acknowledges an alert under the platform role and records the audited transition', async () => {
    const alertId = '80000000-0000-4000-8000-000000000001';
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.includes('FROM alerts WHERE id = $1 FOR UPDATE')) {
        return {
          rows: [
            {
              fingerprint: 'fixture-fingerprint',
              id: alertId,
              occurrences: 2,
              severity: 'critical',
              site_id: '20000000-0000-4000-8000-000000000001',
              state: 'open',
              tenant_id: '10000000-0000-4000-8000-000000000001',
            },
          ],
        };
      }
      if (text.includes('UPDATE alerts')) {
        return {
          rows: [
            {
              fingerprint: 'fixture-fingerprint',
              id: alertId,
              occurrences: 2,
              severity: 'critical',
              site_id: '20000000-0000-4000-8000-000000000001',
              state: 'acknowledged',
              tenant_id: '10000000-0000-4000-8000-000000000001',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { send: vi.fn() },
      vi.fn(),
    );

    await expect(
      service.acknowledgeAlert(actor, {
        alertId,
        reason: 'Investigating fictional worker failure',
      }),
    ).resolves.toMatchObject({ id: alertId, state: 'acknowledged' });
    expect(query.mock.calls.slice(0, 3).map(([text]) => text)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE omnireach_platform',
      `SELECT set_config('app.platform_actor_id', $1, true)`,
    ]);
    const audit = query.mock.calls.find(([text]) => text.includes('INSERT INTO audit_events'));
    expect(audit?.[1]).toEqual(
      expect.arrayContaining([
        'alert.acknowledged',
        'Investigating fictional worker failure',
        alertId,
      ]),
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('cancels queued work and admits a terminal replay with audited durable states', async () => {
    const originalJobId = '70000000-0000-4000-8000-000000000001';
    const replayJobId = '70000000-0000-4000-8000-000000000002';
    let originalState = 'queued';
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.includes('SELECT id, tenant_id, site_id, category, state, trace_id')) {
        return {
          rows: [
            {
              category: 'seo_audit',
              id: originalJobId,
              site_id: '20000000-0000-4000-8000-000000000001',
              state: originalState,
              tenant_id: '10000000-0000-4000-8000-000000000001',
              trace_id: 'trace-fictional-original',
            },
          ],
        };
      }
      if (text.includes("SET state = 'cancelled'")) {
        originalState = 'cancelled';
        return {
          rows: [
            {
              category: 'seo_audit',
              id: originalJobId,
              site_id: '20000000-0000-4000-8000-000000000001',
              state: originalState,
              tenant_id: '10000000-0000-4000-8000-000000000001',
              trace_id: 'trace-fictional-original',
            },
          ],
        };
      }
      if (text.includes('SELECT * FROM jobs')) {
        return {
          rows: [
            {
              attempt_limit: 3,
              category: 'seo_audit',
              id: originalJobId,
              policy_version: 1,
              record_id: '20000000-0000-4000-8000-000000000001',
              schema_version: 1,
              site_id: '20000000-0000-4000-8000-000000000001',
              state: originalState,
              tenant_id: '10000000-0000-4000-8000-000000000001',
            },
          ],
        };
      }
      if (text.includes('INSERT INTO jobs')) {
        return {
          rows: [
            {
              category: 'seo_audit',
              dedupe_key: `replay:${originalJobId}:fixture`,
              id: replayJobId,
              site_id: '20000000-0000-4000-8000-000000000001',
              state: 'queued',
              tenant_id: '10000000-0000-4000-8000-000000000001',
              trace_id: 'trace-fictional-replay',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { send: vi.fn() },
      vi.fn(),
    );

    await expect(
      service.cancelJob(actor, { jobId: originalJobId, reason: 'Cancel stale fictional work' }),
    ).resolves.toMatchObject({ state: 'cancelled' });
    await expect(
      service.replayJob(actor, {
        jobId: originalJobId,
        reason: 'Replay after fictional dependency recovery',
      }),
    ).resolves.toMatchObject({ id: replayJobId, state: 'queued' });
    const audits = query.mock.calls.filter(([text]) => text.includes('INSERT INTO audit_events'));
    expect(audits).toHaveLength(2);
    expect(audits[0]?.[1]).toEqual(expect.arrayContaining(['job.cancelled', originalJobId]));
    expect(audits[1]?.[1]).toEqual(expect.arrayContaining(['job.replayed', replayJobId]));
  });

  it('creates the tenant, site, and audit in one platform transaction', async () => {
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.includes('INSERT INTO tenants')) {
        return { rows: [{ id: 'tenant-a', name: 'Agency Client', status: 'active' }] };
      }
      if (text.includes('INSERT INTO sites')) {
        return {
          rows: [{ id: 'site-a', name: 'Custom Site', status: 'active', tenant_id: 'tenant-a' }],
        };
      }
      return { rows: [] };
    });
    const pool: TenantTransactionPool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };
    const service = new PostgresOrapService(
      pool,
      { send: vi.fn() },
      vi.fn(),
      new Map([['sites/custom-fixture', { contractHash: 'a'.repeat(64), contractVersion: '1.0' }]]),
    );
    await expect(
      service.createTenantAndSite(actor, {
        reason: 'Approved agency onboarding',
        siteName: 'Custom Site',
        sourcePath: 'sites/custom-fixture',
        tenantName: 'Agency Client',
      }),
    ).resolves.toMatchObject({ site: { id: 'site-a' }, tenant: { id: 'tenant-a' } });
    expect(query.mock.calls.slice(0, 3).map(([text]) => text)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE omnireach_platform',
      `SELECT set_config('app.platform_actor_id', $1, true)`,
    ]);
    const audit = query.mock.calls.find(([text]) => text.includes('INSERT INTO audit_events'));
    expect(audit?.[1]).toEqual(
      expect.arrayContaining(['site.created', 'Approved agency onboarding', 'trace-orap-1']),
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('stores only the invitation digest and delivers the raw token out of band', async () => {
    let insertValues: unknown[] | undefined;
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      if (text.startsWith('SELECT id FROM sites')) return { rows: [{ id: 'site-a' }] };
      if (text.includes('SELECT hostname FROM domains')) {
        return { rows: [{ hostname: 'admin.customer.test' }] };
      }
      if (text.includes('SELECT p.customer_seat_limit')) {
        return { rows: [{ customer_seat_limit: 2, occupied: 0 }] };
      }
      if (text.includes('INSERT INTO customer_invitations')) {
        insertValues = values;
        return { rows: [{ id: '70000000-0000-4000-8000-000000000001' }] };
      }
      return { rows: [] };
    });
    const notifier: InvitationNotifier = {
      send: vi.fn(async (input: { host: string; normalizedEmail: string; token: string }) => {
        void input;
      }),
    };
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      notifier,
      vi.fn(),
    );
    const result = await service.inviteCustomer(actor, {
      email: ' OWNER@EXAMPLE.TEST ',
      reason: 'Approved customer access',
      role: 'customer_owner',
      siteId: 'site-a',
      tenantId: 'tenant-a',
    });
    expect(result).toEqual({
      invitationId: '70000000-0000-4000-8000-000000000001',
      status: 'pending',
    });
    expect(insertValues?.[2]).toBe('owner@example.test');
    expect(insertValues?.[4]).toMatch(/^[a-f0-9]{64}$/u);
    const delivered = vi.mocked(notifier.send).mock.calls[0]?.[0];
    expect(delivered?.normalizedEmail).toBe('owner@example.test');
    expect(delivered?.host).toBe('admin.customer.test');
    expect(delivered?.token).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(insertValues).not.toContain(delivered?.token);
  });

  it('revokes exact-site sessions in the same transaction as a customer role change', async () => {
    const before = {
      active: true,
      id: 'membership-a',
      role: 'customer_viewer',
      site_id: 'site-a',
      tenant_id: 'tenant-a',
      user_id: 'user-a',
    };
    const after = { ...before, role: 'customer_editor' };
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.includes('FROM memberships WHERE id = $1')) return { rows: [before] };
      if (text.includes('UPDATE memberships SET role')) return { rows: [after] };
      if (text.includes("revoke_reason = 'membership-role-changed'")) {
        return { rows: [{ id: 'session-a' }, { id: 'session-b' }] };
      }
      return { rows: [] };
    });
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { send: vi.fn() },
      vi.fn(),
    );

    await expect(
      service.changeCustomerRole(actor, {
        membershipId: before.id,
        reason: 'Approved access adjustment',
        role: 'customer_editor',
        siteId: before.site_id,
      }),
    ).resolves.toEqual({ membership: after, revokedSessions: 2 });
    expect(query.mock.calls.some(([text]) => text.includes('UPDATE sessions'))).toBe(true);
    const audit = query.mock.calls.find(([text]) => text.includes('INSERT INTO audit_events'));
    expect(audit?.[1]).toEqual(
      expect.arrayContaining([
        'membership.role_changed',
        'Approved access adjustment',
        expect.stringContaining('"revokedSessions":2'),
      ]),
    );
  });

  it('restricts site budget changes and records an attributable override', async () => {
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.startsWith('SELECT id FROM sites')) return { rows: [{ id: 'site-a' }] };
      if (text.includes('SELECT * FROM site_ai_budgets')) {
        return { rows: [{ cap_usd_micros: '5000000', policy_version: 1 }] };
      }
      if (text.includes('INSERT INTO site_ai_budgets')) {
        return {
          rows: [
            {
              cap_usd_micros: '7000000',
              override_actor_id: actor.id,
              override_reason: 'Approved test increase',
              policy_version: 2,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { send: vi.fn() },
      vi.fn(),
    );
    const input = {
      capUsdMicros: 7_000_000,
      policyVersion: 2,
      reason: 'Approved test increase',
      siteId: 'site-a',
      tenantId: 'tenant-a',
    };

    expect(() => service.setSiteAiBudget(deniedStaff, input)).toThrow(/not authorized/u);
    await expect(service.setSiteAiBudget(actor, input)).resolves.toMatchObject({
      cap_usd_micros: '7000000',
    });
    const audit = query.mock.calls.find(([text]) => text.includes('INSERT INTO audit_events'));
    expect(audit?.[1]).toEqual(
      expect.arrayContaining(['site.ai_budget_changed', 'Approved test increase', actor.id]),
    );
    expect(query.mock.calls.some(([text]) => text.includes('UPDATE ai_budget_periods'))).toBe(true);
  });

  it('lists only safe metadata for an exact tenant, site, and customer user', async () => {
    const tenantId = '10000000-0000-4000-8000-000000000001';
    const siteId = '20000000-0000-4000-8000-000000000001';
    const userId = '30000000-0000-4000-8000-000000000001';
    const sessionId = '50000000-0000-4000-8000-000000000001';
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.includes('SELECT id FROM users')) return { rows: [{ id: userId }] };
      if (text.includes('FROM memberships m')) return { rows: [{ id: 'membership-a' }] };
      if (text.includes('SELECT id, host, created_at, last_seen_at, expires_at')) {
        return {
          rows: [
            {
              authentication_method: 'totp',
              created_at: new Date('2026-10-11T01:00:00.000Z'),
              expires_at: new Date('2026-10-12T01:00:00.000Z'),
              host: 'admin.customer.test',
              id: sessionId,
              last_seen_at: new Date('2026-10-11T02:00:00.000Z'),
              token_hash: 'must-not-leave-the-repository',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { send: vi.fn() },
      vi.fn(),
    );

    await expect(
      service.listCustomerSessions(sessionAdministrator, { siteId, tenantId, userId }),
    ).resolves.toEqual({
      sessions: [
        {
          createdAt: new Date('2026-10-11T01:00:00.000Z'),
          expiresAt: new Date('2026-10-12T01:00:00.000Z'),
          host: 'admin.customer.test',
          id: sessionId,
          lastSeenAt: new Date('2026-10-11T02:00:00.000Z'),
        },
      ],
    });
    const userLockIndex = query.mock.calls.findIndex(([text]) =>
      text.includes('SELECT id FROM users'),
    );
    const membershipLockIndex = query.mock.calls.findIndex(([text]) =>
      text.includes('FROM memberships m'),
    );
    expect(userLockIndex).toBeGreaterThan(-1);
    expect(membershipLockIndex).toBeGreaterThan(userLockIndex);
    expect(query.mock.calls[userLockIndex]?.[1]).toEqual([userId]);
    const scope = query.mock.calls.find(([text]) => text.includes('FROM memberships m'));
    expect(scope?.[0]).not.toContain('JOIN users');
    expect(scope?.[1]).toEqual([tenantId, siteId, userId]);
    const listing = query.mock.calls.find(([text]) =>
      text.includes('SELECT id, host, created_at, last_seen_at, expires_at'),
    );
    expect(listing?.[0]).not.toMatch(/token_hash|authentication_method|factor|credential/iu);
    expect(listing?.[0]).toContain("last_seen_at > now() - interval '30 minutes'");
    expect(listing?.[1]).toEqual([tenantId, siteId, userId]);
  });

  it('revokes one or all sessions only after locking the exact customer site scope', async () => {
    const tenantId = '10000000-0000-4000-8000-000000000001';
    const siteId = '20000000-0000-4000-8000-000000000001';
    const userId = '30000000-0000-4000-8000-000000000001';
    const sessionId = '50000000-0000-4000-8000-000000000001';
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.includes('SELECT id FROM users')) return { rows: [{ id: userId }] };
      if (text.includes('FROM memberships m')) return { rows: [{ id: 'membership-a' }] };
      if (text.includes("revoke_reason = 'orap-exact-site-revocation'")) {
        return { rows: [{ id: sessionId }] };
      }
      if (text.includes("revoke_reason = 'orap-exact-site-revoke-all'")) {
        return { rows: [{ id: sessionId }, { id: '50000000-0000-4000-8000-000000000002' }] };
      }
      return { rows: [] };
    });
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { send: vi.fn() },
      vi.fn(),
    );

    await expect(
      service.revokeCustomerSession(sessionAdministrator, {
        reason: 'Revoke a reported browser session',
        sessionId,
        siteId,
        tenantId,
        userId,
      }),
    ).resolves.toEqual({ revokedSessions: 1 });
    await expect(
      service.revokeAllCustomerSessions(sessionAdministrator, {
        reason: 'Customer requested a complete sign-out',
        siteId,
        tenantId,
        userId,
      }),
    ).resolves.toEqual({ revokedSessions: 2 });

    const updates = query.mock.calls.filter(([text]) => text.includes('UPDATE sessions'));
    expect(updates[0]?.[1]).toEqual([sessionId, tenantId, siteId, userId]);
    expect(updates[1]?.[1]).toEqual([tenantId, siteId, userId]);
    const audits = query.mock.calls.filter(([text]) => text.includes('INSERT INTO audit_events'));
    expect(audits).toHaveLength(2);
    expect(audits[0]?.[1]).toEqual(
      expect.arrayContaining([
        tenantId,
        siteId,
        sessionAdministrator.id,
        'customer.session.revoked',
        'Revoke a reported browser session',
        sessionId,
        expect.stringContaining('"revokedSessions":1'),
      ]),
    );
    expect(audits[1]?.[1]).toEqual(
      expect.arrayContaining([
        'customer.sessions.revoked',
        'Customer requested a complete sign-out',
        userId,
        expect.stringContaining('"revokedSessions":2'),
      ]),
    );
  });

  it('fails closed for hostile cross-site scope and denies staff before opening a transaction', async () => {
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.includes('SELECT id FROM users')) return { rows: [{ id: 'customer-a' }] };
      if (text.includes('FROM memberships m')) return { rows: [] };
      return { rows: [] };
    });
    const connect = vi.fn(async () => ({ query, release: vi.fn() }));
    const service = new PostgresOrapService({ connect }, { send: vi.fn() }, vi.fn());
    const hostileInput = {
      reason: 'Attempt to revoke a session through the wrong site',
      sessionId: '50000000-0000-4000-8000-000000000001',
      siteId: '20000000-0000-4000-8000-000000000099',
      tenantId: '10000000-0000-4000-8000-000000000001',
      userId: '30000000-0000-4000-8000-000000000001',
    };

    await expect(
      service.revokeCustomerSession(sessionAdministrator, hostileInput),
    ).rejects.toMatchObject({
      message: 'Active customer site membership was not found',
      name: 'OrapResourceNotFoundError',
    });
    expect(query.mock.calls.some(([text]) => text.includes('UPDATE sessions'))).toBe(false);
    expect(query.mock.calls.some(([text]) => text.includes('INSERT INTO audit_events'))).toBe(
      false,
    );

    const callsBeforeStaff = connect.mock.calls.length;
    expect(() =>
      service.revokeAllCustomerSessions(deniedStaff, {
        reason: 'Staff lacks an explicit session administration grant',
        siteId: hostileInput.siteId,
        tenantId: hostileInput.tenantId,
        userId: hostileInput.userId,
      }),
    ).toThrow('not authorized');
    expect(connect).toHaveBeenCalledTimes(callsBeforeStaff);
  });

  it('cannot revoke a different site session through an otherwise valid customer scope', async () => {
    const tenantId = '10000000-0000-4000-8000-000000000001';
    const siteId = '20000000-0000-4000-8000-000000000001';
    const userId = '30000000-0000-4000-8000-000000000001';
    const crossSiteSessionId = '50000000-0000-4000-8000-000000000099';
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.includes('SELECT id FROM users')) return { rows: [{ id: userId }] };
      if (text.includes('FROM memberships m')) return { rows: [{ id: 'membership-a' }] };
      return { rows: [] };
    });
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      { send: vi.fn() },
      vi.fn(),
    );

    await expect(
      service.revokeCustomerSession(sessionAdministrator, {
        reason: 'Reject a session identifier copied from another site',
        sessionId: crossSiteSessionId,
        siteId,
        tenantId,
        userId,
      }),
    ).rejects.toMatchObject({
      message: 'Customer session was not found',
      name: 'OrapResourceNotFoundError',
    });
    const update = query.mock.calls.find(([text]) => text.includes('UPDATE sessions'));
    expect(update?.[0]).toContain('id = $1 AND tenant_id = $2 AND site_id = $3 AND user_id = $4');
    expect(update?.[1]).toEqual([crossSiteSessionId, tenantId, siteId, userId]);
    const audit = query.mock.calls.find(([text]) => text.includes('INSERT INTO audit_events'));
    expect(audit).toBeUndefined();
  });
});
