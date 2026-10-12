import { buildApiServer } from '@omnireach/api';
import { clientNetworkIdentifier } from '@omnireach/api/client-network';
import { afterEach, describe, expect, it, vi } from 'vitest';

const servers: ReturnType<typeof buildApiServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

interface LoginInput {
  email: string;
  host: string;
  networkIdentifier?: string;
  password: string;
  traceId: string;
}

function authService(login: (input: LoginInput) => Promise<{ kind: 'invalid' }>) {
  return {
    acceptInvitation: vi.fn(async () => ({ kind: 'invalid' as const })),
    completeOwnerBootstrap: vi.fn(async () => false),
    completePasswordRecovery: vi.fn(async () => false),
    listSessions: vi.fn(async () => []),
    login,
    logout: vi.fn(async () => undefined),
    prepareOwnerBootstrap: vi.fn(async () => undefined),
    requestPasswordRecovery: vi.fn(async () => undefined),
    revokeSession: vi.fn(async () => false),
    verifyMfa: vi.fn(async () => ({ kind: 'invalid' as const })),
  };
}

describe('client network resolution', () => {
  it.each([
    ['198.51.100.44', '198.51.100.0/24'],
    ['::ffff:203.0.113.99', '203.0.113.0/24'],
    ['2001:db8:abcd:1234:5678::1', '2001:0db8:abcd:1234::/64'],
    ['not-an-address', 'unresolved'],
  ])('normalizes %s to a bounded network identifier', (address, expected) => {
    expect(clientNetworkIdentifier(address)).toBe(expected);
  });

  it('ignores forwarded addresses when the immediate peer is not configured as trusted', async () => {
    const login = vi.fn(async (input: LoginInput) => {
      void input;
      return { kind: 'invalid' as const };
    });
    const server = buildApiServer({ authService: authService(login), logLevel: 'silent' });
    servers.push(server);
    await server.inject({
      headers: {
        host: 'admin.example.test',
        origin: 'https://admin.example.test',
        'x-forwarded-for': '198.51.100.44',
      },
      method: 'POST',
      payload: { email: 'person@example.test', password: 'fictional-password' },
      url: '/auth/login',
    });
    expect(login).toHaveBeenCalledWith(
      expect.objectContaining({ networkIdentifier: '127.0.0.0/24' }),
    );
  });

  it('trusts only the nearest untrusted address in a configured proxy chain', async () => {
    const login = vi.fn(async (input: LoginInput) => {
      void input;
      return { kind: 'invalid' as const };
    });
    const server = buildApiServer({
      authService: authService(login),
      logLevel: 'silent',
      trustedProxyCidrs: ['127.0.0.1/32'],
    });
    servers.push(server);
    await server.inject({
      headers: {
        host: 'admin.example.test',
        origin: 'https://admin.example.test',
        'x-forwarded-for': '192.0.2.123, 198.51.100.44',
      },
      method: 'POST',
      payload: { email: 'person@example.test', password: 'fictional-password' },
      url: '/auth/login',
    });
    expect(login).toHaveBeenCalledWith(
      expect.objectContaining({ networkIdentifier: '198.51.100.0/24' }),
    );
  });
});
