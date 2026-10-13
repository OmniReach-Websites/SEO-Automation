import { describe, expect, it } from 'vitest';
import {
  EncryptedTokenVault,
  GoogleConnectionManager,
  GoogleHttpProvider,
  classifyAiReferral,
  createOAuthRequest,
} from '@omnireach/integrations';

describe('Google connector foundation', () => {
  it('enforces redirect allowlist, state/nonce, and replay protection', () => {
    expect(() =>
      createOAuthRequest('https://evil.example/callback', [
        'https://admin.example.test/oauth/google',
      ]),
    ).toThrow(/allowlisted/u);
    const request = createOAuthRequest('https://admin.example.test/oauth/google', [
      'https://admin.example.test/oauth/google',
    ]);
    const manager = new GoogleConnectionManager();
    manager.acceptCallback(request, request);
    expect(() => manager.acceptCallback(request, request)).toThrow(/replay/u);
    const other = createOAuthRequest(request.redirectUri, [request.redirectUri]);
    expect(() => manager.acceptCallback(other, { ...other, state: 'wrong' })).toThrow(/mismatch/u);
  });
  it('encrypts tokens behind opaque references and revokes them', () => {
    const vault = new EncryptedTokenVault('ab'.repeat(32));
    const reference = vault.store('fictional-refresh-token');
    expect(reference).not.toContain('fictional');
    expect(vault.read(reference)).toBe('fictional-refresh-token');
    vault.revoke(reference);
    expect(() => vault.read(reference)).toThrow();
  });
  it('requires exact property mapping and idempotent metric windows', () => {
    const manager = new GoogleConnectionManager();
    manager.verifyProperty(
      { id: 'sc-1', kind: 'search_console', siteUrl: 'sc-domain:fixture.example' },
      'fixture.example',
    );
    expect(() =>
      manager.verifyProperty(
        { id: 'ga-1', kind: 'ga4', siteUrl: 'https://other.example/' },
        'fixture.example',
      ),
    ).toThrow(/exact site/u);
    const point = {
      dimensions: { source: 'chatgpt.com' },
      endDate: '2026-10-10',
      metric: 'sessions',
      propertyId: 'ga-1',
      source: 'ga4' as const,
      startDate: '2026-10-01',
      value: 2,
    };
    expect(manager.ingest([point, point])).toBe(1);
    expect(manager.ingest([point])).toBe(0);
  });
  it('classifies only documented mappings and preserves unknown sources', () => {
    expect(classifyAiReferral('chatgpt.com')).toMatchObject({
      classification: 'ChatGPT',
      mappingVersion: 1,
    });
    expect(classifyAiReferral('unknown.example')).toEqual({
      classification: null,
      mappingVersion: 1,
      source: 'unknown.example',
    });
  });

  it('builds least-privilege PKCE consent and exchanges codes without leaking the verifier', async () => {
    const calls: { body?: string; url: string }[] = [];
    const provider = new GoogleHttpProvider({
      clientId: 'fixture-client',
      clientSecret: 'fixture-secret',
      fetchImpl: (async (input, init) => {
        calls.push({ body: String(init?.body ?? ''), url: String(input) });
        return new Response(
          JSON.stringify({
            access_token: 'fixture-access',
            expires_in: 3600,
            refresh_token: 'fixture-refresh',
            scope: 'https://www.googleapis.com/auth/webmasters.readonly',
          }),
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }) as typeof fetch,
    });
    const request = createOAuthRequest('https://admin.example.test/oauth/google', [
      'https://admin.example.test/oauth/google',
    ]);
    const authorization = new URL(provider.authorizationUrl(request, 'search_console'));
    expect(authorization.origin).toBe('https://accounts.google.com');
    expect(authorization.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/webmasters.readonly',
    );
    expect(authorization.searchParams.get('code_challenge')).toBe(request.codeChallenge);
    expect(authorization.search).not.toContain(request.codeVerifier);
    const tokens = await provider.exchangeCode({ code: 'fixture-code', request });
    expect(tokens).toMatchObject({
      accessToken: 'fixture-access',
      refreshToken: 'fixture-refresh',
    });
    expect(calls[0]?.url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0]?.body).toContain(`code_verifier=${encodeURIComponent(request.codeVerifier)}`);
  });

  it('normalizes Search Console rows and retries quota responses with bounded backoff', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const provider = new GoogleHttpProvider({
      clientId: 'fixture-client',
      clientSecret: 'fixture-secret',
      fetchImpl: (async () => {
        attempts += 1;
        if (attempts === 1) return new Response('', { status: 429 });
        return new Response(
          JSON.stringify({
            rows: [
              {
                clicks: 2,
                ctr: 0.5,
                impressions: 4,
                keys: [
                  '2026-10-10',
                  'mobile detailing',
                  'https://fixture.example/',
                  'usa',
                  'mobile',
                ],
                position: 3.5,
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }) as typeof fetch,
      sleep: async (milliseconds) => void delays.push(milliseconds),
    });
    const points = await provider.collect({
      endDate: '2026-10-10',
      property: {
        id: 'sc-domain:fixture.example',
        kind: 'search_console',
        siteUrl: 'sc-domain:fixture.example',
      },
      startDate: '2026-10-01',
      tokens: {
        accessToken: 'fixture-access',
        expiresAt: '2026-10-13T00:00:00Z',
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
      },
    });
    expect(attempts).toBe(2);
    expect(delays).toEqual([250]);
    expect(points.map((point) => point.metric)).toEqual([
      'clicks',
      'impressions',
      'ctr',
      'position',
    ]);
    expect(points[0]).toMatchObject({ source: 'search_console', startDate: '2026-10-10' });
  });
});
