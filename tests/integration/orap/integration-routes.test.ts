import { buildApiServer } from '@omnireach/api';
import type { AdminActor } from '@omnireach/tenant';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleIntegrationCallbackError } from '../../../apps/api/src/postgres-google.ts';

const actor: AdminActor = {
  authorization: {
    grants: [
      {
        assignmentId: 'assignment-integrations',
        permissionKeys: ['integrations.google.view', 'integrations.google.manage'],
        portfolio: false,
        siteIds: ['20000000-0000-4000-8000-000000000001'],
        tenantIds: [],
      },
    ],
    membershipId: '60000000-0000-4000-8000-000000000001',
    version: 1,
  },
  id: '00000000-0000-4000-8000-000000000001',
  role: 'staff',
  traceId: 'trace-000000000001',
};
const siteId = '20000000-0000-4000-8000-000000000001';
const servers: ReturnType<typeof buildApiServer>[] = [];
afterEach(async () => Promise.all(servers.splice(0).map(async (server) => server.close())));

describe('Google integration management routes', () => {
  it('lists scoped connection state and starts OAuth only with same origin', async () => {
    const service = {
      disconnect: vi.fn(),
      finishGoogle: vi.fn(),
      list: vi.fn(async () => [{ status: 'disconnected' }]),
      selectGoogleProperty: vi.fn(async () => ({ status: 'connected' })),
      startGoogle: vi.fn(async () => ({
        authorizationUrl: 'https://accounts.google.test/fictional',
      })),
    };
    const server = buildApiServer({
      integrationService: service,
      resolvePlatformActor: async () => actor,
    });
    servers.push(server);
    const listed = await server.inject({
      headers: { host: 'admin.omnireach.test' },
      method: 'GET',
      url: `/v1/orap/sites/${siteId}/integrations`,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([{ status: 'disconnected' }]);
    const rejected = await server.inject({
      headers: { host: 'admin.omnireach.test', origin: 'https://evil.example' },
      method: 'POST',
      payload: { propertyKind: 'ga4', redirectUri: 'https://admin.omnireach.test/oauth/google' },
      url: `/v1/orap/sites/${siteId}/integrations/google/start`,
    });
    expect(rejected.statusCode).toBe(403);
    expect(service.startGoogle).not.toHaveBeenCalled();
    const started = await server.inject({
      headers: { host: 'admin.omnireach.test', origin: 'https://admin.omnireach.test' },
      method: 'POST',
      payload: {
        propertyKind: 'search_console',
        redirectUri: 'https://admin.omnireach.test/oauth/google',
      },
      url: `/v1/orap/sites/${siteId}/integrations/google/start`,
    });
    expect(started.statusCode).toBe(201);
    expect(service.startGoogle).toHaveBeenCalledWith(actor, expect.objectContaining({ siteId }));
    const selected = await server.inject({
      headers: { host: 'admin.omnireach.test', origin: 'https://admin.omnireach.test' },
      method: 'POST',
      payload: {
        pendingSelectionId: '80000000-0000-4000-8000-000000000001',
        propertyId: 'properties/1234',
        propertyKind: 'ga4',
      },
      url: `/v1/orap/sites/${siteId}/integrations/google/select`,
    });
    expect(selected.statusCode).toBe(200);
    expect(service.selectGoogleProperty).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ propertyId: 'properties/1234', siteId }),
    );
  });

  it('returns browser callbacks to ORAP and renders exact property selection when needed', async () => {
    const service = {
      disconnect: vi.fn(),
      finishGoogle: vi
        .fn()
        .mockResolvedValueOnce({ connectionId: 'connection-1', siteId, status: 'connected' })
        .mockResolvedValueOnce({
          eligibleProperties: [
            {
              id: 'properties/1234',
              kind: 'ga4',
              siteUrl: 'https://example.test',
            },
          ],
          pendingSelectionId: '80000000-0000-4000-8000-000000000001',
          siteId,
          status: 'property_selection_required',
        }),
      list: vi.fn(),
      startGoogle: vi.fn(),
    };
    const server = buildApiServer({
      integrationService: service,
      resolvePlatformActor: async () => actor,
    });
    servers.push(server);
    const query = `code=code-value&state=${'s'.repeat(24)}`;

    const connected = await server.inject({
      headers: { accept: 'text/html', host: 'admin.omnireach.test' },
      method: 'GET',
      url: `/v1/orap/integrations/google/callback?${query}`,
    });
    expect(connected.statusCode).toBe(303);
    expect(connected.headers.location).toBe(`/orap/sites/${siteId}?notice=google-connected`);
    expect(service.finishGoogle).toHaveBeenNthCalledWith(1, actor, {
      code: 'code-value',
      state: 's'.repeat(24),
    });

    const selection = await server.inject({
      headers: { accept: 'text/html', host: 'admin.omnireach.test' },
      method: 'GET',
      url: `/v1/orap/integrations/google/callback?${query}`,
    });
    expect(selection.statusCode).toBe(200);
    expect(selection.headers['content-type']).toContain('text/html');
    expect(selection.body).toContain('Select a property');
    expect(selection.body).toContain('properties/1234');
    expect(selection.body).toContain(`/orap/sites/${siteId}/integrations/google/select`);
  });

  it('returns safe actionable callback failures without exposing provider details', async () => {
    const sensitiveCause = new Error('provider response contained sensitive diagnostics');
    const service = {
      disconnect: vi.fn(),
      finishGoogle: vi.fn(async () => {
        throw new GoogleIntegrationCallbackError(
          'provider_rejected',
          siteId,
          'exchange_code',
          sensitiveCause,
        );
      }),
      list: vi.fn(),
      startGoogle: vi.fn(),
    };
    const server = buildApiServer({
      integrationService: service,
      resolvePlatformActor: async () => actor,
    });
    servers.push(server);
    const query = `code=code-value&state=${'s'.repeat(24)}`;

    const browser = await server.inject({
      headers: { accept: 'text/html', host: 'admin.omnireach.test' },
      method: 'GET',
      url: `/v1/orap/integrations/google/callback?${query}`,
    });
    expect(browser.statusCode).toBe(303);
    expect(browser.headers.location).toBe(`/orap/sites/${siteId}?notice=google-provider_rejected`);
    expect(browser.body).not.toContain(sensitiveCause.message);

    const api = await server.inject({
      headers: { accept: 'application/json', host: 'admin.omnireach.test' },
      method: 'GET',
      url: `/v1/orap/integrations/google/callback?${query}`,
    });
    expect(api.statusCode).toBe(502);
    expect(api.json()).toMatchObject({ error: 'provider_rejected' });
    expect(api.body).not.toContain(sensitiveCause.message);
  });
});
