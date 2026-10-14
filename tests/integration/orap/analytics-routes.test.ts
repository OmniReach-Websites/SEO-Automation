import { buildApiServer } from '@omnireach/api';
import type { AdminActor } from '@omnireach/tenant';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OrapAnalyticsDashboard } from '../../../apps/api/src/orap-analytics.ts';
import type { OrapAdministrationEndpointService } from '../../../apps/api/src/orap-routes.ts';

const tenantId = '10000000-0000-4000-8000-000000000001';
const siteId = '20000000-0000-4000-8000-000000000001';
const owner: AdminActor = {
  id: '40000000-0000-4000-8000-000000000001',
  role: 'platform_owner',
  traceId: 'trace-analytics-route',
};

function dashboard(): OrapAnalyticsDashboard {
  return {
    dataQuality: {
      connections: [],
      generatedAt: '2026-10-13T05:00:00.000Z',
      notes: ['No provider connection.'],
      state: 'not_connected',
    },
    kpis: [],
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
    series: [],
    site: { id: siteId, name: 'Fixture site', tenantId, tenantName: 'Fixture customer' },
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
  };
}

function analyticsService() {
  return {
    listAnalyticsSites: vi.fn(async () => [
      {
        id: siteId,
        name: 'Fixture site',
        status: 'active',
        tenantId,
        tenantName: 'Fixture customer',
      },
    ]),
    siteAnalytics: vi.fn(async () => dashboard()),
  } as unknown as OrapAdministrationEndpointService;
}

const servers: ReturnType<typeof buildApiServer>[] = [];
afterEach(async () => Promise.all(servers.splice(0).map(async (server) => server.close())));

describe('ORAP analytics routes', () => {
  it('returns a bounded authorized dashboard API model', async () => {
    const service = analyticsService();
    const server = buildApiServer({
      logLevel: 'silent',
      orapService: service,
      resolvePlatformActor: async () => owner,
    });
    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: `/v1/orap/sites/${siteId}/analytics?tenantId=${tenantId}&range=7&limit=50&querySort=ctr&pageSort=impressions`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ site: { id: siteId } });
    expect(service.siteAnalytics).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({
        limit: 50,
        pageSort: 'impressions',
        preset: '7',
        querySort: 'ctr',
        siteId,
        tenantId,
      }),
    );
  });

  it('denies direct cross-site manipulation before invoking the service', async () => {
    const service = analyticsService();
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
      traceId: 'trace-scoped-route',
    };
    const server = buildApiServer({
      logLevel: 'silent',
      orapService: service,
      resolvePlatformActor: async () => scopedActor,
    });
    servers.push(server);
    const response = await server.inject({
      method: 'GET',
      url: `/v1/orap/sites/20000000-0000-4000-8000-000000000099/analytics?tenantId=${tenantId}`,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'orap_authorization_denied' });
    expect(service.siteAnalytics).not.toHaveBeenCalled();
  });

  it('renders the employee dashboard and fails closed for invalid custom dates', async () => {
    const service = analyticsService();
    const server = buildApiServer({
      logLevel: 'silent',
      orapService: service,
      resolvePlatformActor: async () => owner,
    });
    servers.push(server);

    const page = await server.inject({
      method: 'GET',
      url: '/orap/analytics?range=7',
    });
    const invalid = await server.inject({
      method: 'GET',
      url: `/orap/analytics?siteId=${siteId}&range=custom&startDate=2026-01-01&endDate=2026-10-01`,
    });

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Analytics &amp; SEO performance');
    expect(page.body).toContain('Every reported value comes from persisted platform evidence');
    expect(service.siteAnalytics).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ siteId, tenantId }),
    );
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).toContain('between 1 and 90 days');
  });

  it('renders a safe employee-facing error without exposing backend details', async () => {
    const service = analyticsService();
    const siteAnalytics = service.siteAnalytics;
    if (!siteAnalytics) throw new Error('Analytics fixture is unavailable');
    vi.mocked(siteAnalytics).mockRejectedValueOnce(
      new Error('fictional database detail that must not reach the page'),
    );
    const server = buildApiServer({
      logLevel: 'silent',
      orapService: service,
      resolvePlatformActor: async () => owner,
    });
    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: `/orap/analytics?siteId=${siteId}&range=7`,
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('Analytics is temporarily unavailable');
    expect(response.body).not.toContain('fictional database detail');
  });
});
