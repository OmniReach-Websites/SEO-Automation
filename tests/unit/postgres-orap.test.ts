import { PostgresOrapService, type InvitationNotifier } from '@omnireach/api/postgres-orap';
import type { TenantTransactionPool } from '@omnireach/tenant';
import { describe, expect, it, vi } from 'vitest';

const actor = {
  id: '40000000-0000-4000-8000-000000000001',
  role: 'staff' as const,
  traceId: 'trace-orap-1',
};

describe('PostgreSQL ORAP service', () => {
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

    expect(() => service.setSiteAiBudget(actor, input)).toThrow(/platform owner/u);
    await expect(
      service.setSiteAiBudget({ ...actor, role: 'platform_owner' }, input),
    ).resolves.toMatchObject({ cap_usd_micros: '7000000' });
    const audit = query.mock.calls.find(([text]) => text.includes('INSERT INTO audit_events'));
    expect(audit?.[1]).toEqual(
      expect.arrayContaining(['site.ai_budget_changed', 'Approved test increase', actor.id]),
    );
    expect(query.mock.calls.some(([text]) => text.includes('UPDATE ai_budget_periods'))).toBe(true);
  });
});
