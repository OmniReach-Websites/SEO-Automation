import { renderOrapDashboard } from '@omnireach/orap';
import {
  CustomerAccessAdministrationService,
  TenantAdministrationService,
  type AdminAuditEvent,
  type CustomerMembership,
} from '@omnireach/tenant';
import { describe, expect, it, vi } from 'vitest';

const authorizedStaff = {
  authorization: {
    grants: [
      {
        assignmentId: 'assignment-a',
        permissionKeys: [
          'customers.create',
          'websites.create',
          'websites.disable',
          'customers.users.manage',
          'security.customer_access.manage',
        ],
        portfolio: true,
        siteIds: [],
        tenantIds: [],
      },
    ],
    membershipId: 'membership-a',
    version: 1,
  },
  id: 'staff-a',
  role: 'staff' as const,
  traceId: 'trace-staff-a',
};

describe('ORAP administration slice', () => {
  it('creates tenant and site with the audit event in one transaction', async () => {
    const audit: AdminAuditEvent[] = [];
    const service = new TenantAdministrationService({
      transaction: async (operation) =>
        operation({
          audit: async (event) => void audit.push(event),
          createSite: vi.fn(async ({ name, tenantId }) => ({
            id: 'site-a',
            name,
            status: 'active' as const,
            tenantId,
          })),
          createTenant: vi.fn(async ({ name }) => ({
            id: 'tenant-a',
            name,
            status: 'active' as const,
          })),
          disableSite: vi.fn(),
        }),
    });
    await service.createTenantAndSite(
      { ...authorizedStaff, traceId: 'trace-000000000001' },
      {
        reason: 'Onboard fictional fixture',
        siteName: 'Copper Spoon',
        tenantName: 'Lantern Hospitality',
      },
    );
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'site.created',
        actorId: 'staff-a',
        reason: 'Onboard fictional fixture',
        traceId: 'trace-000000000001',
      }),
    ]);
  });

  it('denies customer roles and reasonless high-risk changes', async () => {
    const service = new TenantAdministrationService({ transaction: vi.fn() });
    await expect(
      service.disableSite(
        { id: 'customer', role: 'customer_owner', traceId: 'trace' },
        'site-a',
        'Request',
      ),
    ).rejects.toThrow('not authorized');
    await expect(
      service.disableSite({ ...authorizedStaff, traceId: 'trace' }, 'site-a', ' '),
    ).rejects.toThrow('reason');
  });

  it('renders an accessible shell and escapes customer-controlled names', () => {
    const html = renderOrapDashboard(
      [{ name: '<script>bad()</script>', status: 'active', tenantName: 'Fictional' }],
      'Created',
    );
    expect(html).toContain('Skip to content');
    expect(html).toContain('<caption>');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('<script>');
  });

  it('manages customer membership and revokes site sessions transactionally', async () => {
    const audit: AdminAuditEvent[] = [];
    const before: CustomerMembership = {
      active: true,
      id: 'membership-a',
      role: 'customer_editor',
      siteId: 'site-a',
      tenantId: 'tenant-a',
      userId: 'user-a',
    };
    const service = new CustomerAccessAdministrationService({
      transaction: async (operation) =>
        operation({
          audit: async (event) => void audit.push(event),
          changeMembershipRole: vi.fn(),
          createInvitation: vi.fn(),
          disableMembership: vi.fn(async () => ({
            after: { ...before, active: false },
            before,
          })),
          initiatePasswordReset: vi.fn(),
          revokeUserSiteSessions: vi.fn(async () => 2),
        }),
    });

    const result = await service.disable(
      { ...authorizedStaff, traceId: 'trace-000000000002' },
      { membershipId: 'membership-a', reason: 'Customer departure', siteId: 'site-a' },
    );

    expect(result).toEqual({ membership: { ...before, active: false }, revokedSessions: 2 });
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'membership.disabled',
        after: expect.objectContaining({ revokedSessions: 2 }),
        before,
      }),
    ]);
  });

  it('revokes site sessions when a customer role changes', async () => {
    const audit: AdminAuditEvent[] = [];
    const before: CustomerMembership = {
      active: true,
      id: 'membership-a',
      role: 'customer_viewer',
      siteId: 'site-a',
      tenantId: 'tenant-a',
      userId: 'user-a',
    };
    const after = { ...before, role: 'customer_editor' as const };
    const revokeUserSiteSessions = vi.fn(async () => 2);
    const service = new CustomerAccessAdministrationService({
      transaction: async (operation) =>
        operation({
          audit: async (event) => void audit.push(event),
          changeMembershipRole: vi.fn(async () => ({ after, before })),
          createInvitation: vi.fn(),
          disableMembership: vi.fn(),
          initiatePasswordReset: vi.fn(),
          revokeUserSiteSessions,
        }),
    });

    await expect(
      service.changeRole(
        { ...authorizedStaff, traceId: 'trace-role-change' },
        {
          membershipId: before.id,
          reason: 'Approved access adjustment',
          role: 'customer_editor',
          siteId: before.siteId,
        },
      ),
    ).resolves.toEqual({ membership: after, revokedSessions: 2 });
    expect(revokeUserSiteSessions).toHaveBeenCalledWith({ siteId: 'site-a', userId: 'user-a' });
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'membership.role_changed',
        after: { membership: after, revokedSessions: 2 },
      }),
    ]);
  });

  it('normalizes invitations and rejects cross-site membership results', async () => {
    const base: CustomerMembership = {
      active: true,
      id: 'membership-a',
      role: 'customer_viewer',
      siteId: 'site-b',
      tenantId: 'tenant-a',
      userId: 'user-a',
    };
    const createInvitation = vi.fn(async () => ({ id: 'invitation-a', membership: base }));
    const service = new CustomerAccessAdministrationService({
      transaction: async (operation) =>
        operation({
          audit: vi.fn(),
          changeMembershipRole: vi.fn(async () => ({ before: base, after: base })),
          createInvitation,
          disableMembership: vi.fn(),
          initiatePasswordReset: vi.fn(),
          revokeUserSiteSessions: vi.fn(),
        }),
    });
    await service.invite(
      { ...authorizedStaff, id: 'admin', role: 'platform_admin', traceId: 'trace-000000000003' },
      {
        email: ' Customer@Example.Test ',
        reason: 'Approved access',
        role: 'customer_viewer',
        siteId: 'site-b',
        tenantId: 'tenant-a',
      },
    );
    expect(createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'customer@example.test' }),
    );
    await expect(
      service.changeRole(
        { ...authorizedStaff, id: 'admin', role: 'platform_admin', traceId: 'trace-000000000004' },
        {
          membershipId: 'membership-a',
          reason: 'Promote user',
          role: 'customer_editor',
          siteId: 'site-a',
        },
      ),
    ).rejects.toThrow('site scope mismatch');
  });
});
