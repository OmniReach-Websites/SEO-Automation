import {
  assertOrapCapability,
  assertPlatformOwnerIdentity,
  assertRecentStrongOrapStepUp,
  canOrap,
  orapVisibleScope,
  type OrapAuthorizationActor,
} from '@omnireach/auth';
import { describe, expect, it } from 'vitest';

const owner: OrapAuthorizationActor = { role: 'platform_owner' };
const scopedStaff: OrapAuthorizationActor = {
  authorization: {
    grants: [
      {
        assignmentId: 'assignment-content',
        permissionKeys: ['websites.list', 'websites.view', 'websites.content.edit'],
        portfolio: false,
        siteIds: ['site-a'],
        tenantIds: [],
      },
      {
        assignmentId: 'assignment-analytics',
        permissionKeys: ['analytics.view'],
        portfolio: false,
        siteIds: [],
        tenantIds: ['tenant-b'],
      },
    ],
    membershipId: 'staff-membership',
    version: 3,
  },
  role: 'staff',
};

describe('ORAP effective authorization', () => {
  it('gives owners functional access without making owner capabilities assignable', () => {
    expect(canOrap(owner, 'dashboard.view_financials')).toBe(true);
    expect(canOrap(owner, 'staff.invite')).toBe(true);
    expect(() => assertPlatformOwnerIdentity(owner)).not.toThrow();
  });

  it('fails closed for non-owners without normalized authorization state', () => {
    expect(canOrap({ role: 'platform_admin' }, 'dashboard.view')).toBe(false);
    expect(canOrap({ role: 'staff' }, 'websites.list')).toBe(false);
    expect(() => assertPlatformOwnerIdentity(scopedStaff)).toThrow(
      'Platform Owner identity is required',
    );
  });

  it('keeps permission and scope on the same assignment', () => {
    expect(canOrap(scopedStaff, 'websites.view', { siteId: 'site-a' })).toBe(true);
    expect(canOrap(scopedStaff, 'websites.view', { siteId: 'site-b' })).toBe(false);
    expect(canOrap(scopedStaff, 'analytics.view', { tenantId: 'tenant-b' })).toBe(true);
    expect(canOrap(scopedStaff, 'analytics.view', { siteId: 'site-a' })).toBe(false);
    expect(canOrap(scopedStaff, 'automation.workers.view')).toBe(false);
    expect(() =>
      assertOrapCapability(scopedStaff, 'websites.content.edit', { siteId: 'site-b' }),
    ).toThrow('not authorized');
  });

  it('derives list scope only from assignments that hold the requested capability', () => {
    const websiteScope = orapVisibleScope(scopedStaff, 'websites.list');
    expect(websiteScope.portfolio).toBe(false);
    expect([...websiteScope.siteIds]).toEqual(['site-a']);
    expect([...websiteScope.tenantIds]).toEqual([]);

    const analyticsScope = orapVisibleScope(scopedStaff, 'analytics.view');
    expect([...analyticsScope.siteIds]).toEqual([]);
    expect([...analyticsScope.tenantIds]).toEqual(['tenant-b']);
  });

  it('never allows owner-only capabilities through custom assignments', () => {
    const spoofed: OrapAuthorizationActor = {
      authorization: {
        grants: [
          {
            assignmentId: 'spoofed',
            permissionKeys: ['staff.invite', 'owners.manage'],
            portfolio: true,
            siteIds: [],
            tenantIds: [],
          },
        ],
        membershipId: 'membership',
        version: 1,
      },
      role: 'platform_admin',
    };
    expect(canOrap(spoofed, 'staff.invite')).toBe(false);
    expect(canOrap(spoofed, 'owners.manage')).toBe(false);
  });

  it('requires a recent strong factor for owner-level authority changes', () => {
    const now = new Date('2026-10-12T12:00:00.000Z');
    expect(() =>
      assertRecentStrongOrapStepUp(
        {
          authenticationAssurance: 'strong',
          role: 'platform_owner',
          verifiedAt: new Date('2026-10-12T11:55:00.000Z'),
        },
        now,
      ),
    ).not.toThrow();
    expect(() =>
      assertRecentStrongOrapStepUp(
        {
          authenticationAssurance: 'baseline',
          role: 'platform_owner',
          verifiedAt: new Date('2026-10-12T11:59:00.000Z'),
        },
        now,
      ),
    ).toThrow('Recent authenticator or passkey verification');
    expect(() =>
      assertRecentStrongOrapStepUp(
        {
          authenticationAssurance: 'strong',
          role: 'platform_owner',
          verifiedAt: new Date('2026-10-12T11:40:00.000Z'),
        },
        now,
      ),
    ).toThrow('Recent authenticator or passkey verification');
  });
});
