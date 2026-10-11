import { buildApiServer } from '@omnireach/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

const servers: ReturnType<typeof buildApiServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe('bounded public contact submission', () => {
  it('resolves the site by host, requires exact origin/consent, and accepts no attachments', async () => {
    const submit = vi.fn(async () => ({ submissionId: 'submission-a' }));
    const publicConfig = vi.fn(async () => ({
      enabled: true,
      turnstileSiteKey: 'fictional-public-site-key',
    }));
    const server = buildApiServer({
      contactService: { publicConfig, submit },
      logLevel: 'silent',
      resolveContactSite: async () => ({
        allowedOrigin: 'https://fictional.test',
        siteId: 'site-a',
        tenantId: 'tenant-a',
      }),
    });
    servers.push(server);
    const config = await server.inject({
      headers: { host: 'fictional.test' },
      method: 'GET',
      url: '/v1/public/contact/config?formId=contact',
    });
    expect(config.statusCode).toBe(200);
    expect(config.json()).toEqual({
      enabled: true,
      turnstileSiteKey: 'fictional-public-site-key',
    });
    expect(config.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(config.json())).not.toContain('recipient');
    const rejected = await server.inject({
      headers: { host: 'fictional.test', origin: 'https://attacker.test' },
      method: 'POST',
      payload: {
        consent: true,
        email: 'person@example.test',
        formId: 'contact',
        message: 'Hello',
        name: 'Person',
        turnstileToken: 'test-token',
      },
      url: '/v1/public/contact',
    });
    expect(rejected.statusCode).toBe(403);

    const accepted = await server.inject({
      headers: { host: 'fictional.test', origin: 'https://fictional.test' },
      method: 'POST',
      payload: {
        consent: true,
        email: 'person@example.test',
        formId: 'contact',
        message: 'Hello',
        name: 'Person',
        turnstileToken: 'test-token',
      },
      url: '/v1/public/contact',
    });
    expect(accepted.statusCode).toBe(202);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 'site-a', tenantId: 'tenant-a' }),
      expect.not.objectContaining({ attachment: expect.anything() }),
    );

    const browserForm = await server.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        host: 'fictional.test',
        origin: 'https://fictional.test',
      },
      method: 'POST',
      payload:
        'formId=contact&name=Browser+Person&email=browser%40example.test&message=Hello&consent=on&cf-turnstile-response=test-token',
      url: '/v1/public/contact',
    });
    expect(browserForm.statusCode).toBe(202);
  });

  it('reports delivery failure while API liveness remains healthy', async () => {
    const server = buildApiServer({
      contactService: { submit: vi.fn(async () => Promise.reject(new Error('provider down'))) },
      logLevel: 'silent',
      resolveContactSite: async () => ({
        allowedOrigin: 'https://fictional.test',
        siteId: 'site-a',
        tenantId: 'tenant-a',
      }),
    });
    servers.push(server);
    const failure = await server.inject({
      headers: { origin: 'https://fictional.test' },
      method: 'POST',
      payload: {
        consent: true,
        email: 'person@example.test',
        formId: 'contact',
        message: 'Hello',
        name: 'Person',
        turnstileToken: 'test-token',
      },
      url: '/v1/public/contact',
    });
    expect(failure.statusCode).toBe(503);
    expect((await server.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
  });
});
