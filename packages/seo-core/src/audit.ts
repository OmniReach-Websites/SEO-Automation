import { createHash } from 'node:crypto';

export type FindingSeverity = 'critical' | 'high' | 'info' | 'low' | 'medium';
export interface AuditPage {
  readonly canonical?: string;
  readonly headings: readonly string[];
  readonly images: readonly { readonly alt: string | null; readonly src: string }[];
  readonly indexable: boolean;
  readonly links: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly mixedContent: boolean;
  readonly securityHeaders: boolean;
  readonly sitemapMember: boolean;
  readonly status: number;
  readonly structuredDataCount: number;
  readonly text: string;
  readonly url: string;
}
export interface Finding {
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly fingerprint: string;
  readonly limitation: string;
  readonly remediation: 'contract_metadata' | 'contract_text' | 'manual' | 'none';
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly severity: FindingSeverity;
  readonly state: 'open';
  readonly url: string;
}
export interface AuditInput {
  readonly expectedFacts?: Readonly<Record<string, string>>;
  readonly manifestRoutes: readonly string[];
  readonly pages: readonly AuditPage[];
}

export function auditSite(input: AuditInput): readonly Finding[] {
  const findings: Finding[] = [];
  const byUrl = new Map(input.pages.map((page) => [page.url, page]));
  const inbound = new Map(input.pages.map((page) => [page.url, 0]));
  for (const page of input.pages) {
    for (const target of page.links)
      if (inbound.has(target)) inbound.set(target, (inbound.get(target) ?? 0) + 1);
    const title = page.metadata.title ?? '';
    if (!title || title.length > 60)
      findings.push(
        finding('seo.title', page.url, 'medium', { length: title.length }, 'contract_metadata'),
      );
    const description = page.metadata.description ?? '';
    if (!description || description.length > 160)
      findings.push(
        finding(
          'seo.description',
          page.url,
          'low',
          { length: description.length },
          'contract_metadata',
        ),
      );
    if (!page.canonical || page.canonical !== page.url)
      findings.push(
        finding('seo.canonical', page.url, 'high', { canonical: page.canonical ?? null }, 'manual'),
      );
    if (!page.sitemapMember)
      findings.push(finding('seo.sitemap', page.url, 'medium', { sitemapMember: false }, 'manual'));
    if (!page.indexable)
      findings.push(finding('seo.indexability', page.url, 'high', { indexable: false }, 'manual'));
    if (page.structuredDataCount === 0)
      findings.push(
        finding(
          'aio.structured-data-completeness',
          page.url,
          'medium',
          { count: 0, measurement: 'proxy' },
          'manual',
          'Completeness is a deterministic proxy, not an AI ranking.',
        ),
      );
    if (page.images.some((image) => !image.alt?.trim()))
      findings.push(
        finding(
          'seo.image-alt',
          page.url,
          'medium',
          { missing: page.images.filter((image) => !image.alt?.trim()).map((image) => image.src) },
          'contract_text',
        ),
      );
    if (!page.url.startsWith('https://') || page.mixedContent)
      findings.push(
        finding(
          'seo.https-mixed-content',
          page.url,
          'high',
          { mixedContent: page.mixedContent },
          'manual',
        ),
      );
    if (!page.securityHeaders)
      findings.push(
        finding('seo.security-headers', page.url, 'medium', { present: false }, 'manual'),
      );
    if (page.headings.length === 0)
      findings.push(finding('seo.heading', page.url, 'medium', { h1Count: 0 }, 'contract_text'));
    for (const target of page.links) {
      const targetPage = byUrl.get(target);
      if (targetPage && targetPage.status >= 400)
        findings.push(
          finding(
            'seo.broken-link',
            page.url,
            'high',
            { status: targetPage.status, target },
            'manual',
          ),
        );
    }
    for (const [factId, value] of Object.entries(input.expectedFacts ?? {}))
      if (!normalize(page.text).includes(normalize(value)))
        findings.push(
          finding(
            'seo.fact-consistency',
            page.url,
            'high',
            { factId, expectedValueHash: createHash('sha256').update(value).digest('hex') },
            'none',
            'Protected facts are reported by hash and must be corrected manually; no replacement is generated.',
          ),
        );
  }
  for (const route of input.manifestRoutes) {
    if (!byUrl.has(route))
      findings.push(finding('seo.manifest-route', route, 'high', { missing: true }, 'manual'));
    else if ((inbound.get(route) ?? 0) === 0 && route !== input.manifestRoutes[0])
      findings.push(finding('seo.orphan', route, 'medium', { inboundLinks: 0 }, 'manual'));
  }
  return [...new Map(findings.map((item) => [item.fingerprint, item])).values()];
}

export function unavailableMeasurement(
  name: string,
  reason: string,
): Readonly<Record<string, string>> {
  return { name, reason, state: 'unavailable' };
}
function finding(
  ruleId: string,
  url: string,
  severity: FindingSeverity,
  evidence: Readonly<Record<string, unknown>>,
  remediation: Finding['remediation'],
  limitation = 'Deterministic rule based on captured crawl evidence.',
): Finding {
  return {
    evidence,
    fingerprint: createHash('sha256')
      .update(`${ruleId}\0${url}\0${JSON.stringify(evidence)}`)
      .digest('hex'),
    limitation,
    remediation,
    ruleId,
    ruleVersion: 1,
    severity,
    state: 'open',
    url,
  };
}
function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
}
