import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AlertCenter } from '@omnireach/observability';
import { auditSite, type AuditPage } from '@omnireach/seo-core';
import { renderReportingDashboard } from '@omnireach/ui';
import { crawlSite } from '@omnireach/worker-crawler';

describe('ten-site local capacity and failure isolation', () => {
  it('keeps ten fictional sites bounded with two concurrent workloads', async () => {
    const existingRoute = resolve('infrastructure/caddy/fixtures/existing-routes.Caddyfile');
    const before = await readFile(existingRoute, 'utf8');
    const started = performance.now();
    const heapBefore = process.memoryUsage().heapUsed;
    const sites = Array.from({ length: 10 }, (_, index) => `site-${index}.example`);
    const results = [];
    for (let offset = 0; offset < sites.length; offset += 2) {
      const pair = sites.slice(offset, offset + 2);
      results.push(
        ...(await Promise.all(
          pair.map(async (hostname) => {
            const evidence = await crawlSite({
              fetchRaw: async (url) => ({
                body: `<title>${hostname}</title><meta name="description" content="Fictional capacity fixture"><link rel="canonical" href="${url.href}"><h1>Welcome</h1><script type="application/ld+json">{}</script>`,
                contentType: 'text/html',
                headers: {},
                status: 200,
              }),
              maxBytes: 20_000,
              maxPages: 2,
              maxRedirects: 2,
              resolveHostname: async () => ['93.184.216.34'],
              startUrl: `https://${hostname}/`,
              timeoutMs: 1_000,
            });
            const evidenceUrl = evidence[0]?.url;
            const page: AuditPage = {
              ...(evidenceUrl ? { canonical: evidenceUrl } : {}),
              headings: evidence[0]?.headings ?? [],
              images: evidence[0]?.images ?? [],
              indexable: true,
              links: [],
              metadata: evidence[0]?.metadata ?? {},
              mixedContent: false,
              securityHeaders: true,
              sitemapMember: true,
              status: 200,
              structuredDataCount: evidence[0]?.structuredDataCount ?? 0,
              text: 'Fictional capacity fixture',
              url: evidenceUrl ?? `https://${hostname}/`,
            };
            const findings = auditSite({ manifestRoutes: [page.url], pages: [page] });
            const dashboard = renderReportingDashboard(
              [
                {
                  freshness: 'current',
                  kind: 'seo_finding',
                  label: 'Findings',
                  source: 'rules v1',
                  state: 'available',
                  value: findings.length,
                  windowEnd: '2026-10-10',
                  windowStart: '2026-10-10',
                },
              ],
              'customer_viewer',
            );
            return { dashboard, evidence };
          }),
        )),
      );
    }
    const alerts = new AlertCenter();
    await alerts.report({
      message: 'simulated provider unavailable',
      scope: 'fixture',
      severity: 'error',
      source: 'provider',
    });
    const durationMs = performance.now() - started;
    const heapDelta = process.memoryUsage().heapUsed - heapBefore;
    expect(results).toHaveLength(10);
    expect(
      results.every(
        (result) => result.evidence.length === 1 && result.dashboard.includes('rules v1'),
      ),
    ).toBe(true);
    expect(durationMs).toBeLessThan(5_000);
    expect(heapDelta).toBeLessThan(256 * 1024 * 1024);
    expect(await readFile(existingRoute, 'utf8')).toBe(before);
  });
});
