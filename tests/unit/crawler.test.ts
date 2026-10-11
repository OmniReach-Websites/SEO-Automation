import { describe, expect, it } from 'vitest';
import {
  assertSafeCrawlTarget,
  canonicalizeCrawlUrl,
  isForbiddenAddress,
} from '@omnireach/seo-core';
import { crawlSite } from '@omnireach/worker-crawler';

describe('bounded SSRF-safe crawler', () => {
  it('rejects private, loopback, link-local, metadata, reserved, and encoded IP targets', async () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      'fc00::1',
      '2001:db8::1',
    ])
      expect(isForbiddenAddress(address)).toBe(true);
    expect(canonicalizeCrawlUrl('http://2130706433').hostname).toBe('127.0.0.1');
    await expect(
      assertSafeCrawlTarget(
        new URL('https://fixture.example'),
        {
          allowedHostname: 'fixture.example',
          allowedPorts: [443],
          maxRedirects: 2,
          ownedSiteMode: true,
        },
        async () => ['127.0.0.1'],
      ),
    ).rejects.toThrow(/Forbidden/u);
  });
  it('rechecks redirect DNS and blocks rebinding', async () => {
    let resolution = 0;
    await expect(
      crawlSite({
        fetchRaw: async () => ({
          body: '',
          contentType: 'text/html',
          headers: { location: '/next' },
          status: 302,
        }),
        maxBytes: 1_000,
        maxPages: 2,
        maxRedirects: 2,
        resolveHostname: async () => (++resolution === 1 ? ['93.184.216.34'] : ['127.0.0.1']),
        startUrl: 'https://fixture.example',
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/Forbidden/u);
  });
  it('rejects unsafe URL forms, ports, redirects, and oversized bodies', async () => {
    expect(() => canonicalizeCrawlUrl('file:///etc/passwd')).toThrow(/scheme/u);
    expect(() => canonicalizeCrawlUrl('https://user:password@fixture.example')).toThrow(
      /userinfo/u,
    );
    await expect(
      assertSafeCrawlTarget(
        new URL('https://fixture.example:8443'),
        {
          allowedHostname: 'fixture.example',
          allowedPorts: [443],
          maxRedirects: 2,
          ownedSiteMode: true,
        },
        async () => ['93.184.216.34'],
      ),
    ).rejects.toThrow(/port/u);
    await expect(
      crawlSite({
        fetchRaw: async () => ({
          body: '',
          contentType: 'text/html',
          headers: { location: 'https://attacker.example/next' },
          status: 302,
        }),
        maxBytes: 1_000,
        maxPages: 1,
        maxRedirects: 2,
        resolveHostname: async () => ['93.184.216.34'],
        startUrl: 'https://fixture.example',
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/Cross-host/u);
    await expect(
      crawlSite({
        fetchRaw: async () => ({
          body: 'too large',
          contentType: 'text/html',
          headers: {},
          status: 200,
        }),
        maxBytes: 2,
        maxPages: 1,
        maxRedirects: 2,
        resolveHostname: async () => ['93.184.216.34'],
        startUrl: 'https://fixture.example',
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/byte budget/u);
  });
  it('extracts bounded evidence and deduplicates internal links', async () => {
    const pages = await crawlSite({
      fetchRaw: async (url) => ({
        body:
          url.pathname === '/'
            ? '<title>Fixture</title><meta name="description" content="Example"><h1>Hello</h1><a href="/about">About</a><a href="/about">Again</a><img src="/hero.png" alt="Hero"><script type="application/ld+json">{}</script>'
            : '<title>About</title>',
        contentType: 'text/html',
        headers: {},
        status: 200,
      }),
      maxBytes: 10_000,
      maxPages: 2,
      maxRedirects: 2,
      resolveHostname: async () => ['93.184.216.34'],
      startUrl: 'https://fixture.example',
      timeoutMs: 1_000,
    });
    expect(pages).toHaveLength(2);
    expect(pages[0]?.links).toHaveLength(1);
    expect(pages[0]?.structuredDataCount).toBe(1);
    expect(pages[0]?.images[0]?.alt).toBe('Hero');
  });
  it('respects robots externally, bounds query traps, and times out slow fetches', async () => {
    let fetched = false;
    await expect(
      crawlSite({
        fetchRaw: async () => {
          fetched = true;
          return { body: '', contentType: 'text/html', headers: {}, status: 200 };
        },
        isAllowedByRobots: async () => false,
        maxBytes: 1_000,
        maxPages: 1,
        maxRedirects: 1,
        ownedSiteMode: false,
        resolveHostname: async () => ['93.184.216.34'],
        startUrl: 'https://fixture.example',
        timeoutMs: 100,
      }),
    ).rejects.toThrow(/robots/u);
    expect(fetched).toBe(false);

    const pages = await crawlSite({
      fetchRaw: async (url) => ({
        body:
          url.pathname === '/'
            ? Array.from(
                { length: 20 },
                (_, index) => `<a href="/search?q=${index}">Result</a>`,
              ).join('')
            : '<title>Search</title>',
        contentType: 'text/html',
        headers: {},
        status: 200,
      }),
      maxBytes: 10_000,
      maxPages: 20,
      maxQueryVariantsPerPath: 2,
      maxRedirects: 1,
      resolveHostname: async () => ['93.184.216.34'],
      startUrl: 'https://fixture.example',
      timeoutMs: 100,
    });
    expect(pages).toHaveLength(3);

    await expect(
      crawlSite({
        fetchRaw: async () => new Promise(() => undefined),
        maxBytes: 1_000,
        maxPages: 1,
        maxRedirects: 1,
        resolveHostname: async () => ['93.184.216.34'],
        startUrl: 'https://fixture.example',
        timeoutMs: 10,
      }),
    ).rejects.toThrow(/timed out/u);
  });
});
