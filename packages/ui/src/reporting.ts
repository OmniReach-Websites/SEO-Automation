export type ReportRole =
  | 'customer_editor'
  | 'customer_owner'
  | 'customer_viewer'
  | 'platform_admin'
  | 'platform_owner'
  | 'staff';
export type MeasurementKind =
  | 'ai_referral'
  | 'integration'
  | 'publication'
  | 'sampled_mention'
  | 'seo_finding'
  | 'structured_data'
  | 'traffic'
  | 'usage';

export interface ReportMeasurement {
  readonly audience?: 'customer' | 'owner' | 'staff';
  readonly caveat?: string;
  readonly freshness: 'current' | 'delayed' | 'stale' | 'unknown';
  readonly kind: MeasurementKind;
  readonly label: string;
  readonly source: string;
  readonly state: 'available' | 'not_connected' | 'unavailable';
  readonly value?: number | string;
  readonly windowEnd?: string;
  readonly windowStart?: string;
}

export function visibleMeasurementKinds(role: ReportRole): readonly MeasurementKind[] {
  const customer: readonly MeasurementKind[] = [
    'ai_referral',
    'integration',
    'publication',
    'sampled_mention',
    'seo_finding',
    'structured_data',
    'traffic',
    'usage',
  ];
  return [
    'platform_owner',
    'platform_admin',
    'staff',
    'customer_owner',
    'customer_editor',
    'customer_viewer',
  ].includes(role)
    ? customer
    : [];
}

export function renderReportingDashboard(
  measurements: readonly ReportMeasurement[],
  role: ReportRole,
): string {
  const allowed = new Set(visibleMeasurementKinds(role));
  const rows = measurements
    .filter(
      (measurement) =>
        allowed.has(measurement.kind) && canViewAudience(role, measurement.audience ?? 'customer'),
    )
    .map((measurement) => {
      const value =
        measurement.state === 'available'
          ? String(measurement.value ?? 'Unavailable')
          : measurement.state === 'not_connected'
            ? 'Not connected'
            : 'Unavailable';
      const window =
        measurement.windowStart && measurement.windowEnd
          ? `${measurement.windowStart} to ${measurement.windowEnd}`
          : 'No measurement window';
      return `<tr><th scope="row">${escapeHtml(measurement.label)}</th><td>${escapeHtml(value)}</td><td>${escapeHtml(measurement.source)}</td><td>${escapeHtml(window)}</td><td>${escapeHtml(measurement.freshness)}</td><td>${escapeHtml(measurement.caveat ?? 'None')}</td></tr>`;
    })
    .join('');
  return `<section aria-labelledby="reporting-heading"><h2 id="reporting-heading">Site reporting</h2><p>Work performed, measured outcomes, deterministic proxy checks, and sampled AI mentions are reported separately. No metric is an AI ranking promise.</p><div role="region" aria-label="Scrollable site measurements" tabindex="0"><table><caption>Measurements with source, window, freshness, and limitations</caption><thead><tr><th scope="col">Measurement</th><th scope="col">Value or state</th><th scope="col">Source</th><th scope="col">Window</th><th scope="col">Freshness</th><th scope="col">Limitations</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No authorized measurements are available.</td></tr>'}</tbody></table></div></section>`;
}

function canViewAudience(role: ReportRole, audience: 'customer' | 'owner' | 'staff'): boolean {
  if (role === 'platform_owner' || role === 'platform_admin') return true;
  if (role === 'staff') return audience !== 'owner';
  return audience === 'customer';
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}
