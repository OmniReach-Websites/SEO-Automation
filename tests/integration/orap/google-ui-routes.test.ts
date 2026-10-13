import {
  buildApiServer,
  type IntegrationEndpointService,
  type OrapAdministrationEndpointService,
} from '@omnireach/api';
import type { AdminActor } from '@omnireach/tenant';
import { afterEach, describe, expect, it, vi } from 'vitest';

const siteId = '20000000-0000-4000-8000-000000000001';
const tenantId = '10000000-0000-4000-8000-000000000001';
const actor: AdminActor = {
  id: '40000000-0000-4000-8000-000000000001',
  role: 'platform_owner',
  traceId: 'trace-google-ui',
};
const servers: ReturnType<typeof buildApiServer>[] = [];

afterEach(async () => Promise.all(servers.splice(0).map(async (server) => server.close())));

describe('ORAP Google connection controls', () => {
  it('renders separate read-only connection actions and redirects through the trusted provider', async () => {
    const integrationService: IntegrationEndpointService = {
      disconnect: vi.fn(),
      finishGoogle: vi.fn(),
      list: vi.fn(),
      selectGoogleProperty: vi.fn(),
      startGoogle: vi.fn(async () => ({
        authorizationUrl:
          'https://accounts.google.com/o/oauth2/v2/auth?scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fwebmasters.readonly',
      })),
    };
    const server = buildApiServer({
      integrationService,
      logLevel: 'silent',
      orapService: orapService(),
      resolvePlatformActor: async () => actor,
    });
    servers.push(server);

    const page = await server.inject({
      headers: { host: 'admin.omnireach.cloud' },
      method: 'GET',
      url: `/orap/sites/${siteId}`,
    });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Connect Search Console');
    expect(page.body).toContain('Connect Google Analytics');
    expect(page.headers['content-security-policy']).toBe(
      "default-src 'none'; img-src 'self'; style-src 'self'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'",
    );

    const started = await server.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: '__Host-omnireach_session=session-token',
        host: 'admin.omnireach.cloud',
        origin: 'https://admin.omnireach.cloud',
      },
      method: 'POST',
      payload: 'propertyKind=search_console',
      url: `/orap/sites/${siteId}/integrations/google/start`,
    });
    expect(started.statusCode).toBe(303);
    expect(started.headers.location).toMatch(
      /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/u,
    );
    expect(started.headers['set-cookie']).toContain('__Secure-omnireach_google_oauth=');
    expect(started.headers['set-cookie']).toContain('SameSite=Lax');
    expect(started.headers['set-cookie']).toContain('Path=/v1/orap/integrations/google/callback');
    expect(integrationService.startGoogle).toHaveBeenCalledWith(actor, {
      propertyKind: 'search_console',
      redirectUri: 'https://admin.omnireach.cloud/v1/orap/integrations/google/callback',
      siteId,
    });
  });

  it('rejects cross-origin starts and non-Google redirect URLs', async () => {
    const integrationService: IntegrationEndpointService = {
      disconnect: vi.fn(),
      finishGoogle: vi.fn(),
      list: vi.fn(),
      startGoogle: vi.fn(async () => ({ authorizationUrl: 'https://evil.example/steal' })),
    };
    const server = buildApiServer({
      integrationService,
      logLevel: 'silent',
      orapService: orapService(),
      resolvePlatformActor: async () => actor,
    });
    servers.push(server);

    const rejectedOrigin = await server.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: '__Host-omnireach_session=session-token',
        host: 'admin.omnireach.cloud',
        origin: 'https://evil.example',
      },
      method: 'POST',
      payload: 'propertyKind=ga4',
      url: `/orap/sites/${siteId}/integrations/google/start`,
    });
    expect(rejectedOrigin.statusCode).toBe(403);
    expect(integrationService.startGoogle).not.toHaveBeenCalled();

    const rejectedRedirect = await server.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        host: 'admin.omnireach.cloud',
        origin: 'https://admin.omnireach.cloud',
      },
      method: 'POST',
      payload: 'propertyKind=ga4',
      url: `/orap/sites/${siteId}/integrations/google/start`,
    });
    expect(rejectedRedirect.statusCode).toBe(503);
    expect(rejectedRedirect.json()).toEqual({ error: 'integration_unavailable' });
  });
});

function orapService(): OrapAdministrationEndpointService {
  const noop = async () => ({});
  return {
    assignPlan: noop,
    changeCustomerRole: noop,
    createPlan: noop,
    createTenantAndSite: noop,
    disableCustomer: noop,
    inviteCustomer: noop,
    listSites: async () => [
      { id: siteId, name: 'Fictional Site', status: 'active', tenantId, tenantName: 'Fictional' },
    ],
    requestCustomerReset: noop,
    setContactForm: noop,
    setContactSubmissionHold: noop,
    setEmergencyControls: noop,
    setFeatureOverride: noop,
    setPlatformAiBudget: noop,
    setQuotaOverride: noop,
    setSiteAiBudget: noop,
    setSubscriptionState: noop,
    siteManagement: async () => ({
      availability: {
        activeArtifact: true,
        preservedDuringDelinquency: true,
        publicDomain: true,
      },
      budget: null,
      emergency: {
        autonomousChangesStopped: false,
        automationStopped: false,
        editingFrozen: false,
        policyVersion: 0,
      },
      features: [],
      integrations: [],
      plans: [],
      subscription: null,
    }),
  };
}
