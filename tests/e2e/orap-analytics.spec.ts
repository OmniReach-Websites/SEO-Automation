import { expect, test } from '@playwright/test';

import {
  adminStylesheet,
  analyticsStylesheet,
  renderOrapAnalyticsDashboard,
} from '../../packages/ui/src/index.ts';

const siteId = '20000000-0000-4000-8000-000000000001';

test('ORAP analytics remains usable and semantically navigable on a narrow employee screen', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  const html = renderOrapAnalyticsDashboard(
    {
      dataQuality: {
        connections: [],
        generatedAt: '2026-10-13T05:00:00.000Z',
        notes: ['Metrics are collected by scheduled workers.'],
        state: 'not_connected',
      },
      kpis: [
        {
          current: 22,
          definition: 'Measured Search Console clicks.',
          deltaPercent: 10,
          key: 'clicks',
          label: 'Search clicks',
          previous: 20,
          source: 'search_console',
          state: 'available',
          unit: 'count',
        },
        {
          current: null,
          definition: 'Not collected.',
          deltaPercent: null,
          key: 'conversions',
          label: 'Conversions',
          previous: null,
          source: 'ga4',
          state: 'unsupported',
          unit: 'count',
        },
      ],
      opportunities: [
        {
          evidence: '200 impressions, 1.0% CTR, average position 7.5',
          kind: 'click_through',
          label: 'fixture query',
          limitation: 'This is a review prompt and does not predict an outcome.',
          score: 6,
        },
      ],
      range: {
        days: 7,
        endDate: '2026-10-12',
        label: 'Last 7 days',
        preset: '7',
        previousEndDate: '2026-10-05',
        previousStartDate: '2026-09-29',
        startDate: '2026-10-06',
      },
      series: Array.from({ length: 7 }, (_, index) => ({
        activeUsers: 4 + index,
        clicks: 2 + index,
        ctr: (2 + index) / (30 + index * 4),
        date: `2026-10-${String(6 + index).padStart(2, '0')}`,
        impressions: 30 + index * 4,
        pageViews: 8 + index,
        position: 8 - index / 4,
        sessions: 6 + index,
        totalSessions: 10 + index,
      })),
      site: { id: siteId, name: 'Fixture site', tenantId: 'tenant-a', tenantName: 'Fixture' },
      technical: {
        crawlCompletedAt: '2026-10-12T03:00:00.000Z',
        crawlState: 'succeeded',
        failingPages: 1,
        findings: { critical: 0, high: 1, info: 0, low: 0, medium: 1 },
        openFindings: 2,
        pagesCrawled: 12,
        resolvedFindings: 1,
        topFindings: [
          {
            affectedPage: 'https://example.test/services',
            limitation: 'Deterministic HTML evidence only.',
            remediation: 'contract_metadata',
            ruleId: 'title_missing',
            severity: 'high',
            state: 'open',
          },
        ],
      },
      timeline: [
        {
          category: 'seo_audit',
          occurredAt: '2026-10-10T04:00:00.000Z',
          state: 'succeeded',
          summary: 'SEO audit succeeded',
        },
      ],
      topPages: [
        {
          clicks: 10,
          ctr: 0.05,
          impressions: 200,
          label: 'https://example.test/',
          position: 5,
          previousClicks: 8,
          previousImpressions: 180,
          trafficDeltaPercent: 25,
        },
      ],
      topQueries: [
        {
          clicks: 2,
          ctr: 0.01,
          impressions: 200,
          label: 'fixture query',
          position: 7.5,
          previousClicks: 1,
          previousImpressions: 150,
          trafficDeltaPercent: 100,
        },
      ],
    },
    [
      {
        id: siteId,
        name: 'Fixture site',
        status: 'active',
        tenantId: 'tenant-a',
        tenantName: 'Fixture',
      },
    ],
    { limit: 25, pageSort: 'clicks', querySort: 'clicks' },
    ['overview', 'sites', 'analytics', 'operations', 'security'],
  ).replace('</head>', `<style>${adminStylesheet}${analyticsStylesheet}</style></head>`);
  await page.setContent(html);

  await expect(
    page.getByRole('heading', { level: 1, name: 'Analytics & SEO performance' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Analytics & SEO' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('combobox', { name: 'Customer website' })).toBeVisible();
  await expect(page.getByText('Unsupported', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /Search clicks time series/u })).toBeVisible();
  await page.getByText('View daily data table').click();
  await expect(page.getByRole('table', { name: /Daily persisted Search Console/u })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
