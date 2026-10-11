import { describe, expect, it } from 'vitest';

import { generateCaddyFragment } from '@omnireach/integrations';

const route = {
  adminHostname: 'admin.alpha.example',
  adminUpstream: '127.0.0.1:4100',
  canonicalHostname: 'alpha.example',
  publicHostname: 'www.alpha.example',
  state: 'active' as const,
  staticRoot: `/srv/omnireach/releases/${'a'.repeat(40)}/sites/alpha`,
};

describe('isolated Caddy routing', () => {
  it('generates exact public, canonical, and admin hosts', () => {
    const fragment = generateCaddyFragment([route]);
    expect(fragment).toContain('www.alpha.example {');
    expect(fragment).toContain('redir https://alpha.example{uri} permanent');
    expect(fragment).toContain('admin.alpha.example {');
    expect(fragment).toContain('reverse_proxy 127.0.0.1:4100');
    expect(fragment).not.toContain('*.');
  });

  it('rejects inactive, duplicate, external upstream, and mutable roots', () => {
    expect(() => generateCaddyFragment([{ ...route, state: 'tls_pending' }])).toThrow();
    expect(() => generateCaddyFragment([route, route])).toThrow(/Duplicate/u);
    expect(() => generateCaddyFragment([{ ...route, adminUpstream: 'api:4100' }])).toThrow();
    expect(() => generateCaddyFragment([{ ...route, staticRoot: '/srv/current' }])).toThrow();
  });
});
