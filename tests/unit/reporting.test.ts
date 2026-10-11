import { describe, expect, it } from 'vitest';
import {
  renderReportingDashboard,
  visibleMeasurementKinds,
  type ReportMeasurement,
} from '@omnireach/ui';

const measurements: ReportMeasurement[] = [
  {
    freshness: 'current',
    kind: 'traffic',
    label: 'Organic visits',
    source: 'GA4 property fixture',
    state: 'available',
    value: 42,
    windowEnd: '2026-10-10',
    windowStart: '2026-10-01',
  },
  {
    freshness: 'unknown',
    kind: 'ai_referral',
    label: 'Observable AI referrals',
    source: 'GA4 referral mapping v1',
    state: 'not_connected',
  },
  {
    caveat: 'Sampled observation only; not a rank.',
    freshness: 'current',
    kind: 'sampled_mention',
    label: 'Sampled AI mentions',
    source: 'OpenAI fixture model; prompt hash abc; Guatemala; 3 repetitions',
    state: 'available',
    value: '1 of 3',
    windowEnd: '2026-10-10',
    windowStart: '2026-10-10',
  },
  {
    caveat: 'Deterministic completeness proxy.',
    freshness: 'current',
    kind: 'structured_data',
    label: 'Structured-data completeness',
    source: 'Audit rules v1',
    state: 'available',
    value: '90%',
    windowEnd: '2026-10-10',
    windowStart: '2026-10-10',
  },
];
describe('honest reporting dashboard', () => {
  it('shows source/window/freshness and distinct unavailable states without rankings', () => {
    const html = renderReportingDashboard(measurements, 'customer_viewer');
    expect(html).toContain('GA4 property fixture');
    expect(html).toContain('Not connected');
    expect(html).toContain('Sampled observation only');
    expect(html).toContain('Deterministic completeness proxy');
    expect(html).not.toContain('AI score');
    expect(html).toContain('<caption>');
    expect(html).toContain('role="region"');
  });
  it('denies unknown roles and applies the complete approved role matrix', () => {
    for (const role of [
      'platform_owner',
      'platform_admin',
      'staff',
      'customer_owner',
      'customer_editor',
      'customer_viewer',
    ] as const)
      expect(visibleMeasurementKinds(role).length).toBeGreaterThan(0);
    expect(visibleMeasurementKinds('unknown' as never)).toEqual([]);
    const privateMeasurement: ReportMeasurement = {
      audience: 'staff',
      freshness: 'current',
      kind: 'integration',
      label: 'Provider diagnostic',
      source: 'private trace fixture',
      state: 'available',
      value: 'internal',
    };
    expect(renderReportingDashboard([privateMeasurement], 'staff')).toContain(
      'Provider diagnostic',
    );
    expect(renderReportingDashboard([privateMeasurement], 'customer_owner')).not.toContain(
      'Provider diagnostic',
    );
  });
});
