import { describe, expect, it } from 'vitest';
import { auditSite, unavailableMeasurement, type AuditPage } from '@omnireach/seo-core';

const good: AuditPage = {
  canonical: 'https://fixture.example/',
  headings: ['Welcome'],
  images: [{ alt: 'Hero', src: 'https://fixture.example/hero.png' }],
  indexable: true,
  links: ['https://fixture.example/about'],
  metadata: { description: 'A useful fictional description.', title: 'Fictional Site' },
  mixedContent: false,
  securityHeaders: true,
  sitemapMember: true,
  status: 200,
  structuredDataCount: 1,
  text: 'Call 555-0100',
  url: 'https://fixture.example/',
};

describe('deterministic SEO/AIO audit', () => {
  it('detects supported defects with evidence and honest AIO limits', () => {
    const { canonical, ...withoutCanonical } = good;
    void canonical;
    const defective: AuditPage = {
      ...withoutCanonical,
      headings: [],
      images: [{ alt: null, src: 'https://fixture.example/hero.png' }],
      indexable: false,
      metadata: {},
      mixedContent: true,
      securityHeaders: false,
      sitemapMember: false,
      structuredDataCount: 0,
    };
    const findings = auditSite({
      expectedFacts: { phone: '555-0199' },
      manifestRoutes: [good.url],
      pages: [defective],
    });
    const rules = new Set(findings.map((item) => item.ruleId));
    for (const rule of [
      'seo.title',
      'seo.description',
      'seo.canonical',
      'seo.sitemap',
      'seo.indexability',
      'aio.structured-data-completeness',
      'seo.image-alt',
      'seo.https-mixed-content',
      'seo.security-headers',
      'seo.heading',
      'seo.fact-consistency',
    ])
      expect(rules.has(rule)).toBe(true);
    expect(
      findings.find((item) => item.ruleId === 'aio.structured-data-completeness')?.limitation,
    ).toContain('not an AI ranking');
    const fact = findings.find((item) => item.ruleId === 'seo.fact-consistency');
    expect(fact?.remediation).toBe('none');
    expect(JSON.stringify(fact)).not.toContain('555-0199');
  });
  it('keeps unavailable distinct from zero', () => {
    expect(unavailableMeasurement('ai-referrals', 'not connected')).toEqual({
      name: 'ai-referrals',
      reason: 'not connected',
      state: 'unavailable',
    });
  });
});
