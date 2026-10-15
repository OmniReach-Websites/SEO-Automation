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
export interface BackupStatusView {
  readonly byteSize: number;
  readonly createdAt: string;
  readonly errorCode?: string;
  readonly id: string;
  readonly kind: string;
  readonly lastRestoreTestedAt?: string;
  readonly offServerCopiedAt?: string;
  readonly state: 'failed' | 'healthy' | 'local_only' | 'stale';
  readonly verifiedAt?: string;
}
export interface EmailOperationsView {
  readonly channels: readonly {
    readonly enabled: boolean;
    readonly kind: string;
    readonly sender: string;
  }[];
  readonly credentialConfigured: boolean;
  readonly dailyLimit: number;
  readonly dailyReservedCount: number;
  readonly dailyUsedCount: number;
  readonly dayStart: string;
  readonly failedAttemptCount: number;
  readonly lastAttemptAt?: string;
  readonly lastErrorCode?: string;
  readonly monthlyLimit: number;
  readonly periodStart: string;
  readonly provider: string;
  readonly providerObservedAt?: string;
  readonly reservedCount: number;
  readonly sentCount: number;
  readonly turnstileConfigured: boolean;
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
  readonly backup?: BackupStatusView | null;
  readonly budget: BudgetView | null;
  readonly canAcknowledgeAlerts?: boolean;
  readonly canCancelJobs?: boolean;
  readonly canReplayJobs?: boolean;
  readonly canResolveAlerts?: boolean;
  readonly email?: EmailOperationsView;
  readonly jobs: readonly JobRow[];
}): string {
  const jobs = input.jobs
    .map((job) => {
      const action =
        job.state === 'queued' && input.canCancelJobs !== false
          ? `<form class="operation-form" method="post" action="/orap/operations/jobs/${escapeHtml(job.id)}/cancel"><div class="field"><label>Reason<input name="reason" required minlength="3" maxlength="500"></label></div><button class="danger" type="submit">Cancel job</button></form>`
          : ['cancelled', 'failed', 'skipped'].includes(job.state) && input.canReplayJobs !== false
            ? `<form class="operation-form" method="post" action="/orap/operations/jobs/${escapeHtml(job.id)}/replay"><div class="field"><label>Reason<input name="reason" required minlength="3" maxlength="500"></label></div><button type="submit">Replay job</button></form>`
            : '';
      return `<tr><th scope="row">${escapeHtml(job.category)}</th><td>${escapeHtml(job.state)}</td><td>${escapeHtml(job.updatedAt)}</td><td>${escapeHtml(job.traceId)}</td><td>${action}</td></tr>`;
    })
    .join('');
  const alerts = input.alerts
    .map((alert) => {
      const acknowledge =
        alert.id && alert.state !== 'resolved' && input.canAcknowledgeAlerts !== false
          ? `<form class="operation-form" method="post" action="/orap/operations/alerts/${escapeHtml(alert.id)}/acknowledge"><div class="field"><label>Reason<input name="reason" required minlength="3" maxlength="500"></label></div><button class="secondary" type="submit">Acknowledge</button></form>`
          : '';
      const resolve =
        alert.id && alert.state !== 'resolved' && input.canResolveAlerts !== false
          ? `<form class="operation-form" method="post" action="/orap/operations/alerts/${escapeHtml(alert.id)}/resolve"><div class="field"><label>Resolution<input name="reason" required minlength="3" maxlength="500"></label></div><button type="submit">Resolve</button></form>`
          : '';
      const actions =
        acknowledge || resolve ? `<div class="actions">${acknowledge}${resolve}</div>` : '';
      return `<li class="alert-card"><span class="badge${alert.severity === 'critical' ? ' disabled' : ''}">${escapeHtml(alert.severity)}</span><p><strong>${escapeHtml(alert.message)}</strong> · ${alert.occurrences} occurrence${alert.occurrences === 1 ? '' : 's'} · ${escapeHtml(alert.state)}</p>${actions}</li>`;
    })
    .join('');
  const budget = input.budget
    ? `<dl class="stats"><div class="stat"><dt>Monthly AI cap</dt><dd>${formatUsd(input.budget.capUsdMicros)}</dd><small>UTC monthly limit</small></div><div class="stat"><dt>Used</dt><dd>${formatUsd(input.budget.usedUsdMicros)}</dd><small>Committed spend</small></div><div class="stat"><dt>Reserved</dt><dd>${formatUsd(input.budget.reservedUsdMicros)}</dd><small>Queued work</small></div><div class="stat"><dt>Available</dt><dd>${formatUsd(Math.max(0, input.budget.capUsdMicros - input.budget.usedUsdMicros - input.budget.reservedUsdMicros))}</dd><small>Remaining budget</small></div></dl>`
    : '<div class="surface-note">Platform AI budget details are hidden because this account does not have financial visibility.</div>';
  const period = input.budget ? ` · UTC period ${escapeHtml(input.budget.periodStart)}` : '';
  const backup = renderBackupStatus(input.backup);
  const email = renderEmailOperations(input.email);
  return `${budget}<p class="page-subtitle">Review authorized automation work and respond to operational incidents.</p>${backup}${email}<section class="panel flush" aria-labelledby="jobs-heading"><div class="panel-header"><div><h2 id="jobs-heading">Automation jobs</h2><p class="help">Recent work in your assigned scope${period}</p></div></div><table><caption>Scoped job activity</caption><thead><tr><th>Type</th><th>State</th><th>Updated</th><th>Trace</th><th>Action</th></tr></thead><tbody>${jobs || '<tr><td colspan="5"><div class="empty"><strong>No jobs</strong>Queued and recent automation work will appear here.</div></td></tr>'}</tbody></table></section><section class="panel" aria-labelledby="alerts-heading"><h2 id="alerts-heading">Alerts</h2><ul class="alert-list">${alerts || '<li class="empty"><strong>No open alerts</strong>The platform has no active operational incidents in your scope.</li>'}</ul></section>`;
}

