import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { orapRoutePolicyRegistry } from '../../apps/api/src/orap-route-policy.ts';

const root = resolve(import.meta.dirname, '../..');

describe('ORAP analytics isolation controls', () => {
  it('registers every analytics endpoint under the site-scoped analytics capability', () => {
    expect(orapRoutePolicyRegistry.filter(({ path }) => path.includes('analytics'))).toEqual([
      {
        capabilities: ['analytics.view'],
        method: 'GET',
        path: '/v1/orap/analytics/sites',
      },
      {
        capabilities: ['analytics.view'],
        method: 'GET',
        path: '/v1/orap/sites/:siteId/analytics',
      },
    ]);
  });

  it('adds a platform branch only to dashboard evidence policies while retaining exact-site scope', () => {
    const migration = readFileSync(
      resolve(
        root,
        'packages/database/prisma/migrations/20261013170000_google_metric_observation_identity/migration.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('GRANT SELECT ON TABLE publication_requests TO omnireach_platform');
    for (const table of [
      'crawl_runs',
      'crawl_pages',
      'audit_runs',
      'findings',
      'publication_requests',
    ]) {
      const policy = migration.match(
        new RegExp(`CREATE POLICY tenant_or_platform_${table} ON ${table}([\\s\\S]*?);`, 'u'),
      )?.[1];
      expect(policy, table).toContain(
        "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid",
      );
      expect(policy, table).toContain(
        "site_id = NULLIF(current_setting('app.site_id', true), '')::uuid",
      );
      expect(policy, table).toContain("pg_has_role(current_user, 'omnireach_platform', 'member')");
    }
  });

  it('keeps every dashboard evidence query bound to tenant and site parameters', () => {
    const source = readFileSync(resolve(root, 'apps/api/src/postgres-orap.ts'), 'utf8');
    const analyticsSlice = source.slice(
      source.indexOf('siteAnalytics('),
      source.indexOf('siteManagement(', source.indexOf('siteAnalytics(')),
    );

    expect(analyticsSlice).not.toContain('${input.tenantId}');
    expect(analyticsSlice).not.toContain('${input.siteId}');
    expect(analyticsSlice).toContain('[input.tenantId, input.siteId]');
    expect(analyticsSlice).toContain('scopeValues');
    expect(analyticsSlice).toContain('analyticsOrderBy(input.querySort)');
    expect(analyticsSlice).toContain('analyticsOrderBy(input.pageSort)');
  });
});
