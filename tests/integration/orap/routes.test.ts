import { buildApiServer } from '@omnireach/api';
import type { AdminActor } from '@omnireach/tenant';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrapResourceNotFoundError } from '../../../apps/api/src/orap-errors.ts';

const actor: AdminActor = {
  id: '00000000-0000-4000-8000-000000000001',
  role: 'platform_owner',
  traceId: 'trace-000000000001',
};
const deniedStaff: AdminActor = { ...actor, role: 'staff' };

function service() {
  return {
    acknowledgeAlert: vi.fn(async () => ({ state: 'acknowledged' })),
    assignPlan: vi.fn(async () => ({ status: 'assigned' })),
    cancelJob: vi.fn(async () => ({ state: 'cancelled' })),
    changeCustomerRole: vi.fn(),
    changeStaffRole: vi.fn(async () => ({ status: 'updated' })),
    createTenantAndSite: vi.fn(async () => ({
      site: { id: 'site-a' },
      tenant: { id: 'tenant-a' },
    })),
    createPlan: vi.fn(async () => ({ id: 'plan-a' })),
    disableCustomer: vi.fn(),
    disableStaff: vi.fn(async () => ({ status: 'disabled' })),
    inviteCustomer: vi.fn(async () => ({ invitationId: 'invitation-a', status: 'pending' })),
    inviteStaff: vi.fn(async () => ({ invitationId: 'staff-invitation-a', status: 'pending' })),
    listCustomerSessions: vi.fn(async () => ({
      sessions: [
        {
          createdAt: '2026-10-11T01:00:00.000Z',
          expiresAt: '2026-10-12T01:00:00.000Z',
          host: 'admin.customer.test',
          id: '50000000-0000-4000-8000-000000000001',
          lastSeenAt: '2026-10-11T02:00:00.000Z',
        },
      ],
    })),
    listSites: vi.fn(async () => []),
    siteManagement: vi.fn(async () => ({
      availability: { activeArtifact: true, preservedDuringDelinquency: true, publicDomain: true },
      features: [],
      plans: [],
      subscription: null,
    })),
    listOperations: vi.fn(async () => ({
      alerts: [],
      budget: {
        capUsdMicros: 50_000_000,
        periodStart: '2026-10-01T00:00:00.000Z',
        reservedUsdMicros: 0,
        usedUsdMicros: 0,
      },
      jobs: [],
    })),
    listStaff: vi.fn(async () => []),
    listStaffRoles: vi.fn(async () => [
      {
        description: 'Operations',
        name: 'Operations Manager',
        permissionCount: 12,
        slug: 'operations-manager',
      },
    ]),
    requestCustomerReset: vi.fn(async () => ({ status: 'accepted' })),
    requestStaffReset: vi.fn(async () => ({ status: 'accepted' })),
    revokeAllCustomerSessions: vi.fn(async () => ({ revokedSessions: 2 })),
    revokeCustomerSession: vi.fn(async () => ({ revokedSessions: 1 })),
    revokeStaffSessions: vi.fn(async () => ({ revokedSessions: 2 })),
    replayJob: vi.fn(async () => ({ state: 'queued' })),
    resolveAlert: vi.fn(async () => ({ state: 'resolved' })),
    setContactForm: vi.fn(async () => ({ status: 'updated' })),
    setContactSubmissionHold: vi.fn(async () => ({ status: 'updated' })),
    setEmergencyControls: vi.fn(async () => ({ status: 'updated' })),
    setFeatureOverride: vi.fn(async () => ({ status: 'updated' })),
    setPlatformAiBudget: vi.fn(async () => ({ status: 'updated' })),
    setQuotaOverride: vi.fn(async () => ({ status: 'updated' })),
    setSiteAiBudget: vi.fn(async () => ({ status: 'updated' })),
    setSubscriptionState: vi.fn(async () => ({ status: 'updated' })),
    updateStaffAccount: vi.fn(async () => ({ passwordReplaced: true, revokedSessions: 1 })),
  };
}

