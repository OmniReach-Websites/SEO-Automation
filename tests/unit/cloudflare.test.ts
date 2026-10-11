import { describe, expect, it } from 'vitest';

import {
  CloudflareTurnstileVerifier,
  MemoryCloudflareProvider,
  applyDnsPlan,
  normalizeHostname,
  planDns,
  transitionDomain,
  validateMappings,
} from '@omnireach/integrations';

const mapping = {
  hostname: 'www.café.example',
  kind: 'public' as const,
  siteId: 'site-1',
  target: 'origin.omnireach.test',
  tenantId: 'tenant-1',
};

describe('Cloudflare domain onboarding', () => {
  it('normalizes IDNs and rejects unsafe host syntax', () => {
    expect(normalizeHostname('WWW.Café.Example.')).toBe('www.xn--caf-dma.example');
    for (const unsafe of ['*.example.com', 'https://example.com', 'user@example.com']) {
      expect(() => normalizeHostname(unsafe)).toThrow();
    }
  });

  it('rejects cross-site hostname takeover and loops', () => {
    expect(() => validateMappings([mapping, { ...mapping, siteId: 'site-2' }])).toThrow(
      /takeover/u,
    );
    expect(() => validateMappings([{ ...mapping, target: mapping.hostname }])).toThrow(/loop/u);
  });

  it('dry-runs without mutation and applies idempotently', async () => {
    const provider = new MemoryCloudflareProvider();
    const first = await planDns(provider, 'zone-test', mapping, 'verification-test-token');
    expect(first.changes.map((change) => change.action)).toEqual(['create', 'create']);
    await applyDnsPlan(provider, first, { dryRun: true });
    expect(provider.mutations).toHaveLength(0);
    await applyDnsPlan(provider, first, { dryRun: false });
    expect(provider.mutations).toHaveLength(2);

    const second = await planDns(provider, 'zone-test', mapping, 'verification-test-token');
    expect(second.changes.map((change) => change.action)).toEqual(['noop', 'noop']);
    await applyDnsPlan(provider, second, { dryRun: false });
    expect(provider.mutations).toHaveLength(2);
  });

  it('enforces the reviewed state machine', () => {
    const sequence = [
      'awaiting_ownership',
      'dns_pending',
      'verified',
      'tls_pending',
      'active',
    ] as const;
    let state: Parameters<typeof transitionDomain>[0] = 'requested';
    for (const next of sequence) state = transitionDomain(state, next);
    expect(state).toBe('active');
    expect(() => transitionDomain('requested', 'active')).toThrow(/Invalid/u);
  });

  it('handles two fictional domains, partial propagation, wrong zones, and revoked credentials', async () => {
    const provider = new MemoryCloudflareProvider({ allowedZoneIds: ['zone-fixture'] });
    const second = { ...mapping, hostname: 'second.example', siteId: 'site-2' };
    for (const item of [mapping, second]) {
      const plan = await planDns(provider, 'zone-fixture', item, `verify-${item.siteId}`);
      await applyDnsPlan(provider, plan, { dryRun: false });
    }
    const records = provider.records.get('zone-fixture');
    expect(records).toHaveLength(4);
    if (records?.[0]) records[0] = { ...records[0], content: 'not-yet-propagated' };
    const repair = await planDns(provider, 'zone-fixture', mapping, 'verify-site-1');
    expect(repair.changes.map((change) => change.action)).toContain('update');
    await expect(planDns(provider, 'wrong-zone', mapping, 'verify-site-1')).rejects.toThrow(
      /not scoped/u,
    );
    await expect(
      planDns(new MemoryCloudflareProvider({ revoked: true }), 'zone-fixture', mapping, 'token'),
    ).rejects.toThrow(/revoked/u);
  });

  it('accepts Turnstile only for a successful exact-host verification', async () => {
    const calls: { body: string; url: string }[] = [];
    const verifier = new CloudflareTurnstileVerifier(
      'server-only-test-secret',
      async (input, init) => {
        calls.push({ body: String(init?.body), url: String(input) });
        return new Response(JSON.stringify({ hostname: 'fictional.test', success: true }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      },
    );
    await expect(
      verifier.verify({
        expectedHostname: 'fictional.test',
        remoteIp: '127.0.0.1',
        token: 'challenge-token',
      }),
    ).resolves.toBe(true);
    await expect(
      verifier.verify({
        expectedHostname: 'other.test',
        remoteIp: '127.0.0.1',
        token: 'challenge-token',
      }),
    ).resolves.toBe(false);
    expect(calls[0]?.url).toContain('siteverify');
    expect(calls[0]?.body).toContain('secret=server-only-test-secret');
  });
});
