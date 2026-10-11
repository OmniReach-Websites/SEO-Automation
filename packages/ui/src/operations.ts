export interface DomainRow {
  readonly hostname: string;
  readonly id: string;
  readonly lastErrorCode?: string;
  readonly state: string;
  readonly verifiedAt?: string;
}
export interface JobRow {
  readonly category: string;
  readonly id: string;
  readonly state: string;
  readonly traceId: string;
  readonly updatedAt: string;
}
export interface AlertRow {
  readonly fingerprint: string;
  readonly id?: string;
  readonly message: string;
  readonly occurrences: number;
  readonly severity: string;
  readonly state: string;
}
export interface BudgetView {
  readonly capUsdMicros: number;
  readonly periodStart: string;
  readonly reservedUsdMicros: number;
  readonly usedUsdMicros: number;
}
export interface IntegrationRow {
  readonly kind: string;
  readonly lastSyncedAt?: string;
  readonly propertyMapping: string;
  readonly status: string;
}

export function renderDomainOperations(domains: readonly DomainRow[], csrfToken: string): string {
  const rows = domains
    .map(
      (domain) =>
        `<tr><th scope="row">${escapeHtml(domain.hostname)}</th><td>${escapeHtml(domain.state)}</td><td>${escapeHtml(domain.verifiedAt ?? 'Not verified')}</td><td>${escapeHtml(domain.lastErrorCode ?? 'None')}</td><td><form method="post" action="/orap/domains/${escapeHtml(domain.id)}/plan"><input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}"><button type="submit">Create dry-run DNS plan</button></form></td></tr>`,
    )
    .join('');
  return `<section aria-labelledby="domains-heading"><h2 id="domains-heading">Domain onboarding</h2><table><caption>Verified state and safe next action</caption><thead><tr><th>Hostname</th><th>State</th><th>Verified</th><th>Error</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No domains requested.</td></tr>'}</tbody></table></section>`;
}

export function renderOperationsCenter(input: {
  readonly alerts: readonly AlertRow[];
  readonly budget: BudgetView;
  readonly jobs: readonly JobRow[];
}): string {
  const jobs = input.jobs
    .map((job) => {
      const action =
        job.state === 'queued'
          ? `<form method="post" action="/v1/orap/jobs/${escapeHtml(job.id)}/cancel"><label>Reason<input name="reason" required minlength="3" maxlength="500"></label><button type="submit">Cancel queued job</button></form>`
          : ['cancelled', 'failed', 'skipped'].includes(job.state)
            ? `<form method="post" action="/v1/orap/jobs/${escapeHtml(job.id)}/replay"><label>Reason<input name="reason" required minlength="3" maxlength="500"></label><button type="submit">Replay job</button></form>`
            : '';
      return `<tr><th scope="row">${escapeHtml(job.category)}</th><td>${escapeHtml(job.state)}</td><td>${escapeHtml(job.updatedAt)}</td><td>${escapeHtml(job.traceId)}</td><td>${action}</td></tr>`;
    })
    .join('');
  const alerts = input.alerts
    .map((alert) => {
      const actions =
        alert.id && alert.state !== 'resolved'
          ? `<form method="post" action="/v1/orap/alerts/${escapeHtml(alert.id)}/acknowledge"><label>Reason<input name="reason" required minlength="3" maxlength="500"></label><button type="submit">Acknowledge</button></form><form method="post" action="/v1/orap/alerts/${escapeHtml(alert.id)}/resolve"><label>Resolution<input name="reason" required minlength="3" maxlength="500"></label><button type="submit">Resolve</button></form>`
          : '';
      return `<li><strong>${escapeHtml(alert.severity)}</strong> ${escapeHtml(alert.message)} (${alert.occurrences}) — ${escapeHtml(alert.state)}${actions}</li>`;
    })
    .join('');
  return `<section aria-labelledby="operations-heading"><h1 id="operations-heading">Operations</h1><h2>AI budget</h2><dl><dt>UTC period</dt><dd>${escapeHtml(input.budget.periodStart)}</dd><dt>Cap</dt><dd>${formatUsd(input.budget.capUsdMicros)}</dd><dt>Used</dt><dd>${formatUsd(input.budget.usedUsdMicros)}</dd><dt>Reserved</dt><dd>${formatUsd(input.budget.reservedUsdMicros)}</dd></dl><h2>Jobs</h2><table><caption>Tenant-scoped job activity</caption><thead><tr><th>Type</th><th>State</th><th>Updated</th><th>Trace</th><th>Action</th></tr></thead><tbody>${jobs || '<tr><td colspan="5">No jobs.</td></tr>'}</tbody></table><h2>Alerts</h2><ul>${alerts || '<li>No open alerts.</li>'}</ul></section>`;
}

export function renderIntegrationHealth(connections: readonly IntegrationRow[]): string {
  const rows = connections
    .map(
      (connection) =>
        `<tr><th scope="row">${escapeHtml(connection.kind)}</th><td>${escapeHtml(connection.propertyMapping)}</td><td>${escapeHtml(connection.status)}</td><td>${escapeHtml(connection.lastSyncedAt ?? 'Never')}</td></tr>`,
    )
    .join('');
  return `<section aria-labelledby="integrations-heading"><h2 id="integrations-heading">Google integrations</h2><table><caption>Exact property mapping and connection freshness</caption><thead><tr><th>Source</th><th>Property</th><th>Status</th><th>Last sync</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Not connected</td></tr>'}</tbody></table></section>`;
}

function formatUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)} USD`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}
