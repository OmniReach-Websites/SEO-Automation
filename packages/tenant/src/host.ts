import { domainToASCII } from 'node:url';

export class HostResolutionError extends Error {
  override readonly name = 'HostResolutionError';
}

export function normalizeHostname(value: string): string {
  const candidate = value.trim();
  if (!candidate || /[\s/@]/u.test(candidate)) throw new HostResolutionError('Invalid host');
  let hostname: string;
  try {
    hostname = new URL(`http://${candidate}`).hostname;
  } catch {
    throw new HostResolutionError('Invalid host');
  }
  const ascii = domainToASCII(hostname.replace(/\.$/u, '')).toLowerCase();
  if (
    !ascii ||
    ascii.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      ascii,
    )
  ) {
    throw new HostResolutionError('Invalid host');
  }
  return ascii;
}

export interface VerifiedDomain {
  active: boolean;
  hostname: string;
  kind: 'admin' | 'preview' | 'public';
  siteId: string;
  tenantId: string;
  verificationStatus: 'failed' | 'pending' | 'verified';
}

export interface ActiveMembership {
  active: boolean;
  role: string;
  siteId: string;
  tenantId: string;
  userId: string;
}

export interface TenantResolverRepository {
  findDomain(hostname: string): Promise<VerifiedDomain | undefined>;
  findMembership(input: {
    siteId: string;
    tenantId: string;
    userId: string;
  }): Promise<ActiveMembership | undefined>;
}

export interface TenantContext {
  host: string;
  role: string;
  siteId: string;
  tenantId: string;
  userId: string;
}

export async function resolveCustomerContext(
  untrustedHost: string,
  userId: string,
  repository: TenantResolverRepository,
): Promise<TenantContext> {
  const host = normalizeHostname(untrustedHost);
  const domain = await repository.findDomain(host);
  if (
    !domain ||
    !domain.active ||
    domain.kind !== 'admin' ||
    domain.verificationStatus !== 'verified'
  ) {
    throw new HostResolutionError('Site context unavailable');
  }
  const membership = await repository.findMembership({
    siteId: domain.siteId,
    tenantId: domain.tenantId,
    userId,
  });
  if (!membership?.active) throw new HostResolutionError('Site context unavailable');
  return { host, role: membership.role, siteId: domain.siteId, tenantId: domain.tenantId, userId };
}
