import { buildApiServer } from '@omnireach/api';
import type { AdminActor } from '@omnireach/tenant';
import { afterEach, describe, expect, it, vi } from 'vitest';

const actor: AdminActor = {
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
  });
});
