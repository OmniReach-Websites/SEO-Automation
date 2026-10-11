import { domainToASCII } from 'node:url';

export const domainStates = [
  'requested',
  'awaiting_ownership',
  'dns_pending',
  'verified',
  'tls_pending',
  'active',
  'failed',
  'disabled',
] as const;

export type DomainState = (typeof domainStates)[number];
export type DomainKind = 'admin' | 'public' | 'redirect';

export interface DomainMapping {
  readonly hostname: string;
  readonly kind: DomainKind;
  readonly siteId: string;
  readonly target: string;
  readonly tenantId: string;
}

export interface DnsRecord {
  readonly content: string;
  readonly id?: string;
  readonly name: string;
  readonly proxied: boolean;
  readonly ttl: number;
  readonly type: 'CNAME' | 'TXT';
}

export interface DnsPlan {
  readonly changes: readonly DnsChange[];
  readonly hostname: string;
  readonly zoneId: string;
}

export type DnsChange =
  | { readonly action: 'create'; readonly desired: DnsRecord }
  | { readonly action: 'noop'; readonly current: DnsRecord; readonly desired: DnsRecord }
  | { readonly action: 'update'; readonly current: DnsRecord; readonly desired: DnsRecord };

export interface CloudflareDnsProvider {
  apply(zoneId: string, changes: readonly DnsChange[]): Promise<readonly DnsRecord[]>;
  list(zoneId: string, hostname: string): Promise<readonly DnsRecord[]>;
}

export interface DomainVerificationEvidence {
  readonly checkedAt: string;
  readonly expectedTokenHash: string;
  readonly observed: readonly string[];
  readonly verified: boolean;
}

const allowedTransitions: Readonly<Record<DomainState, readonly DomainState[]>> = {
  requested: ['awaiting_ownership', 'disabled'],
  awaiting_ownership: ['dns_pending', 'failed', 'disabled'],
  dns_pending: ['verified', 'failed', 'disabled'],
  verified: ['tls_pending', 'disabled'],
  tls_pending: ['active', 'failed', 'disabled'],
  active: ['failed', 'disabled'],
  failed: ['awaiting_ownership', 'dns_pending', 'tls_pending', 'disabled'],
  disabled: ['awaiting_ownership'],
};

export function transitionDomain(from: DomainState, to: DomainState): DomainState {
  if (!allowedTransitions[from].includes(to)) {
    throw new Error(`Invalid domain transition: ${from} -> ${to}`);
  }
  return to;
}

export function normalizeHostname(input: string): string {
  const value = input.trim().replace(/\.$/u, '').toLowerCase();
  if (value.includes('/') || value.includes(':') || value.includes('@') || value.includes('*')) {
    throw new Error('Hostname contains a forbidden character');
  }
  const ascii = domainToASCII(value);
  if (
    !ascii ||
    ascii.length > 253 ||
    ascii.split('.').some((label) => !label || label.length > 63)
  ) {
    throw new Error('Invalid hostname');
  }
  return ascii;
}

export function validateMappings(mappings: readonly DomainMapping[]): readonly DomainMapping[] {
  const normalized = mappings.map((mapping) => ({
    ...mapping,
    hostname: normalizeHostname(mapping.hostname),
    target: normalizeHostname(mapping.target),
  }));
  const claims = new Map<string, DomainMapping>();
  for (const mapping of normalized) {
    const existing = claims.get(mapping.hostname);
    if (
      existing &&
      (existing.siteId !== mapping.siteId || existing.tenantId !== mapping.tenantId)
    ) {
      throw new Error(`Hostname takeover/collision rejected: ${mapping.hostname}`);
    }
    if (mapping.hostname === mapping.target) throw new Error('Redirect or CNAME loop rejected');
    claims.set(mapping.hostname, mapping);
  }
  return normalized;
}

export async function planDns(
  provider: CloudflareDnsProvider,
  zoneId: string,
  mapping: DomainMapping,
  verificationToken: string,
): Promise<DnsPlan> {
  const [normalized] = validateMappings([mapping]);
  if (!normalized) throw new Error('A domain mapping is required');
  const ownershipName = `_omnireach.${normalized.hostname}`;
  const desired: readonly DnsRecord[] = [
    {
      content: verificationToken,
      name: ownershipName,
      proxied: false,
      ttl: 300,
      type: 'TXT',
    },
    {
      content: normalized.target,
      name: normalized.hostname,
      proxied: true,
      ttl: 1,
      type: 'CNAME',
    },
  ];
  const current = await provider.list(zoneId, normalized.hostname);
  const changes = desired.map((record): DnsChange => {
    const found = current.find(
      (candidate) => candidate.name === record.name && candidate.type === record.type,
    );
    if (!found) return { action: 'create', desired: record };
    return recordsEqual(found, record)
      ? { action: 'noop', current: found, desired: record }
      : { action: 'update', current: found, desired: record };
  });
  return { changes, hostname: normalized.hostname, zoneId };
}

export async function applyDnsPlan(
  provider: CloudflareDnsProvider,
  plan: DnsPlan,
  options: { readonly dryRun: boolean },
): Promise<readonly DnsRecord[]> {
  return options.dryRun ? [] : provider.apply(plan.zoneId, plan.changes);
}

export class MemoryCloudflareProvider implements CloudflareDnsProvider {
  readonly mutations: DnsChange[] = [];
  readonly records = new Map<string, DnsRecord[]>();

  constructor(
    readonly options: {
      readonly allowedZoneIds?: readonly string[];
      readonly revoked?: boolean;
    } = {},
  ) {}

  async list(zoneId: string, hostname: string): Promise<readonly DnsRecord[]> {
    this.#authorize(zoneId);
    const records = this.records.get(zoneId) ?? [];
    return records.filter(
      (record) => record.name === hostname || record.name === `_omnireach.${hostname}`,
    );
  }

  async apply(zoneId: string, changes: readonly DnsChange[]): Promise<readonly DnsRecord[]> {
    this.#authorize(zoneId);
    const records = [...(this.records.get(zoneId) ?? [])];
    for (const change of changes) {
      if (change.action === 'noop') continue;
      this.mutations.push(change);
      const index = records.findIndex(
        (record) => record.name === change.desired.name && record.type === change.desired.type,
      );
      const currentId = change.action === 'update' ? change.current.id : undefined;
      const applied = { ...change.desired, id: currentId ?? `mock-${records.length + 1}` };
      if (index === -1) records.push(applied);
      else records[index] = applied;
    }
    this.records.set(zoneId, records);
    return records;
  }

  #authorize(zoneId: string): void {
    if (this.options.revoked) throw new Error('Cloudflare credential is revoked');
    if (this.options.allowedZoneIds && !this.options.allowedZoneIds.includes(zoneId)) {
      throw new Error('Cloudflare credential is not scoped to this zone');
    }
  }
}

function recordsEqual(left: DnsRecord, right: DnsRecord): boolean {
  return (
    left.content === right.content &&
    left.name === right.name &&
    left.proxied === right.proxied &&
    left.ttl === right.ttl &&
    left.type === right.type
  );
}
