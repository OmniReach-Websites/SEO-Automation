import { buildApiServer } from '@omnireach/api';
import { afterEach, describe, expect, it } from 'vitest';

const servers = [] as ReturnType<typeof buildApiServer>[];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe('API health contract', () => {
  it('reports liveness without checking dependencies', async () => {
    const server = buildApiServer({
      dependencies: [{ check: async () => Promise.reject(new Error('down')), name: 'db' }],
    });
    servers.push(server);
    const response = await server.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'alive' });
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('reports ready only when all dependencies respond', async () => {
    const server = buildApiServer({
      dependencies: [
        { check: async () => undefined, name: 'postgres' },
        { check: async () => undefined, name: 'redis' },
      ],
    });
    servers.push(server);
    const response = await server.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      authContract: 2,
      dependencies: ['postgres', 'redis'],
      status: 'ready',
    });
  });

  it('reports dependency names but never error details when degraded', async () => {
    const server = buildApiServer({
      dependencies: [
        { check: async () => undefined, name: 'postgres' },
        {
          check: async () => Promise.reject(new Error('redis://user:secret@example.test')),
          name: 'redis',
        },
      ],
    });
    servers.push(server);
    const response = await server.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ failed: ['redis'], status: 'degraded' });
    expect(response.body).not.toContain('secret');
  });
});
