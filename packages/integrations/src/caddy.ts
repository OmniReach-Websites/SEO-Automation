import { normalizeHostname } from './cloudflare.ts';

export interface CaddyRoute {
  readonly adminHostname: string;
  readonly adminUpstream: string;
  readonly canonicalHostname: string;
  readonly publicHostname: string;
  readonly staticRoot: string;
  readonly state: 'active' | 'tls_pending' | 'verified';
}

export function generateCaddyFragment(routes: readonly CaddyRoute[]): string {
  const hostClaims = new Set<string>();
  const blocks: string[] = [];
  for (const route of [...routes].sort((left, right) =>
    left.publicHostname.localeCompare(right.publicHostname),
  )) {
    if (route.state !== 'active') throw new Error('Only active verified routes may be emitted');
    const publicHostname = claim(route.publicHostname, hostClaims);
    const adminHostname = claim(route.adminHostname, hostClaims);
    const canonicalHostname = normalizeHostname(route.canonicalHostname);
    if (canonicalHostname !== publicHostname) claim(canonicalHostname, hostClaims);
    if (!/^127\.0\.0\.1:\d{1,5}$/u.test(route.adminUpstream)) {
      throw new Error('Admin upstream must be an explicit loopback address and port');
    }
    if (
      !/^\/srv\/omnireach\/releases\/[a-f0-9]{40,64}\/sites\/[a-z0-9-]+$/u.test(route.staticRoot)
    ) {
      throw new Error('Static root must reference an immutable OmniReach release');
    }
    if (canonicalHostname !== publicHostname) {
      blocks.push(`${publicHostname} {\n\tredir https://${canonicalHostname}{uri} permanent\n}`);
    }
    blocks.push(
      `${canonicalHostname} {\n\troot * ${route.staticRoot}\n\tencode zstd gzip\n\tfile_server\n}`,
      `${adminHostname} {\n\treverse_proxy ${route.adminUpstream}\n}`,
    );
  }
  return `${blocks.join('\n\n')}\n`;
}

function claim(input: string, claims: Set<string>): string {
  const hostname = normalizeHostname(input);
  if (claims.has(hostname)) throw new Error(`Duplicate Caddy hostname rejected: ${hostname}`);
  claims.add(hostname);
  return hostname;
}
