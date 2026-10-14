import {
  deriveVisibilityOpportunities,
  resolveAnalyticsDateRange,
} from '../../apps/api/src/orap-analytics.ts';
import { renderOrapAnalyticsDashboard } from '../../packages/ui/src/analytics.ts';
import { describe, expect, it } from 'vitest';

const now = new Date('2026-10-13T15:30:00.000Z');

describe('ORAP analytics model', () => {
  it('uses complete UTC days and an equal non-overlapping comparison period', () => {
    expect(resolveAnalyticsDateRange({ preset: '7' }, now)).toEqual({
      days: 7,
      endDate: '2026-10-12',
      label: 'Last 7 days',
      preset: '7',
      previousEndDate: '2026-10-05',
      previousStartDate: '2026-09-29',
      startDate: '2026-10-06',
    });
  });

  it('accepts a bounded custom range and rejects future, reversed, and oversized ranges', () => {
    expect(
      resolveAnalyticsDateRange(
        { endDate: '2026-03-31', preset: 'custom', startDate: '2026-03-01' },
        now,
      ),
    ).toMatchObject({ days: 31, previousEndDate: '2026-02-28', previousStartDate: '2026-01-29' });
    expect(() =>
      resolveAnalyticsDateRange(
        { endDate: '2026-10-14', preset: 'custom', startDate: '2026-10-01' },
        now,
      ),
    ).toThrow('future');
    expect(() =>
      resolveAnalyticsDateRange(
        { endDate: '2026-09-01', preset: 'custom', startDate: '2026-10-01' },
        now,
      ),
    ).toThrow('start');
    expect(() =>
      resolveAnalyticsDateRange(
        { endDate: '2026-10-01', preset: 'custom', startDate: '2026-01-01' },
        now,
      ),
    ).toThrow('90');
  });

  it('derives deterministic review prompts without promising an outcome', () => {
    const opportunities = deriveVisibilityOpportunities([
      {
        clicks: 2,
        ctr: 0.01,
        impressions: 200,
        label: 'mobile detailing',
        position: 7.5,
        previousClicks: 1,
        previousImpressions: 150,
        trafficDeltaPercent: 100,
      },
      {
        clicks: 3,
        ctr: 0.03,
        impressions: 120,
        label: 'car wash near me',
        position: 14,
        previousClicks: 2,
        previousImpressions: 100,
        trafficDeltaPercent: 50,
      },
      {
        clicks: 20,
        ctr: 0.2,
        impressions: 100,
        label: 'brand',
        position: 1,
        previousClicks: 20,
        previousImpressions: 100,
        trafficDeltaPercent: 0,
      },
    ]);

    expect(opportunities).toHaveLength(2);
    expect(opportunities.map(({ label }) => label)).toEqual(
      expect.arrayContaining(['mobile detailing', 'car wash near me']),
    );
    expect(opportunities.find(({ label }) => label === 'mobile detailing')?.limitation).toContain(
      'does not predict',
    );
    expect(opportunities.find(({ label }) => label === 'car wash near me')?.limitation).toContain(
      'not a guaranteed outcome',
    );
  });

  it('renders exact sources, accessible tables, unsupported states, and escaped labels', () => {
    const html = renderOrapAnalyticsDashboard(
      {
        dataQuality: {
          connections: [
            {
              availableEndDate: '2026-10-12',
              availableStartDate: '2026-10-01',
              lastErrorCode: null,
              lastSyncedAt: '2026-10-13T04:10:00.000Z',
              propertyId: 'sc-domain:example.test',
              propertyKind: 'search_console',
              propertyMapping: 'sc-domain:example.test',
              status: 'connected',
            },
          ],
          generatedAt: '2026-10-13T05:00:00.000Z',
          notes: ['No browser polling.'],
          state: 'partial',
        },
        kpis: [
          {
            current: 10,
            definition: 'Total measured clicks.',
            deltaPercent: 25,
            key: 'clicks',
            label: 'Search clicks',
            previous: 8,
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
        opportunities: [],
        range: {
          days: 7,
          endDate: '2026-10-12',
          label: 'Last 7 days',
          preset: '7',
          previousEndDate: '2026-10-05',
          previousStartDate: '2026-09-29',
          startDate: '2026-10-06',
        },
        series: [
          {
            activeUsers: null,
            clicks: 10,
            ctr: 0.05,
            date: '2026-10-06',
            impressions: 200,
            pageViews: null,
            position: 7.5,
            sessions: null,
            totalSessions: null,
          },
        ],
        site: {
          id: '20000000-0000-4000-8000-000000000001',
          name: '<script>unsafe()</script>',
          tenantId: '10000000-0000-4000-8000-000000000001',
          tenantName: 'Fictional customer',
        },
        technical: {
          crawlCompletedAt: null,
          crawlState: null,
          failingPages: null,
          findings: { critical: 0, high: 0, info: 0, low: 0, medium: 0 },
          openFindings: 0,
          pagesCrawled: null,
          resolvedFindings: 0,
          topFindings: [],
        },
        timeline: [],
        topPages: [],
        topQueries: [],
      },
      [
        {
          id: '20000000-0000-4000-8000-000000000001',
          name: 'Safe site',
          status: 'active',
          tenantId: '10000000-0000-4000-8000-000000000001',
          tenantName: 'Fictional customer',
        },
      ],
      { limit: 25, pageSort: 'clicks', querySort: 'clicks' },
      ['analytics', 'security'],
    );

    expect(html).toContain('Analytics &amp; SEO performance');
    expect(html).toContain('View daily data table');
    expect(html).toContain('Unsupported');
    expect(html).toContain('Timing alone does not prove');
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(html).not.toContain('<script>unsafe()');
    expect(html).toContain('aria-label="Daily analytics measurements"');
    expect(html).toContain('sc-domain:example.test');
    expect(html).toContain('2026-10-01 through 2026-10-12');
    expect(html).toContain('Search impressions time series');
    expect(html).toContain('Search CTR time series');
    expect(html).toContain('Average search position time series');
  });
});
