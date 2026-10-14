import type { AdminActor, TenantTransactionClient } from '@omnireach/tenant';
import { describe, expect, it, vi } from 'vitest';

import { PostgresOrapService } from '../../apps/api/src/postgres-orap.ts';

const tenantId = '10000000-0000-4000-8000-000000000001';
const siteId = '20000000-0000-4000-8000-000000000001';
const actor: AdminActor = {
  id: '40000000-0000-4000-8000-000000000001',
  role: 'platform_owner',
  traceId: 'trace-analytics',
};

describe('PostgreSQL ORAP analytics', () => {
  it('aggregates persisted site-scoped evidence with bounded allowlisted queries', async () => {
    const calls: { sql: string; values?: unknown[] }[] = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, ...(values ? { values } : {}) });
        if (sql.includes('SELECT id FROM sites WHERE tenant_id')) return { rows: [{ id: siteId }] };
        if (sql.includes('JOIN tenants t') && sql.includes('s.id = $2')) {
          return {
            rows: [
              { id: siteId, name: 'Fixture site', tenant_id: tenantId, tenant_name: 'Fixture' },
            ],
          };
        }
        if (sql.includes('FROM integration_connections')) {
          return {
            rows: [
              {
                available_end_date: '2026-10-12',
                available_start_date: '2026-09-29',
                last_synced_at: new Date(),
                property_id: 'sc-domain:example.test',
                property_kind: 'search_console',
                property_mapping: 'sc-domain:example.test',
                refresh_failure_code: null,
                status: 'connected',
              },
              {
                available_end_date: '2026-10-12',
                available_start_date: '2026-09-29',
                last_synced_at: new Date(),
                property_id: 'properties/123456789',
                property_kind: 'ga4',
                property_mapping: 'https://example.test/',
                refresh_failure_code: null,
                status: 'connected',
              },
            ],
          };
        }
        if (sql.includes("source = 'search_console'") && sql.includes('GROUP BY day')) {
          return {
            rows: [
              { clicks: '5', day: '2026-09-30', impressions: '50', position: '9' },
              { clicks: '10', day: '2026-10-06', impressions: '200', position: '7' },
            ],
          };
        }
        if (sql.includes("source = 'ga4'") && sql.includes('GROUP BY day')) {
          return {
            rows: [
              {
                active_users: '6',
                day: '2026-09-30',
                page_views: '15',
                sessions: '8',
                total_sessions: '12',
              },
              {
                active_users: '10',
                day: '2026-10-06',
                page_views: '30',
                sessions: '20',
                total_sessions: '35',
              },
            ],
          };
        }
        if (sql.includes("dimensions->>'query'")) {
          return {
            rows: [
              {
                clicks: '2',
                ctr: '0.01',
                impressions: '200',
                label: 'fixture query',
                position: '7.5',
                previous_clicks: '1',
                previous_impressions: '150',
              },
            ],
          };
        }
        if (sql.includes("dimensions->>'page'")) {
          return {
            rows: [
              {
                clicks: '10',
                ctr: '0.05',
                impressions: '200',
                label: 'https://example.test/',
                position: '5',
                previous_clicks: '8',
                previous_impressions: '180',
              },
            ],
          };
        }
        if (sql.includes('WITH latest_crawl')) {
          return {
            rows: [
              {
                crawl_completed_at: '2026-10-12T03:00:00.000Z',
                crawl_state: 'succeeded',
                critical: 0,
                failing_pages: 1,
                high: 1,
                info: 0,
                low: 0,
                medium: 1,
                open_findings: 2,
                pages_crawled: 12,
                resolved_findings: 3,
              },
            ],
          };
        }
        if (sql.includes('SELECT rule_id, severity, state, evidence')) {
          return {
            rows: [
              {
                evidence: { url: 'https://example.test/services' },
                limitation: 'Deterministic fixture evidence',
                remediation: 'contract_metadata',
                rule_id: 'title_missing',
                severity: 'high',
                state: 'open',
              },
            ],
          };
        }
        if (sql.includes('SELECT job.category')) {
          return {
            rows: [
              {
                category: 'seo_audit',
                occurred_at: '2026-10-10T04:00:00.000Z',
                state: 'succeeded',
              },
            ],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    } as unknown as TenantTransactionClient & { release(): void };
    const service = new PostgresOrapService(
      { connect: vi.fn(async () => client) },
      { send: vi.fn() },
      vi.fn(),
    );

    const result = await service.siteAnalytics(actor, {
      endDate: '2026-10-12',
      limit: 25,
      pageSort: 'impressions',
      preset: '7',
      previousEndDate: '2026-10-05',
      previousStartDate: '2026-09-29',
      querySort: 'ctr',
      siteId,
      startDate: '2026-10-06',
      tenantId,
    });

    expect(result.site).toMatchObject({ id: siteId, tenantId });
    expect(result.kpis.find(({ key }) => key === 'clicks')).toMatchObject({
      current: 10,
      deltaPercent: 100,
      previous: 5,
      state: 'available',
    });
    expect(result.opportunities[0]).toMatchObject({ label: 'fixture query' });
    expect(result.topQueries[0]).toMatchObject({
      previousClicks: 1,
      previousImpressions: 150,
      trafficDeltaPercent: 100,
    });
    expect(result.dataQuality.connections[0]).toMatchObject({
      availableEndDate: '2026-10-12',
      propertyId: 'sc-domain:example.test',
      propertyMapping: 'sc-domain:example.test',
    });
    expect(result.technical).toMatchObject({
      failingPages: 1,
      openFindings: 2,
      pagesCrawled: 12,
      resolvedFindings: 3,
    });
    expect(result.technical.topFindings[0]).toMatchObject({
      affectedPage: 'https://example.test/services',
    });
    expect(result.timeline[0]).toMatchObject({ category: 'seo_audit', state: 'succeeded' });
    expect(result.series).toHaveLength(7);
    expect(result.series[0]).toMatchObject({
      clicks: 10,
      ctr: 0.05,
      date: '2026-10-06',
      position: 7,
      sessions: 20,
      totalSessions: 35,
    });

    const metricQueries = calls.filter(({ sql }) => sql.includes('metric_snapshots'));
    expect(metricQueries.length).toBeGreaterThanOrEqual(4);
    expect(
      metricQueries.every(({ values }) => values?.[0] === tenantId && values[1] === siteId),
    ).toBe(true);
    expect(calls.find(({ sql }) => sql.includes("dimensions->>'query'"))?.sql).toContain(
      'ORDER BY ctr DESC',
    );
    expect(calls.find(({ sql }) => sql.includes("dimensions->>'query'"))?.values).toEqual([
      tenantId,
      siteId,
      '2026-09-29',
      '2026-10-05',
      '2026-10-06',
      '2026-10-12',
      25,
    ]);
    expect(calls.find(({ sql }) => sql.includes("dimensions->>'page'"))?.sql).toContain(
      'ORDER BY impressions DESC',
    );
  });

  it('rejects a direct cross-site request before opening a database transaction', async () => {
    const connect = vi.fn();
    const service = new PostgresOrapService({ connect }, { send: vi.fn() }, vi.fn());
    const scopedActor: AdminActor = {
      authorization: {
        grants: [
          {
            assignmentId: 'assignment-a',
            permissionKeys: ['analytics.view'],
            portfolio: false,
            siteIds: [siteId],
            tenantIds: [],
          },
        ],
        membershipId: 'membership-a',
        version: 1,
      },
      id: '40000000-0000-4000-8000-000000000002',
      role: 'staff',
      traceId: 'trace-scoped-analytics',
    };

    expect(() =>
      service.siteAnalytics(scopedActor, {
        endDate: '2026-10-12',
        limit: 25,
        pageSort: 'clicks',
        preset: '7',
        previousEndDate: '2026-10-05',
        previousStartDate: '2026-09-29',
        querySort: 'clicks',
        siteId: '20000000-0000-4000-8000-000000000099',
        startDate: '2026-10-06',
        tenantId,
      }),
    ).toThrow('not authorized');
    expect(connect).not.toHaveBeenCalled();
  });
});
