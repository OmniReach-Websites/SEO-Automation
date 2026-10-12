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
          ? `<form class="operation-form" method="post" action="/orap/operations/jobs/${escapeHtml(job.id)}/cancel"><div class="field"><label>Reason<input name="reason" required minlength="3" maxlength="500"></label></div><button class="danger" type="submit">Cancel job</button></form>`
          : ['cancelled', 'failed', 'skipped'].includes(job.state)
            ? `<form class="operation-form" method="post" action="/orap/operations/jobs/${escapeHtml(job.id)}/replay"><div class="field"><label>Reason<input name="reason" required minlength="3" maxlength="500"></label></div><button type="submit">Replay job</button></form>`
            : '';
      return `<tr><th scope="row">${escapeHtml(job.category)}</th><td>${escapeHtml(job.state)}</td><td>${escapeHtml(job.updatedAt)}</td><td>${escapeHtml(job.traceId)}</td><td>${action}</td></tr>`;
    })
    .join('');
  const alerts = input.alerts
    .map((alert) => {
      const actions =
        alert.id && alert.state !== 'resolved'
          ? `<div class="actions"><form class="operation-form" method="post" action="/orap/operations/alerts/${escapeHtml(alert.id)}/acknowledge"><div class="field"><label>Reason<input name="reason" required minlength="3" maxlength="500"></label></div><button class="secondary" type="submit">Acknowledge</button></form><form class="operation-form" method="post" action="/orap/operations/alerts/${escapeHtml(alert.id)}/resolve"><div class="field"><label>Resolution<input name="reason" required minlength="3" maxlength="500"></label></div><button type="submit">Resolve</button></form></div>`
          : '';
      return `<li class="alert-card"><span class="badge${alert.severity === 'critical' ? ' disabled' : ''}">${escapeHtml(alert.severity)}</span><p><strong>${escapeHtml(alert.message)}</strong> · ${alert.occurrences} occurrence${alert.occurrences === 1 ? '' : 's'} · ${escapeHtml(alert.state)}</p>${actions}</li>`;
    })
    .join('');
  return `<dl class="stats"><div class="stat"><dt>Monthly AI cap</dt><dd>${formatUsd(input.budget.capUsdMicros)}</dd></div><div class="stat"><dt>Used</dt><dd>${formatUsd(input.budget.usedUsdMicros)}</dd></div><div class="stat"><dt>Reserved</dt><dd>${formatUsd(input.budget.reservedUsdMicros)}</dd></div></dl><section class="panel flush" aria-labelledby="jobs-heading"><div class="panel-header"><div><h2 id="jobs-heading">Jobs</h2><p class="help">Tenant-scoped work · UTC period ${escapeHtml(input.budget.periodStart)}</p></div></div><table><caption>Tenant-scoped job activity</caption><thead><tr><th>Type</th><th>State</th><th>Updated</th><th>Trace</th><th>Action</th></tr></thead><tbody>${jobs || '<tr><td colspan="5"><div class="empty"><strong>No jobs</strong>Queued and recent automation work will appear here.</div></td></tr>'}</tbody></table></section><section class="panel" aria-labelledby="alerts-heading"><h2 id="alerts-heading">Alerts</h2><ul class="alert-list">${alerts || '<li class="empty"><strong>No open alerts</strong>The platform has no active operational incidents.</li>'}</ul></section>`;
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