const servers: ReturnType<typeof buildApiServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe('ORAP administration routes', () => {
  it('returns effective site settings only through an authorized scoped request', async () => {
    const administration = service();
    const server = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => actor,
    });
    servers.push(server);
    const siteId = '20000000-0000-4000-8000-000000000001';
    const tenantId = '10000000-0000-4000-8000-000000000001';

    const response = await server.inject({
      method: 'GET',
      url: `/v1/orap/sites/${siteId}/effective-settings?tenantId=${tenantId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      availability: { preservedDuringDelinquency: true },
    });
    expect(administration.siteManagement).toHaveBeenCalledWith(actor, { siteId, tenantId });
  });

  it('keeps the internal staff directory restricted to the Platform Owner identity', async () => {
    const administration = service();
    const ownerServer = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => actor,
    });
    const deniedServer = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => deniedStaff,
    });
    servers.push(ownerServer, deniedServer);

    const allowed = await ownerServer.inject({ method: 'GET', url: '/v1/orap/staff' });
    const denied = await deniedServer.inject({ method: 'GET', url: '/v1/orap/staff' });

    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual([]);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'orap_owner_identity_required' });
    expect(administration.listStaff).toHaveBeenCalledTimes(1);
  });

  it('allows the current owner session and denies non-owners for staff security mutations', async () => {
    const administration = service();
    const ownerServer = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => actor,
    });
    const staffServer = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => ({
        ...deniedStaff,
        authenticationAssurance: 'strong',
        verifiedAt: new Date(),
      }),
    });
    servers.push(ownerServer, staffServer);
    const userId = '40000000-0000-4000-8000-000000000099';
    const request = {
      headers: { host: 'admin.omnireach.test', origin: 'https://admin.omnireach.test' },
      method: 'POST' as const,
      payload: { reason: 'Approved fictional staff security action' },
      url: `/v1/orap/staff/${userId}/sessions/revoke-all`,
    };

    const allowed = await ownerServer.inject(request);
    const denied = await staffServer.inject(request);

    expect(allowed.statusCode).toBe(200);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'orap_owner_identity_required' });
    expect(administration.revokeStaffSessions).toHaveBeenCalledTimes(1);
    expect(administration.revokeStaffSessions).toHaveBeenCalledWith(actor, {
      reason: 'Approved fictional staff security action',
      userId,
    });
  });

  it('lets only a current owner invite staff and change staff authority', async () => {
    const administration = service();
    const ownerServer = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => actor,
    });
    const staffServer = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => deniedStaff,
    });
    servers.push(ownerServer, staffServer);
    const headers = {
      host: 'admin.omnireach.test',
      origin: 'https://admin.omnireach.test',
    };
    const invitation = {
      headers,
      method: 'POST' as const,
      payload: {
        displayName: 'Fictional Employee',
        email: 'employee@example.test',
        reason: 'Approved fictional hire',
        roleSlug: 'operations-manager',
      },
      url: '/v1/orap/staff/invitations',
    };
    const allowedInvite = await ownerServer.inject(invitation);
    const deniedInvite = await staffServer.inject(invitation);
    const userId = '40000000-0000-4000-8000-000000000099';
    const allowedRole = await ownerServer.inject({
      headers,
      method: 'POST',
      payload: { reason: 'Approved fictional reassignment', roleSlug: 'operations-manager' },
      url: `/v1/orap/staff/${userId}/role`,
    });

    expect(allowedInvite.statusCode).toBe(201);
    expect(deniedInvite.statusCode).toBe(403);
    expect(allowedRole.statusCode).toBe(200);
    expect(administration.inviteStaff).toHaveBeenCalledWith(actor, {
      displayName: 'Fictional Employee',
      email: 'employee@example.test',
      host: 'admin.omnireach.test',
      reason: 'Approved fictional hire',
      roleSlug: 'operations-manager',
    });
    expect(administration.changeStaffRole).toHaveBeenCalledWith(actor, {
      reason: 'Approved fictional reassignment',
      roleSlug: 'operations-manager',
      userId,
    });
  });

  it('lets only a Platform Owner update staff identity and replace a password', async () => {
    const administration = service();
    const ownerServer = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => actor,
    });
    const staffServer = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => deniedStaff,
    });
    servers.push(ownerServer, staffServer);
    const userId = '40000000-0000-4000-8000-000000000099';
    const request = {
      headers: { host: 'admin.omnireach.test', origin: 'https://admin.omnireach.test' },
      method: 'PUT' as const,
      payload: {
        displayName: 'Recovered Owner',
        email: 'recovered@example.test',
        jobTitle: 'Platform Owner',
        newPassword: 'replacement-password-123',
        reason: 'Owner-approved account recovery',
      },
      url: `/v1/orap/staff/${userId}`,
    };

    const allowed = await ownerServer.inject(request);
    const denied = await staffServer.inject(request);

    expect(allowed.statusCode).toBe(200);
    expect(denied.statusCode).toBe(403);
    expect(administration.updateStaffAccount).toHaveBeenCalledTimes(1);
    expect(administration.updateStaffAccount).toHaveBeenCalledWith(actor, {
      ...request.payload,
      userId,
    });
  });

  it('lists operations and forwards same-origin audited alert transitions', async () => {
    const administration = service();
    const server = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => actor,
    });
    servers.push(server);
    const alertId = '80000000-0000-4000-8000-000000000001';
    const headers = {
      host: 'admin.omnireach.test',
      origin: 'https://admin.omnireach.test',
    };

    const operations = await server.inject({ method: 'GET', url: '/v1/orap/operations' });
    const acknowledged = await server.inject({
      headers,
      method: 'POST',
      payload: { reason: 'Investigating worker failure' },
      url: `/v1/orap/alerts/${alertId}/acknowledge`,
    });
    const resolved = await server.inject({
      headers,
      method: 'POST',
      payload: { reason: 'Worker recovered and checks passed' },
      url: `/v1/orap/alerts/${alertId}/resolve`,
    });
    const rejected = await server.inject({
      headers: { ...headers, origin: 'https://attacker.test' },
      method: 'POST',
      payload: { reason: 'Cross-origin attempt' },
      url: `/v1/orap/alerts/${alertId}/resolve`,
    });

    expect(operations.statusCode).toBe(200);
    expect(acknowledged.statusCode).toBe(200);
    expect(resolved.statusCode).toBe(200);
    expect(rejected.statusCode).toBe(403);
    expect(administration.listOperations).toHaveBeenCalledWith(actor);
    expect(administration.acknowledgeAlert).toHaveBeenCalledWith(actor, {
      alertId,
      reason: 'Investigating worker failure',
    });
    expect(administration.resolveAlert).toHaveBeenCalledTimes(1);
  });

  it('forwards permissioned cancel and replay controls through same-origin routes', async () => {
    const administration = service();
    const server = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => actor,
    });
    servers.push(server);
    const jobId = '70000000-0000-4000-8000-000000000001';
    const headers = {
      host: 'admin.omnireach.test',
      origin: 'https://admin.omnireach.test',
    };
    const cancelled = await server.inject({
      headers,
      method: 'POST',
      payload: { reason: 'Cancel stale fictional work' },
      url: `/v1/orap/jobs/${jobId}/cancel`,
    });
    const replayed = await server.inject({
      headers,
      method: 'POST',
      payload: { reason: 'Replay after fictional dependency recovery' },
      url: `/v1/orap/jobs/${jobId}/replay`,
    });

    expect(cancelled.statusCode).toBe(200);
    expect(replayed.statusCode).toBe(202);
    expect(administration.cancelJob).toHaveBeenCalledWith(actor, {
      jobId,
      reason: 'Cancel stale fictional work',
    });
    expect(administration.replayJob).toHaveBeenCalledWith(actor, {
      jobId,
      reason: 'Replay after fictional dependency recovery',
    });
  });

  it('derives the platform actor server-side and creates only validated fictional records', async () => {
    const administration = service();
    const server = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => actor,
    });
    servers.push(server);

    const response = await server.inject({
      headers: { host: 'admin.omnireach.test', origin: 'https://admin.omnireach.test' },
      method: 'POST',
      payload: {
        reason: 'Create fictional fixture',
        siteName: 'Copper Spoon',
        sourcePath: 'sites/_starter',
        tenantName: 'Lantern Hospitality',
      },
      url: '/v1/orap/sites',
    });

    expect(response.statusCode).toBe(201);
    expect(administration.createTenantAndSite).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ reason: 'Create fictional fixture' }),
    );
  });

  it('rejects customer principals and cross-origin mutations without invoking services', async () => {
    const administration = service();
    const server = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => ({ ...actor, role: 'customer_owner' }),
    });
    servers.push(server);

    const forbidden = await server.inject({ method: 'GET', url: '/v1/orap/sites' });
    const crossOrigin = await server.inject({
      headers: { host: 'admin.omnireach.test', origin: 'https://attacker.test' },
      method: 'POST',
      payload: {
        reason: 'Create fixture',
        siteName: 'Site',
        sourcePath: 'sites/_starter',
        tenantName: 'Tenant',
      },
      url: '/v1/orap/sites',
    });

    expect(forbidden.statusCode).toBe(403);
    expect(crossOrigin.statusCode).toBe(403);
    expect(administration.listSites).not.toHaveBeenCalled();
    expect(administration.createTenantAndSite).not.toHaveBeenCalled();
  });

  it('validates customer roles and returns no invitation token material', async () => {
    const administration = service();
    const server = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => actor,
    });
    servers.push(server);

    const invalid = await server.inject({
      headers: { host: 'admin.omnireach.test', origin: 'https://admin.omnireach.test' },
      method: 'POST',
      payload: {
        email: 'customer@example.test',
        reason: 'Approved invitation',
        role: 'platform_admin',
        tenantId: 'tenant-a',
      },
      url: '/v1/orap/sites/site-a/invitations',
    });
    const valid = await server.inject({
      headers: { host: 'admin.omnireach.test', origin: 'https://admin.omnireach.test' },
      method: 'POST',
      payload: {
        email: 'customer@example.test',
        reason: 'Approved invitation',
        role: 'customer_viewer',
        tenantId: 'tenant-a',
      },
      url: '/v1/orap/sites/site-a/invitations',
    });

    expect(invalid.statusCode).toBe(400);
    expect(valid.statusCode).toBe(202);
    expect(valid.body).not.toMatch(/token|password|hash/iu);
  });

  it('validates and forwards audited policy controls for the resolved staff actor', async () => {
    const administration = service();
    const server = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => actor,
    });
    servers.push(server);
    const headers = {
      host: 'admin.omnireach.test',
      origin: 'https://admin.omnireach.test',
    };
    const feature = await server.inject({
      headers,
      method: 'PUT',
      payload: {
        cancelQueuedWork: true,
        enabled: false,
        policyVersion: 2,
        reason: 'Pause fictional automation',
        tenantId: 'tenant-a',
      },
      url: '/v1/orap/sites/site-a/features/content.ai.auto',
    });
    const emergency = await server.inject({
      headers,
      method: 'PUT',
      payload: {
        autonomousChangesStopped: true,
        automationStopped: true,
        editingFrozen: false,
        policyVersion: 3,
        reason: 'Investigate fictional incident',
        tenantId: 'tenant-a',
      },
      url: '/v1/orap/sites/site-a/emergency-controls',
    });
    const subscription = await server.inject({
      headers,
      method: 'PUT',
      payload: {
        graceEndsAt: '2026-11-01T00:00:00.000Z',
        reason: 'Approved fictional grace period',
        status: 'past_due',
        tenantId: 'tenant-a',
      },
      url: '/v1/orap/sites/site-a/subscription',
    });

    expect([feature.statusCode, emergency.statusCode, subscription.statusCode]).toEqual([
      200, 200, 200,
    ]);
    expect(administration.setFeatureOverride).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ featureKey: 'content.ai.auto', siteId: 'site-a' }),
    );
    expect(administration.setSubscriptionState).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ graceEndsAt: expect.any(Date), status: 'past_due' }),
    );
  });

  it('validates and forwards a site AI review-cycle quota override', async () => {
    const administration = service();
    const server = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => actor,
    });
    servers.push(server);
    const siteId = '20000000-0000-4000-8000-000000000001';
    const tenantId = '10000000-0000-4000-8000-000000000001';
    const response = await server.inject({
      headers: { host: 'admin.omnireach.test', origin: 'https://admin.omnireach.test' },
      method: 'PUT',
      payload: {
        policyVersion: 2,
        quotaLimit: 12,
        reason: 'Approved fictional site override',
        tenantId,
      },
      url: `/v1/orap/sites/${siteId}/quota-overrides/ai_review_cycles_per_month`,
    });

    expect(response.statusCode).toBe(200);
    expect(administration.setQuotaOverride).toHaveBeenCalledWith(actor, {
      policyVersion: 2,
      quotaKey: 'ai_review_cycles_per_month',
      quotaLimit: 12,
      reason: 'Approved fictional site override',
      siteId,
      tenantId,
    });
  });

  it('validates the centralized per-site contact-form control', async () => {
    const administration = service();
    const server = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => actor,
    });
    servers.push(server);
    const siteId = '20000000-0000-4000-8000-000000000001';
    const tenantId = '10000000-0000-4000-8000-000000000001';
    const response = await server.inject({
      headers: { host: 'admin.omnireach.test', origin: 'https://admin.omnireach.test' },
      method: 'PUT',
      payload: {
        confirmationEnabled: false,
        enabled: true,
        fieldIds: ['name', 'email', 'message', 'consent'],
        policyVersion: 1,
        reason: 'Enable fictional contact form',
        recipientEmail: 'inbox@fictional.example.test',
        recipientVerified: true,
        retentionDays: 30,
        tenantId,
      },
      url: `/v1/orap/sites/${siteId}/contact-forms/general-inquiry`,
    });

    expect(response.statusCode).toBe(200);
    expect(administration.setContactForm).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ formId: 'general-inquiry', siteId, tenantId }),
    );
  });

  it('restricts audited AI budget controls to capability-bearing staff', async () => {
    const administration = service();
    const staffServer = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => deniedStaff,
    });
    const ownerActor: AdminActor = { ...actor, role: 'platform_owner' };
    const ownerServer = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => ownerActor,
    });
    servers.push(staffServer, ownerServer);
    const headers = {
      host: 'admin.omnireach.test',
      origin: 'https://admin.omnireach.test',
    };
    const payload = {
      capUsdMicros: 50_000_000,
      policyVersion: 2,
      reason: 'Approved fictional platform cap',
    };
    const forbidden = await staffServer.inject({
      headers,
      method: 'PUT',
      payload,
      url: '/v1/orap/platform/ai-budget',
    });
    const accepted = await ownerServer.inject({
      headers,
      method: 'PUT',
      payload,
      url: '/v1/orap/platform/ai-budget',
    });

    expect(forbidden.statusCode).toBe(403);
    expect(accepted.statusCode).toBe(200);
    expect(administration.setPlatformAiBudget).toHaveBeenCalledWith(ownerActor, payload);
  });

  it('creates a versioned plan and assigns it to one website', async () => {
    const administration = service();
    const server = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => actor,
    });
    servers.push(server);
    const headers = {
      host: 'admin.omnireach.test',
      origin: 'https://admin.omnireach.test',
    };
    const created = await server.inject({
      headers,
      method: 'POST',
      payload: {
        code: 'agency-standard',
        entitlements: {
          aiReviewCyclesPerMonth: 4,
          businessLocationLimit: 1,
          commercialStatus: 'proposal',
          currency: 'USD',
          customerSeatLimit: 3,
          monthlyPriceCents: 75_000,
          pendingInvitationsCountAsSeats: true,
          seoAuditIntervalHours: 168,
          standardPageLimit: 8,
        },
        features: [{ enabled: true, key: 'content.edit', version: 1 }],
        name: 'Agency Standard',
        reason: 'Approved fictional plan',
        version: 1,
      },
      url: '/v1/orap/plans',
    });
    const assigned = await server.inject({
      headers,
      method: 'PUT',
      payload: {
        planId: '90000000-0000-4000-8000-000000000001',
        reason: 'Approved fictional subscription',
        tenantId: '10000000-0000-4000-8000-000000000001',
      },
      url: '/v1/orap/sites/20000000-0000-4000-8000-000000000001/plan',
    });
    expect(created.statusCode).toBe(201);
    expect(assigned.statusCode).toBe(200);
    expect(administration.createPlan).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ code: 'agency-standard', version: 1 }),
    );
    expect(administration.assignPlan).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        planId: '90000000-0000-4000-8000-000000000001',
        siteId: '20000000-0000-4000-8000-000000000001',
      }),
    );
  });

  it('limits exact-site customer session administration to capability-bearing staff', async () => {
    const administration = service();
    const ownerActor: AdminActor = { ...actor, role: 'platform_owner' };
    const ownerServer = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => ownerActor,
    });
    const staffServer = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => deniedStaff,
    });
    servers.push(ownerServer, staffServer);
    const tenantId = '10000000-0000-4000-8000-000000000001';
    const siteId = '20000000-0000-4000-8000-000000000001';
    const userId = '30000000-0000-4000-8000-000000000001';
    const sessionId = '50000000-0000-4000-8000-000000000001';
    const baseUrl = `/v1/orap/tenants/${tenantId}/sites/${siteId}/users/${userId}/sessions`;
    const headers = {
      host: 'admin.omnireach.test',
      origin: 'https://admin.omnireach.test',
    };

    const listed = await ownerServer.inject({ method: 'GET', url: baseUrl });
    const revoked = await ownerServer.inject({
      headers,
      method: 'POST',
      payload: { reason: 'Owner requested this exact session be closed' },
      url: `${baseUrl}/${sessionId}/revoke`,
    });
    const revokedAll = await ownerServer.inject({
      headers,
      method: 'POST',
      payload: { reason: 'Customer reported a potentially compromised account' },
      url: `${baseUrl}/revoke-all`,
    });

    expect(listed.statusCode).toBe(200);
    expect(JSON.stringify(listed.json())).not.toMatch(/token|credential|factor|secret/iu);
    expect(revoked.statusCode).toBe(200);
    expect(revokedAll.statusCode).toBe(200);
    expect(administration.listCustomerSessions).toHaveBeenCalledWith(ownerActor, {
      siteId,
      tenantId,
      userId,
    });
    expect(administration.revokeCustomerSession).toHaveBeenCalledWith(ownerActor, {
      reason: 'Owner requested this exact session be closed',
      sessionId,
      siteId,
      tenantId,
      userId,
    });
    expect(administration.revokeAllCustomerSessions).toHaveBeenCalledWith(ownerActor, {
      reason: 'Customer reported a potentially compromised account',
      siteId,
      tenantId,
      userId,
    });

    const callsBeforeDenial = {
      list: administration.listCustomerSessions.mock.calls.length,
      revoke: administration.revokeCustomerSession.mock.calls.length,
      revokeAll: administration.revokeAllCustomerSessions.mock.calls.length,
    };
    const staffList = await staffServer.inject({ method: 'GET', url: baseUrl });
    const staffRevoke = await staffServer.inject({
      headers,
      method: 'POST',
      payload: { reason: 'Staff should not have this permission' },
      url: `${baseUrl}/revoke-all`,
    });
    expect(staffList.statusCode).toBe(403);
    expect(staffRevoke.statusCode).toBe(403);
    expect(administration.listCustomerSessions).toHaveBeenCalledTimes(callsBeforeDenial.list);
    expect(administration.revokeCustomerSession).toHaveBeenCalledTimes(callsBeforeDenial.revoke);
    expect(administration.revokeAllCustomerSessions).toHaveBeenCalledTimes(
      callsBeforeDenial.revokeAll,
    );
  });

  it('rejects invalid reasons and cross-origin customer session revocation', async () => {
    const administration = service();
    const ownerActor = actor;
    const server = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => ownerActor,
    });
    servers.push(server);
    const baseUrl =
      '/v1/orap/tenants/10000000-0000-4000-8000-000000000001' +
      '/sites/20000000-0000-4000-8000-000000000001' +
      '/users/30000000-0000-4000-8000-000000000001/sessions';
    const sameOrigin = {
      host: 'admin.omnireach.test',
      origin: 'https://admin.omnireach.test',
    };
    const invalidReason = await server.inject({
      headers: sameOrigin,
      method: 'POST',
      payload: { reason: 'no' },
      url: `${baseUrl}/revoke-all`,
    });
    const crossOrigin = await server.inject({
      headers: { ...sameOrigin, origin: 'https://attacker.test' },
      method: 'POST',
      payload: { reason: 'Hostile cross-site request' },
      url: `${baseUrl}/revoke-all`,
    });

    expect(invalidReason.statusCode).toBe(400);
    expect(crossOrigin.statusCode).toBe(403);
    expect(administration.revokeAllCustomerSessions).not.toHaveBeenCalled();
  });

  it('returns one generic not-found result for missing scopes and unmatched sessions', async () => {
    const administration = service();
    const ownerActor = actor;
    administration.listCustomerSessions.mockRejectedValueOnce(
      new OrapResourceNotFoundError('Active customer site membership was not found'),
    );
    administration.revokeCustomerSession.mockRejectedValueOnce(
      new OrapResourceNotFoundError('Customer session was not found'),
    );
    administration.revokeAllCustomerSessions.mockRejectedValueOnce(
      new OrapResourceNotFoundError('Active customer site membership was not found'),
    );
    const server = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => ownerActor,
    });
    servers.push(server);
    const sessionId = '50000000-0000-4000-8000-000000000099';
    const baseUrl =
      '/v1/orap/tenants/10000000-0000-4000-8000-000000000001' +
      '/sites/20000000-0000-4000-8000-000000000001' +
      '/users/30000000-0000-4000-8000-000000000001/sessions';
    const sameOrigin = {
      host: 'admin.omnireach.test',
      origin: 'https://admin.omnireach.test',
    };

    const missingScope = await server.inject({ method: 'GET', url: baseUrl });
    const unmatchedSession = await server.inject({
      headers: sameOrigin,
      method: 'POST',
      payload: { reason: 'Reject a session identifier from a different scope' },
      url: `${baseUrl}/${sessionId}/revoke`,
    });
    const missingBulkScope = await server.inject({
      headers: sameOrigin,
      method: 'POST',
      payload: { reason: 'No active customer membership remains at this scope' },
      url: `${baseUrl}/revoke-all`,
    });

    expect(missingScope.statusCode).toBe(404);
    expect(unmatchedSession.statusCode).toBe(404);
    expect(missingBulkScope.statusCode).toBe(404);
    expect(missingScope.json()).toEqual({ error: 'not_found' });
    expect(unmatchedSession.json()).toEqual({ error: 'not_found' });
    expect(missingBulkScope.json()).toEqual({ error: 'not_found' });
    expect(JSON.stringify(unmatchedSession.json())).not.toContain(sessionId);
  });
});
