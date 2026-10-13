import { buildApiServer } from '@omnireach/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

const servers: ReturnType<typeof buildApiServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe('public OmniReach inquiry endpoint', () => {
  it('publishes only safe configuration and accepts a bounded same-origin inquiry', async () => {
    const submit = vi.fn(async () => undefined);
    const server = buildApiServer({
      logLevel: 'silent',
      platformInquiryService: {
        publicConfig: async () => ({ enabled: true, turnstileSiteKey: 'fictional-public-key' }),
        submit,
      },
    });
    servers.push(server);
    const config = await server.inject({
      method: 'GET',
      url: '/v1/public/platform-inquiry/config',
    });
    expect(config.statusCode).toBe(200);
    expect(config.json()).toEqual({ enabled: true, turnstileSiteKey: 'fictional-public-key' });
    expect(JSON.stringify(config.json())).not.toContain('owner');

    const accepted = await server.inject({
      headers: { origin: 'https://omnireach.cloud' },
      method: 'POST',
      payload: {
        consent: true,
        email: 'visitor@example.test',
        message: 'We need a dependable new business website.',
        name: 'Visitor',
        turnstileToken: 'test-token',
      },
      url: '/v1/public/platform-inquiry',
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ status: 'accepted' });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'visitor@example.test',
        origin: 'https://omnireach.cloud',
      }),
    );
  });

  it('rejects malformed input and keeps provider failures private', async () => {
    const server = buildApiServer({
      logLevel: 'silent',
      platformInquiryService: {
        publicConfig: async () => ({ enabled: true }),
        submit: vi.fn(async () => Promise.reject(new Error('provider unavailable'))),
      },
    });
    servers.push(server);
    const malformed = await server.inject({
      headers: { origin: 'https://omnireach.cloud' },
      method: 'POST',
      payload: { consent: true, email: 'invalid', message: 'short', name: '' },
      url: '/v1/public/platform-inquiry',
    });
    expect(malformed.statusCode).toBe(400);
    const unavailable = await server.inject({
      headers: { origin: 'https://omnireach.cloud' },
      method: 'POST',
      payload: {
        consent: true,
        email: 'visitor@example.test',
        message: 'We need a dependable new business website.',
        name: 'Visitor',
        turnstileToken: 'test-token',
      },
      url: '/v1/public/platform-inquiry',
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({ error: 'delivery_unavailable' });
  });
});
