import { isIP } from 'node:net';

export interface CrawlNetworkPolicy {
  readonly allowedHostname: string;
  readonly allowedPorts: readonly number[];
  readonly maxRedirects: number;
  readonly ownedSiteMode: boolean;
}

export type ResolveHostname = (hostname: string) => Promise<readonly string[]>;

export function canonicalizeCrawlUrl(input: string, base?: string): URL {
  const url = new URL(input, base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL scheme');
  if (url.username || url.password) throw new Error('URL userinfo is forbidden');
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  )
    url.port = '';
  const sorted = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [key, value] of sorted) url.searchParams.append(key, value);
  return url;
}

export async function assertSafeCrawlTarget(
  url: URL,
  policy: CrawlNetworkPolicy,
  resolveHostname: ResolveHostname,
): Promise<readonly string[]> {
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (!policy.allowedPorts.includes(port)) throw new Error('Target port is not allowed');
  if (url.hostname !== policy.allowedHostname) throw new Error('Cross-host crawl target rejected');
  const addresses = isIP(url.hostname) ? [url.hostname] : await resolveHostname(url.hostname);
  if (addresses.length === 0) throw new Error('Target hostname did not resolve');
  for (const address of addresses)
    if (isForbiddenAddress(address)) throw new Error(`Forbidden network target: ${address}`);
  return addresses;
}

export function isForbiddenAddress(input: string): boolean {
  const value = input.toLowerCase().split('%')[0] ?? input.toLowerCase();
  if (isIP(value) === 4) {
    const octets = value.split('.').map(Number);
    const [a = 0, b = 0] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0)
    );
  }
  if (isIP(value) === 6) {
    return (
      value === '::' ||
      value === '::1' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      /^fe[89ab]/u.test(value) ||
      value.startsWith('2001:db8:') ||
      value.startsWith('::ffff:127.') ||
      value.startsWith('::ffff:10.') ||
      value.startsWith('::ffff:192.168.')
    );
  }
  return true;
}