function renderEmailOperations(email: EmailOperationsView | undefined): string {
  if (!email) return '';
  const enabled = email.channels.filter((channel) => channel.enabled);
  const quotaExhausted =
    email.sentCount + email.reservedCount >= email.monthlyLimit ||
    email.dailyUsedCount + email.dailyReservedCount >= email.dailyLimit;
  const blocked =
    enabled.length > 0 &&
    (!email.credentialConfigured ||
      (enabled.some(({ kind }) => kind === 'Forms and inquiries') && !email.turnstileConfigured));
  const state = quotaExhausted
    ? { className: 'blocked', label: 'Monthly quota exhausted' }
    : blocked
      ? { className: 'blocked', label: 'Configuration incomplete' }
      : enabled.length > 0
        ? { className: 'ready', label: 'Delivery enabled' }
        : { className: 'blocked', label: 'Delivery disabled' };
  const channelRows = email.channels
    .map(
      (channel) =>
        `<tr><th scope="row">${escapeHtml(channel.kind)}</th><td>${channel.enabled ? 'Enabled' : 'Disabled'}</td><td>${escapeHtml(channel.sender)}</td></tr>`,
    )
    .join('');
  return `<section class="panel" aria-labelledby="email-heading"><div class="panel-header"><div><h2 id="email-heading">Email delivery</h2><p class="help">Provider health and quota evidence only. Credentials, recipients, and message contents are never shown.</p></div><span class="state-pill ${state.className}">${state.label}</span></div><dl class="stats"><div class="stat"><dt>Provider</dt><dd>${escapeHtml(email.provider)}</dd><small>${email.credentialConfigured ? 'Credential configured' : 'Credential missing'} · observed ${escapeHtml(email.providerObservedAt ?? 'Never')}</small></div><div class="stat"><dt>Account daily used</dt><dd>${email.dailyUsedCount} / ${email.dailyLimit}</dd><small>UTC day ${escapeHtml(email.dayStart)} · ${email.dailyReservedCount} reserved</small></div><div class="stat"><dt>Account monthly used</dt><dd>${email.sentCount} / ${email.monthlyLimit}</dd><small>UTC policy period ${escapeHtml(email.periodStart)} · ${email.reservedCount} reserved</small></div><div class="stat"><dt>Failed attempts</dt><dd>${email.failedAttemptCount}</dd><small>Latest attempt ${escapeHtml(email.lastAttemptAt ?? 'Never')}</small></div></dl><table><caption>Configured email channels and approved sender identities</caption><thead><tr><th>Channel</th><th>State</th><th>Sender</th></tr></thead><tbody>${channelRows}</tbody></table>${email.lastErrorCode ? `<p class="notice error"><strong>Latest safe failure code:</strong> <code>${escapeHtml(email.lastErrorCode)}</code></p>` : ''}</section>`;
}

function renderBackupStatus(backup: BackupStatusView | null | undefined): string {
  if (backup === undefined) return '';
  if (backup === null) {
    return '<section class="panel" aria-labelledby="backup-heading"><h2 id="backup-heading">Backup &amp; recovery</h2><div class="empty"><strong>No verified backup evidence</strong>No completed platform backup has been recorded yet. Production RPO and restore readiness remain unverified.</div></section>';
  }
  const stateLabel = {
    failed: 'Latest run failed',
    healthy: 'Off-site copy verified',
    local_only: 'Off-site copy missing',
    stale: 'Recovery point stale',
  }[backup.state];
  return `<section class="panel" aria-labelledby="backup-heading"><div class="panel-header"><div><h2 id="backup-heading">Backup &amp; recovery</h2><p class="help">Platform-wide evidence; encrypted contents and credentials are never shown.</p></div><span class="state-pill ${backup.state === 'healthy' ? 'ready' : 'blocked'}">${escapeHtml(stateLabel)}</span></div><dl class="stats"><div class="stat"><dt>Latest recovery point</dt><dd>${escapeHtml(backup.createdAt)}</dd><small>${escapeHtml(backup.kind)} · ${formatBytes(backup.byteSize)}</small></div><div class="stat"><dt>Integrity verified</dt><dd>${escapeHtml(backup.verifiedAt ?? 'Not verified')}</dd><small>Authenticated archive check</small></div><div class="stat"><dt>Off-site copied</dt><dd>${escapeHtml(backup.offServerCopiedAt ?? 'Not verified')}</dd><small>Separate downloaded-copy proof required</small></div><div class="stat"><dt>Last restore drill</dt><dd>${escapeHtml(backup.lastRestoreTestedAt ?? 'Never')}</dd><small>Monthly isolated restore target</small></div></dl>${backup.errorCode ? `<p class="notice error"><strong>Safe failure code:</strong> <code>${escapeHtml(backup.errorCode)}</code></p>` : ''}</section>`;
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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unavailable';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}
