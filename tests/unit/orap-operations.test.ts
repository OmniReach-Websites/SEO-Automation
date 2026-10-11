import { describe, expect, it } from 'vitest';
import {
  renderDomainOperations,
  renderIntegrationHealth,
  renderOperationsCenter,
} from '@omnireach/orap';

describe('ORAP operations views', () => {
  it('shows domain state and dry-run-only onboarding action', () => {
    const html = renderDomainOperations(
      [{ hostname: 'fixture.example', id: 'domain-1', state: 'dns_pending' }],
      'csrf',
    );
    expect(html).toContain('dns_pending');
    expect(html).toContain('Create dry-run DNS plan');
    expect(html).not.toContain('Delete');
  });
  it('shows budget, traceable jobs, and deduplicated alerts', () => {
    const html = renderOperationsCenter({
      alerts: [
        {
          fingerprint: 'abc',
          id: '80000000-0000-4000-8000-000000000001',
          message: 'worker unavailable',
          occurrences: 3,
          severity: 'error',
          state: 'open',
        },
      ],
      budget: {
        capUsdMicros: 5_000_000,
        periodStart: '2026-10-01T00:00:00Z',
        reservedUsdMicros: 500_000,
        usedUsdMicros: 1_000_000,
      },
      jobs: [
        {
          category: 'crawl',
          id: 'job',
          state: 'running',
          traceId: 'trace-fixture-1234',
          updatedAt: '2026-10-10',
        },
        {
          category: 'seo_audit',
          id: '70000000-0000-4000-8000-000000000002',
          state: 'failed',
          traceId: 'trace-fixture-5678',
          updatedAt: '2026-10-10',
        },
        {
          category: 'health_check',
          id: '70000000-0000-4000-8000-000000000003',
          state: 'queued',
          traceId: 'trace-fixture-9012',
          updatedAt: '2026-10-10',
        },
      ],
    });
    expect(html).toContain('$5.00 USD');
    expect(html).toContain('trace-fixture-1234');
    expect(html).toContain('(3)');
    expect(html).toContain('<caption>');
    expect(html).toContain('/acknowledge');
    expect(html).toContain('/resolve');
    expect(html).toContain('/replay');
    expect(html).toContain('/cancel');
  });
  it('shows explicit disconnected and stale integration health', () => {
    expect(renderIntegrationHealth([])).toContain('Not connected');
    const html = renderIntegrationHealth([
      {
        kind: 'Search Console',
        lastSyncedAt: '2026-10-01',
        propertyMapping: 'sc-domain:fixture.example',
        status: 'expired',
      },
    ]);
    expect(html).toContain('expired');
    expect(html).toContain('sc-domain:fixture.example');
  });
});
