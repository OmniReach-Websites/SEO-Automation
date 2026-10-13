import { buildApiServer } from '@omnireach/api';
import type { AdminActor } from '@omnireach/tenant';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
