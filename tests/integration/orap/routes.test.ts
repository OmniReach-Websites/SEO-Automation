import { buildApiServer } from '@omnireach/api';
import type { AdminActor } from '@omnireach/tenant';
import { afterEach, describe, expect, it, vi } from 'vitest';

const actor: AdminActor = {
  id: '00000000-0000-4000-8000-000000000001',
  role: 'staff',
  traceId: 'trace-000000000001',
};

function service() {
  return {
    acknowledgeAlert: vi.fn(async () => ({ state: 'acknowledged' })),
    assignPlan: vi.fn(async () => ({ status: 'assigned' })),
    cancelJob: vi.fn(async () => ({ state: 'cancelled' })),
    changeCustomerRole: vi.fn(),
    createTenantAndSite: vi.fn(async () => ({
      site: { id: 'site-a' },
      tenant: { id: 'tenant-a' },
    })),
    createPlan: vi.fn(async () => ({ id: 'plan-a' })),
    disableCustomer: vi.fn(),
    inviteCustomer: vi.fn(async () => ({ invitationId: 'invitation-a', status: 'pending' })),
    listSites: vi.fn(async () => []),
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
    requestCustomerReset: vi.fn(async () => ({ status: 'accepted' })),
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
  };
}

const servers: ReturnType<typeof buildApiServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe('ORAP administration routes', () => {
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

  it('restricts audited AI budget controls to platform owners and admins', async () => {
    const administration = service();
    const staffServer = buildApiServer({
      logLevel: 'silent',
      orapService: administration,
      resolvePlatformActor: async () => actor,
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
});
