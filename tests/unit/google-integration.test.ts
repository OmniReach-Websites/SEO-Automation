import { describe, expect, it, vi } from 'vitest';
import {
  EncryptedTokenVault,
  GoogleConnectionManager,
  GoogleHttpProvider,
  classifyAiReferral,
  createOAuthRequest,
  type GoogleProviderError,
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
    expect(manager.ingest([{ ...point, value: 7 }])).toBe(0);
    expect([...manager.metrics.values()][0]?.value).toBe(7);
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
    const collection = await provider.collect({
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
    expect(attempts).toBe(4);
    expect(delays).toEqual([250]);
    expect(collection.complete).toBe(true);
    expect(collection.diagnostics.map(({ dataset }) => dataset)).toEqual([
      'search_console_property',
      'search_console_query',
      'search_console_page',
    ]);
    expect(collection.points).toHaveLength(12);
    expect(collection.points[0]).toMatchObject({
      dimensions: { aggregation: 'property' },
      source: 'search_console',
      startDate: '2026-10-10',
    });
  });

  it('paginates each Search Console grain and reports a bounded partial result', async () => {
    const requests: { dimensions: string[]; startRow: number }[] = [];
    const provider = new GoogleHttpProvider({
      clientId: 'fixture-client',
      clientSecret: 'fixture-secret',
      maximumPages: 2,
      pageSize: 2,
      fetchImpl: (async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          dimensions: string[];
          startRow: number;
        };
        requests.push(body);
        const grain = body.dimensions[1] ?? 'property';
        const rowCount =
          body.startRow === 0 ? (grain === 'page' ? 1 : 2) : grain === 'query' ? 2 : 0;
        return new Response(
          JSON.stringify({
            rows: Array.from({ length: rowCount }, (_, index) => ({
              clicks: 1,
              impressions: 2,
              keys: [
                '2026-10-10',
                grain === 'query' ? `query-${body.startRow + index}` : 'https://fixture.example/',
              ],
              position: 4,
            })),
          }),
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }) as typeof fetch,
    });

    const collection = await provider.collect({
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

    expect(collection.complete).toBe(false);
    expect(collection.diagnostics).toEqual([
      {
        complete: true,
        dataset: 'search_console_property',
        pageCount: 2,
        rows: 2,
        totalRows: null,
      },
      {
        complete: false,
        dataset: 'search_console_query',
        pageCount: 2,
        rows: 4,
        totalRows: null,
      },
      {
        complete: true,
        dataset: 'search_console_page',
        pageCount: 1,
        rows: 1,
        totalRows: null,
      },
    ]);
    expect(requests.map(({ startRow }) => startRow)).toEqual([0, 2, 0, 2, 0]);
  });

  it('paginates GA4 with stable offsets and the provider row count', async () => {
    const offsets: string[] = [];
    const provider = new GoogleHttpProvider({
      clientId: 'fixture-client',
      clientSecret: 'fixture-secret',
      maximumPages: 2,
      pageSize: 2,
      fetchImpl: (async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { offset: string };
        offsets.push(body.offset);
        const second = body.offset === '2';
        return new Response(
          JSON.stringify({
            dimensionHeaders: [
              { name: 'date' },
              { name: 'sessionSource' },
              { name: 'sessionMedium' },
            ],
            metricHeaders: [
              { name: 'sessions' },
              { name: 'activeUsers' },
              { name: 'screenPageViews' },
            ],
            rowCount: 3,
            rows: Array.from({ length: second ? 1 : 2 }, () => ({
              dimensionValues: [{ value: '20261010' }, { value: 'google' }, { value: 'organic' }],
              metricValues: [{ value: '3' }, { value: '2' }, { value: '4' }],
            })),
          }),
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }) as typeof fetch,
    });

    const collection = await provider.collect({
      endDate: '2026-10-10',
      property: {
        id: 'properties/123',
        kind: 'ga4',
        siteUrl: 'https://fixture.example/',
      },
      startDate: '2026-10-01',
      tokens: {
        accessToken: 'fixture-access',
        expiresAt: '2026-10-13T00:00:00Z',
        scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
      },
    });

    expect(offsets).toEqual(['0', '2']);
    expect(collection.complete).toBe(true);
    expect(collection.diagnostics).toEqual([
      {
        complete: true,
        dataset: 'ga4_source_medium',
        pageCount: 2,
        rows: 3,
        totalRows: 3,
      },
    ]);
    expect(collection.points).toHaveLength(9);
  });

  it('classifies missing properties, expired permissions, and throttling without leaking responses', async () => {
    expect(
      () =>
        new GoogleHttpProvider({
          clientId: 'fixture-client',
          clientSecret: 'fixture-secret',
          maximumPages: 17,
        }),
    ).toThrow(/maximum pages/u);
    const missing = new GoogleHttpProvider({
      clientId: 'fixture-client',
      clientSecret: 'fixture-secret',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(
      missing.collect({
        endDate: '2026-10-10',
        property: { id: '', kind: 'ga4', siteUrl: 'https://fixture.example/' },
        startDate: '2026-10-01',
        tokens: { accessToken: 'x', expiresAt: '2026-10-13T00:00:00Z', scopes: [] },
      }),
    ).rejects.toMatchObject({ code: 'missing_property', retryable: false });
    await expect(
      missing.collect({
        endDate: '2026-02-31',
        property: { id: 'properties/123', kind: 'ga4', siteUrl: 'https://fixture.example/' },
        startDate: '2026-02-01',
        tokens: { accessToken: 'x', expiresAt: '2026-10-13T00:00:00Z', scopes: [] },
      }),
    ).rejects.toThrow(/YYYY-MM-DD/u);

    const expired = new GoogleHttpProvider({
      clientId: 'fixture-client',
      clientSecret: 'fixture-secret',
      fetchImpl: (async () => new Response('', { status: 401 })) as typeof fetch,
    });
    await expect(
      expired.listProperties(
        { accessToken: 'x', expiresAt: '2026-10-13T00:00:00Z', scopes: [] },
        'search_console',
      ),
    ).rejects.toMatchObject({ code: 'revoked_or_expired', retryable: false });

    const wrongProperty = new GoogleHttpProvider({
      clientId: 'fixture-client',
      clientSecret: 'fixture-secret',
      fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch,
    });
    await expect(
      wrongProperty.collect({
        endDate: '2026-10-10',
        property: {
          id: 'sc-domain:missing.example',
          kind: 'search_console',
          siteUrl: 'sc-domain:missing.example',
        },
        startDate: '2026-10-01',
        tokens: { accessToken: 'x', expiresAt: '2026-10-13T00:00:00Z', scopes: [] },
      }),
    ).rejects.toMatchObject({ code: 'property_not_found', retryable: false });

    const delays: number[] = [];
    const throttled = new GoogleHttpProvider({
      clientId: 'fixture-client',
      clientSecret: 'fixture-secret',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }), {
          headers: { 'content-type': 'application/json' },
          status: 403,
        })) as typeof fetch,
      sleep: async (milliseconds) => void delays.push(milliseconds),
    });
    await expect(
      throttled.listProperties(
        { accessToken: 'x', expiresAt: '2026-10-13T00:00:00Z', scopes: [] },
        'search_console',
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<GoogleProviderError>>({
        code: 'quota_exhausted',
        retryable: true,
      }),
    );
    expect(delays).toEqual([250, 500, 1_000]);
  });
});
