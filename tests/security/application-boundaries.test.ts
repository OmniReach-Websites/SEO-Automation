import { buildApiServer } from '@omnireach/api';
import { LocalAssetStorage, validateImageUpload } from '@omnireach/content';
import { renderEditor } from '@omnireach/customer-admin';
import { GoogleConnectionManager, createOAuthRequest } from '@omnireach/integrations';
import { renderOperationsCenter } from '@omnireach/orap';
import { assertSafeCrawlTarget } from '@omnireach/seo-core';
import { renderCustomerDashboard } from '@omnireach/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

const servers: ReturnType<typeof buildApiServer>[] = [];
afterEach(async () => Promise.all(servers.splice(0).map(async (server) => server.close())));

describe('application security boundaries', () => {
  it('escapes untrusted values in every server-rendered administrative surface', () => {
    const attack = '<img src=x onerror=alert(1)>';
    const dashboard = renderCustomerDashboard({
      features: [{ enabled: true, label: attack, reason: attack }],
      integrations: [{ label: attack, status: 'connected' }],
      publication: { status: 'healthy' },
      siteName: attack,
    });
    const editor = renderEditor(
      [
        {
          aiMode: 'suggestion',
          editable: true,
          id: 'field-a',
          label: attack,
          protected: false,
          type: 'text',
          value: attack,
        },
      ],
      1,
    );
    const operations = renderOperationsCenter({
      alerts: [
        { fingerprint: 'a', message: attack, occurrences: 1, severity: 'error', state: 'open' },
      ],
      budget: {
        capUsdMicros: 5_000_000,
        periodStart: attack,
        reservedUsdMicros: 0,
        usedUsdMicros: 0,
      },
      jobs: [],
    });
    for (const html of [dashboard, editor, operations]) {
      expect(html).not.toContain(attack);
      expect(html).toContain('&lt;img');
    }
  });

  it('rejects cross-origin state changes and issues hardened host-only sessions', async () => {
    const login = vi.fn(async () => ({
      kind: 'authenticated' as const,
      sessionToken: 'fixture-token',
    }));
    const server = buildApiServer({
      authService: {
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
      },
      logLevel: 'silent',
    });
    servers.push(server);
    const rejected = await server.inject({
      headers: { host: 'admin.fixture.test', origin: 'https://attacker.test' },
      method: 'POST',
      payload: { email: 'owner@fixture.test', password: 'fictional-password' },
      url: '/auth/login',
    });
    expect(rejected.statusCode).toBe(403);
    expect(login).not.toHaveBeenCalled();
    const accepted = await server.inject({
      headers: { host: 'admin.fixture.test', origin: 'https://admin.fixture.test' },
      method: 'POST',
      payload: { email: 'owner@fixture.test', password: 'fictional-password' },
      url: '/auth/login',
    });
    expect(accepted.headers['set-cookie']).toMatch(/__Host-.*HttpOnly.*Secure.*SameSite=Strict/u);
    expect(accepted.headers['set-cookie']).not.toContain('Domain=');
  });

  it('accepts only an unambiguous same-origin browser form navigation when Origin is omitted', async () => {
    const login = vi.fn(async () => ({
      kind: 'authenticated' as const,
      sessionToken: 'fixture-token',
    }));
    const server = buildApiServer({
      authService: {
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
      },
      logLevel: 'silent',
    });
    servers.push(server);

    const browserNavigation = {
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
    };
    const accepted = await server.inject({
      headers: { host: 'admin.fixture.test', ...browserNavigation },
      method: 'POST',
      payload: { email: 'owner@fixture.test', password: 'fictional-password' },
      url: '/auth/login',
    });
    expect(accepted.statusCode).toBe(200);
    expect(login).toHaveBeenCalledOnce();

    for (const headers of [
      { host: 'admin.fixture.test' },
      { host: 'admin.fixture.test', ...browserNavigation, 'sec-fetch-site': 'cross-site' },
      { host: 'admin.fixture.test', ...browserNavigation, 'sec-fetch-mode': 'cors' },
      {
        host: 'admin.fixture.test',
        origin: 'https://attacker.test',
        ...browserNavigation,
      },
    ]) {
      const rejected = await server.inject({
        headers,
        method: 'POST',
        payload: { email: 'owner@fixture.test', password: 'fictional-password' },
        url: '/auth/login',
      });
      expect(rejected.statusCode).toBe(403);
    }
    expect(login).toHaveBeenCalledOnce();
  });

  it('blocks forbidden crawl networks and site-crossing asset paths', async () => {
    await expect(
      assertSafeCrawlTarget(
        new URL('https://fixture.example'),
        {
          allowedHostname: 'fixture.example',
          allowedPorts: [443],
          maxRedirects: 2,
          ownedSiteMode: true,
        },
        async () => ['169.254.169.254'],
      ),
    ).rejects.toThrow(/Forbidden/u);
    const storage = new LocalAssetStorage('fixture-assets');
    expect(() => storage.resolveKey('site-a', 'site-b/private.png')).toThrow(/does not belong/u);
    expect(() => storage.resolveKey('site-a', 'site-a/../../private.png')).toThrow(/escapes/u);
    await expect(
      validateImageUpload(
        new TextEncoder().encode('<svg><script>alert(1)</script></svg>'),
        'x.svg',
      ),
    ).rejects.toThrow(/type/u);
  });

  it('rejects OAuth callback replay, state mismatch, and open redirects', () => {
    expect(() =>
      createOAuthRequest('https://attacker.test/callback', ['https://admin.fixture.test/callback']),
    ).toThrow(/allowlisted/u);
    const request = createOAuthRequest('https://admin.fixture.test/callback', [
      'https://admin.fixture.test/callback',
    ]);
    const manager = new GoogleConnectionManager();
    expect(() => manager.acceptCallback(request, { ...request, state: 'wrong' })).toThrow(
      /mismatch/u,
    );
    manager.acceptCallback(request, request);
    expect(() => manager.acceptCallback(request, request)).toThrow(/replay/u);
  });
});
