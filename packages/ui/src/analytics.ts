import { renderOrapShell, type OrapNavigationItem, type OrapSiteSummary } from './admin.ts';

export type AnalyticsAvailability =
  'available' | 'no_data' | 'not_connected' | 'partial' | 'stale' | 'unsupported';

export interface OrapAnalyticsModel {
  dataQuality: {
    connections: readonly {
      availableEndDate: string | null;
      availableStartDate: string | null;
      lastAttemptedAt?: string | null;
      lastErrorCode: string | null;
      lastSyncedAt: string | null;
      propertyId: string;
      propertyKind: 'ga4' | 'search_console';
      propertyMapping: string;
      status: string;
      syncWindow?: {
        complete: boolean;
        diagnostics: readonly {
          complete: boolean;
          dataset:
            | 'ga4_source_medium'
            | 'search_console_page'
            | 'search_console_property'
            | 'search_console_query';
          pageCount: number;
          rows: number;
          totalRows: number | null;
        }[];
        endDate: string;
        startDate: string;
      } | null;
    }[];
    generatedAt: string;
    notes: readonly string[];
    state: AnalyticsAvailability;
  };
  kpis: readonly {
    current: number | null;
    definition: string;
    deltaPercent: number | null;
    key: string;
    label: string;
    limitation?: string;
    previous: number | null;
    source: 'ga4' | 'search_console';
    state: AnalyticsAvailability;
    unit: 'count' | 'percent' | 'position';
  }[];
  opportunities: readonly {
    evidence: string;
    kind: 'click_through' | 'near_page_one' | 'visibility';
    label: string;
    limitation: string;
    score: number;
  }[];
  range: {
    days: number;
    endDate: string;
    label: string;
    previousEndDate: string;
    previousStartDate: string;
    preset: '7' | '28' | '90' | 'custom';
    startDate: string;
  };
  series: readonly {
    activeUsers: number | null;
    clicks: number | null;
    ctr: number | null;
    date: string;
    impressions: number | null;
    pageViews: number | null;
    position: number | null;
    sessions: number | null;
    totalSessions: number | null;
  }[];
  site: { id: string; name: string; tenantId: string; tenantName: string };
  technical: {
    crawlCompletedAt: string | null;
    crawlState: string | null;
    failingPages: number | null;
    findings: Readonly<Record<'critical' | 'high' | 'info' | 'low' | 'medium', number>>;
    openFindings: number;
    pagesCrawled: number | null;
    resolvedFindings: number;
    topFindings: readonly {
      affectedPage: string | null;
      limitation: string;
      remediation: string;
      ruleId: string;
      severity: string;
      state: string;
    }[];
  };
  timeline: readonly {
    category: string;
    occurredAt: string;
    state: string;
    summary: string;
  }[];
  topPages: readonly AnalyticsTableRow[];
  topQueries: readonly AnalyticsTableRow[];
}

export interface AnalyticsTableRow {
  clicks: number;
  ctr: number | null;
  impressions: number;
  label: string;
  position: number | null;
  previousClicks: number | null;
  previousImpressions: number | null;
  trafficDeltaPercent: number | null;
}

export interface OrapAnalyticsSelection {
  limit: number;
  pageSort: 'clicks' | 'ctr' | 'impressions' | 'position';
  querySort: 'clicks' | 'ctr' | 'impressions' | 'position';
}

export const analyticsStylesheet = String.raw`
.analytics-filters{display:grid;grid-template-columns:minmax(12rem,2fr) minmax(9rem,1fr) repeat(2,minmax(9rem,1fr)) auto;gap:.8rem;align-items:end}.analytics-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.8rem;margin:0 0 1.25rem}.analytics-kpi{min-width:0;background:var(--panel);border:1px solid rgba(134,187,216,.2);border-radius:.8rem;padding:1rem;box-shadow:var(--shadow)}.analytics-kpi header{display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem}.analytics-kpi h2{font-size:.78rem;letter-spacing:.07em;text-transform:uppercase;color:var(--brand);margin:0}.analytics-kpi .metric{margin:.45rem 0 .2rem;font-size:clamp(1.55rem,3vw,2.15rem);font-weight:820;letter-spacing:-.045em;color:var(--ink)}.analytics-kpi .comparison{margin:0;color:var(--muted);font-size:.78rem}.analytics-kpi details{margin-top:.7rem;color:var(--muted);font-size:.76rem}.analytics-kpi summary{cursor:pointer;color:var(--brand)}.state-pill{display:inline-flex;align-items:center;border:1px solid rgba(134,187,216,.25);border-radius:999px;padding:.18rem .46rem;font-size:.62rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--brand);background:rgba(134,187,216,.08)}.state-pill.available{color:var(--accent);border-color:rgba(158,228,147,.28);background:rgba(158,228,147,.08)}.state-pill.stale,.state-pill.partial{color:#ffd28a;border-color:rgba(255,210,138,.3);background:rgba(255,210,138,.08)}.state-pill.unsupported,.state-pill.not_connected,.state-pill.no_data{color:var(--muted)}.analytics-chart-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.chart{min-width:0}.chart h3{margin-bottom:.2rem}.chart svg{display:block;width:100%;height:auto;min-height:12rem;border:1px solid rgba(134,187,216,.14);border-radius:.65rem;background:#0d2029}.chart-gridline{stroke:rgba(134,187,216,.13);stroke-width:1}.chart-line{fill:none;stroke:var(--accent);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.chart-area{fill:rgba(158,228,147,.08)}.chart-dot{fill:var(--accent)}.chart-empty{display:grid;place-items:center;min-height:12rem;border:1px dashed rgba(134,187,216,.28);border-radius:.65rem;color:var(--muted)}.analytics-table-wrap{overflow:auto}.analytics-table th[aria-sort] a{color:inherit;text-decoration:none}.analytics-table th[aria-sort] a:hover{text-decoration:underline}.analytics-table td:first-child,.analytics-table th:first-child{white-space:normal;min-width:14rem}.opportunity-list,.quality-list,.timeline{list-style:none;padding:0;margin:0;display:grid;gap:.75rem}.opportunity,.timeline li{padding:.9rem;border:1px solid rgba(134,187,216,.18);border-radius:.65rem;background:#10242d}.opportunity p,.timeline p{margin:.3rem 0 0}.opportunity .help{margin-top:.45rem}.technical-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin-bottom:1rem}.technical-stat{border:1px solid rgba(134,187,216,.18);border-radius:.65rem;padding:.8rem}.technical-stat strong{display:block;font-size:1.4rem}.connection-card{display:grid;gap:.45rem}.connection-card code{display:block}.severity-grid{display:flex;flex-wrap:wrap;gap:.5rem}.severity-grid .badge{gap:.3rem}.analytics-meta{display:flex;gap:.65rem;align-items:center;flex-wrap:wrap}.analytics-meta p{margin:0}.correlation-note{border-left:3px solid var(--brand);padding-left:.8rem}.visually-hidden{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}@media(max-width:1050px){.analytics-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.analytics-filters button{align-self:stretch}.analytics-kpis,.technical-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.analytics-filters,.analytics-kpis,.analytics-chart-grid,.technical-stats{grid-template-columns:1fr}.analytics-table td,.analytics-table th{white-space:nowrap}.analytics-table td:first-child,.analytics-table th:first-child{position:sticky;left:0;background:var(--panel);z-index:1}.analytics-kpi .metric{font-size:1.7rem}}
`;

export function renderOrapAnalyticsDashboard(
  model: OrapAnalyticsModel,
  sites: readonly OrapSiteSummary[],
  selection: OrapAnalyticsSelection,
  navigation?: readonly OrapNavigationItem[],
): string {
  const siteOptions = sites
    .map(
      (site) =>
        `<option value="${escapeHtml(site.id ?? '')}"${site.id === model.site.id ? ' selected' : ''}>${escapeHtml(site.name)} — ${escapeHtml(site.tenantName)}</option>`,
    )
    .join('');
  const presetOptions = (['7', '28', '90', 'custom'] as const)
    .map((preset) => {
      const label = preset === 'custom' ? 'Custom dates' : `Last ${preset} days`;
      return `<option value="${preset}"${model.range.preset === preset ? ' selected' : ''}>${label}</option>`;
    })
    .join('');
  const filters = `<section class="panel" aria-labelledby="analytics-filters-heading"><h2 id="analytics-filters-heading">Report scope</h2><form class="analytics-filters" method="get" action="/orap/analytics"><div class="field"><label for="siteId">Customer website</label><select id="siteId" name="siteId" required>${siteOptions}</select></div><div class="field"><label for="range">Date range</label><select id="range" name="range">${presetOptions}</select></div><div class="field"><label for="startDate">Custom start</label><input id="startDate" name="startDate" type="date" value="${escapeHtml(model.range.startDate)}"></div><div class="field"><label for="endDate">Custom end</label><input id="endDate" name="endDate" type="date" value="${escapeHtml(model.range.endDate)}"></div><button type="submit">Update report</button></form><p class="help">Custom dates are used only when “Custom dates” is selected and are limited to 90 days. Standard ranges end yesterday because Google data can arrive late.</p></section>`;
  const kpis = model.kpis.map(renderKpi).join('');
  const charts = `<section class="panel" aria-labelledby="performance-trends"><div class="panel-header"><div><h2 id="performance-trends">Performance trends</h2><p class="help">Daily persisted measurements for ${escapeHtml(model.range.label)}. Each chart has its own labeled scale; missing observations are gaps, not zero.</p></div></div><div class="analytics-chart-grid">${renderChart(model.series, 'clicks', 'Search clicks', 'count')}${renderChart(model.series, 'impressions', 'Search impressions', 'count')}${renderChart(model.series, 'ctr', 'Search CTR', 'percent')}${renderChart(model.series, 'position', 'Average search position', 'position', true)}${renderChart(model.series, 'sessions', 'Organic sessions', 'count')}${renderChart(model.series, 'pageViews', 'Organic page views', 'count')}</div><p class="help">Average-position charts place lower position numbers toward the top because lower is better. Engagement rate is not collected and remains explicitly unsupported.</p>${renderSeriesTable(model)}</section>`;
  const tables = `<div class="section-grid">${renderSearchTable('Top search queries', 'query', model.topQueries, model, selection)}${renderSearchTable('Top landing pages', 'page', model.topPages, model, selection)}</div>`;
  const opportunities = `<section class="panel" aria-labelledby="visibility-opportunities"><div class="panel-header"><div><h2 id="visibility-opportunities">Visibility opportunities</h2><p class="help">Deterministic rules applied to stored Search Console evidence. These are review prompts, not ranking promises.</p></div></div><ul class="opportunity-list">${model.opportunities.map((item) => `<li class="opportunity"><div class="analytics-meta"><span class="badge neutral">${escapeHtml(opportunityLabel(item.kind))}</span><strong>${escapeHtml(item.label)}</strong></div><p>${escapeHtml(item.evidence)}</p><p class="help">${escapeHtml(item.limitation)}</p></li>`).join('') || '<li class="empty"><strong>No rule-based opportunities</strong>No qualifying query evidence is available in this period.</li>'}</ul></section>`;
  const technical = renderTechnical(model);
  const timeline = `<section class="panel" aria-labelledby="work-timeline"><div class="panel-header"><div><h2 id="work-timeline">Work performed</h2><p class="help correlation-note">Operational events are displayed beside measured outcomes for context. Timing alone does not prove that an action caused a metric change.</p></div></div><ol class="timeline">${model.timeline.map((event) => `<li><div class="analytics-meta"><time datetime="${escapeHtml(event.occurredAt)}">${escapeHtml(formatDateTime(event.occurredAt))}</time><span class="badge${event.state === 'failed' ? ' disabled' : ' neutral'}">${escapeHtml(event.state)}</span></div><p><strong>${escapeHtml(event.summary)}</strong></p></li>`).join('') || '<li class="empty"><strong>No recorded work in this period</strong>Completed jobs and publications will appear here.</li>'}</ol></section>`;
  const quality = renderDataQuality(model);

  return renderOrapShell({
    actions: `<a class="button secondary" href="/orap/sites/${encodeURIComponent(model.site.id)}">Open site</a>`,
    content: `<p class="page-subtitle">Search, traffic, technical health, and completed work for <strong>${escapeHtml(model.site.name)}</strong>. Every reported value comes from persisted platform evidence.</p>${filters}<div class="analytics-kpis">${kpis}</div>${charts}${tables}${opportunities}${technical}${timeline}${quality}`,
    current: 'analytics',
    eyebrow: model.site.tenantName,
    heading: 'Analytics & SEO performance',
    ...(navigation ? { navigation } : {}),
    title: `Analytics — ${model.site.name}`,
  });
}

export function renderOrapAnalyticsEmpty(
  sites: readonly OrapSiteSummary[],
  navigation?: readonly OrapNavigationItem[],
  error?: string,
): string {
  const options = sites
    .map(
      (site) =>
        `<option value="${escapeHtml(site.id ?? '')}">${escapeHtml(site.name)} — ${escapeHtml(site.tenantName)}</option>`,
    )
    .join('');
  return renderOrapShell({
    content: sites.length
      ? `<section class="panel"><h2>Select a website</h2><p class="help">Only websites in your Analytics authorization scope are listed.</p><form method="get" action="/orap/analytics"><div class="field"><label for="siteId">Customer website</label><select id="siteId" name="siteId" required>${options}</select></div><input type="hidden" name="range" value="28"><button type="submit">Open analytics</button></form></section>`
      : '<section class="panel"><div class="empty"><strong>No authorized websites</strong>Your account does not currently have Analytics access to an active website.</div></section>',
    current: 'analytics',
    eyebrow: 'Portfolio reporting',
    heading: 'Analytics & SEO performance',
    ...(navigation ? { navigation } : {}),
    ...(error ? { notice: { kind: 'error', message: error } } : {}),
    title: 'Analytics & SEO performance',
  });
}

function renderKpi(kpi: OrapAnalyticsModel['kpis'][number]): string {
  const comparison =
    kpi.deltaPercent === null
      ? 'No comparable prior-period percentage'
      : `${formatSignedPercent(kpi.deltaPercent)} vs prior period`;
  return `<article class="analytics-kpi"><header><h2>${escapeHtml(kpi.label)}</h2><span class="state-pill ${escapeHtml(kpi.state)}">${escapeHtml(stateLabel(kpi.state))}</span></header><p class="metric">${escapeHtml(formatMetric(kpi.current, kpi.unit, kpi.state))}</p><p class="comparison">${escapeHtml(comparison)}</p><details><summary>Definition &amp; limits</summary><p>${escapeHtml(kpi.definition)}</p>${kpi.limitation ? `<p>${escapeHtml(kpi.limitation)}</p>` : ''}</details></article>`;
}

function renderChart(
  points: OrapAnalyticsModel['series'],
  key: 'clicks' | 'ctr' | 'impressions' | 'pageViews' | 'position' | 'sessions',
  label: string,
  unit: 'count' | 'percent' | 'position',
  lowerIsBetter = false,
): string {
  const values = points.map((point) => point[key]);
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) {
    return `<section class="chart"><h3>${escapeHtml(label)}</h3><div class="chart-empty">No measured data</div></section>`;
  }
  const width = 640;
  const height = 220;
  const padding = 24;
  const maximum = Math.max(...present, unit === 'percent' ? 0.01 : 1);
  const minimum = Math.min(...present, 0);
  const span = Math.max(maximum - minimum, unit === 'percent' ? 0.01 : 1);
  const coordinates = points.map((point, index) => {
    const value = point[key];
    if (value === null) return null;
    const x = padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
    const ratio = (value - minimum) / span;
    const y = lowerIsBetter
      ? padding + ratio * (height - padding * 2)
      : height - padding - ratio * (height - padding * 2);
    return { date: point.date, value, x, y };
  });
  const segments: string[] = [];
  let current: string[] = [];
  for (const coordinate of coordinates) {
    if (coordinate) current.push(`${coordinate.x.toFixed(1)},${coordinate.y.toFixed(1)}`);
    if (!coordinate && current.length > 0) {
      segments.push(current.join(' '));
      current = [];
    }
  }
  if (current.length > 0) segments.push(current.join(' '));
  const lines = segments
    .map((segment) => `<polyline class="chart-line" points="${segment}"></polyline>`)
    .join('');
  const dots = coordinates
    .filter((coordinate): coordinate is NonNullable<typeof coordinate> => coordinate !== null)
    .map(
      (coordinate) =>
        `<circle class="chart-dot" cx="${coordinate.x.toFixed(1)}" cy="${coordinate.y.toFixed(1)}" r="3"><title>${escapeHtml(coordinate.date)}: ${escapeHtml(formatMetricValue(coordinate.value, unit))}</title></circle>`,
    )
    .join('');
  return `<section class="chart"><h3>${escapeHtml(label)}</h3><p class="help">Independent ${unit === 'percent' ? 'percentage' : unit === 'position' ? 'position' : 'count'} scale${lowerIsBetter ? '; lower is better' : ''}.</p><svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${key}-chart-title ${key}-chart-description"><title id="${key}-chart-title">${escapeHtml(label)} time series</title><desc id="${key}-chart-description">Daily ${escapeHtml(label.toLowerCase())} from ${escapeHtml(points[0]?.date ?? '')} through ${escapeHtml(points.at(-1)?.date ?? '')}. Exact values follow in the data table.</desc><line class="chart-gridline" x1="${padding}" y1="${padding}" x2="${width - padding}" y2="${padding}"></line><line class="chart-gridline" x1="${padding}" y1="${height / 2}" x2="${width - padding}" y2="${height / 2}"></line><line class="chart-gridline" x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}"></line>${lines}${dots}</svg></section>`;
}

function renderSeriesTable(model: OrapAnalyticsModel): string {
  const rows = model.series
    .map(
      (point) =>
        `<tr><th scope="row">${escapeHtml(point.date)}</th><td>${metricCell(point.clicks)}</td><td>${metricCell(point.impressions)}</td><td>${point.ctr === null ? '—' : formatPercent(point.ctr)}</td><td>${point.position === null ? '—' : point.position.toFixed(1)}</td><td>${metricCell(point.sessions)}</td><td>${metricCell(point.activeUsers)}</td><td>${metricCell(point.pageViews)}</td><td>${metricCell(point.totalSessions)}</td></tr>`,
    )
    .join('');
  return `<details><summary>View daily data table</summary><div class="analytics-table-wrap" role="region" aria-label="Daily analytics measurements" tabindex="0"><table class="analytics-table"><caption>Daily persisted Search Console and GA4 measurements</caption><thead><tr><th>Date</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th><th>Organic sessions</th><th>Active-user observations</th><th>Organic page views</th><th>All-channel sessions</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function renderSearchTable(
  title: string,
  kind: 'page' | 'query',
  rows: readonly AnalyticsTableRow[],
  model: OrapAnalyticsModel,
  selection: OrapAnalyticsSelection,
): string {
  const sort = kind === 'query' ? selection.querySort : selection.pageSort;
  const body = rows
    .map(
      (row) =>
        `<tr><th scope="row">${escapeHtml(row.label)}</th><td>${formatCount(row.clicks)}</td><td>${row.previousClicks === null ? '—' : formatCount(row.previousClicks)}</td><td>${row.trafficDeltaPercent === null ? '—' : formatSignedPercent(row.trafficDeltaPercent)}</td><td>${formatCount(row.impressions)}</td><td>${row.ctr === null ? 'Unavailable' : formatPercent(row.ctr)}</td><td>${row.position === null ? 'Unavailable' : row.position.toFixed(1)}</td></tr>`,
    )
    .join('');
  const sortableHeader = (key: OrapAnalyticsSelection['querySort'], label: string): string => {
    const href = analyticsHref(model, selection, {
      ...(kind === 'query' ? { querySort: key } : { pageSort: key }),
    });
    return `<th aria-sort="${sort === key ? (key === 'position' ? 'ascending' : 'descending') : 'none'}"><a href="${href}">${label}</a></th>`;
  };
  return `<section class="panel flush"><div class="panel-header"><div><h2>${escapeHtml(title)}</h2><p class="help">Bounded to ${selection.limit} rows. Previous clicks and click delta compare the immediately preceding equal-length period. Select a current-period column heading to sort.</p></div></div><div class="analytics-table-wrap" role="region" aria-label="${escapeHtml(title)}" tabindex="0"><table class="analytics-table"><caption>${escapeHtml(title)} from persisted Search Console data</caption><thead><tr><th>${kind === 'query' ? 'Query' : 'Landing page'}</th>${sortableHeader('clicks', 'Current clicks')}<th>Previous clicks</th><th>Clicks delta</th>${sortableHeader('impressions', 'Impressions')}${sortableHeader('ctr', 'CTR')}${sortableHeader('position', 'Position')}</tr></thead><tbody>${body || '<tr><td colspan="7"><div class="empty"><strong>No measured rows</strong>Search Console has no available rows for this period.</div></td></tr>'}</tbody></table></div></section>`;
}

function renderTechnical(model: OrapAnalyticsModel): string {
  const technical = model.technical;
  const findings = technical.topFindings
    .map(
      (finding) =>
        `<tr><th scope="row">${escapeHtml(finding.ruleId)}</th><td>${escapeHtml(finding.affectedPage ?? 'Not recorded')}</td><td><span class="badge${['critical', 'high'].includes(finding.severity) ? ' disabled' : ' neutral'}">${escapeHtml(finding.severity)}</span></td><td>${escapeHtml(finding.state)}</td><td>${escapeHtml(finding.remediation)}</td><td>${escapeHtml(finding.limitation)}</td></tr>`,
    )
    .join('');
  return `<section class="panel" aria-labelledby="technical-health"><div class="panel-header"><div><h2 id="technical-health">Technical SEO health</h2><p class="help">Latest persisted crawl and current finding lifecycle. No crawl is run when this page loads.</p></div></div><div class="technical-stats"><div class="technical-stat"><strong>${technical.pagesCrawled ?? '—'}</strong><span>Pages in latest crawl</span></div><div class="technical-stat"><strong>${technical.failingPages ?? '—'}</strong><span>Non-success pages</span></div><div class="technical-stat"><strong>${technical.openFindings}</strong><span>Open or acknowledged</span></div><div class="technical-stat"><strong>${technical.resolvedFindings}</strong><span>Resolved in selected period</span></div></div><div class="severity-grid" aria-label="Findings by severity">${(['critical', 'high', 'medium', 'low', 'info'] as const).map((severity) => `<span class="badge${['critical', 'high'].includes(severity) ? ' disabled' : ' neutral'}">${escapeHtml(severity)} <strong>${technical.findings[severity]}</strong></span>`).join('')}</div><p class="help">Latest crawl: ${escapeHtml(technical.crawlCompletedAt ? `${technical.crawlState ?? 'unknown'} — ${formatDateTime(technical.crawlCompletedAt)}` : 'No completed crawl evidence')}</p><div class="analytics-table-wrap" role="region" aria-label="Actionable SEO findings" tabindex="0"><table class="analytics-table"><caption>Highest-severity current SEO findings</caption><thead><tr><th>Rule</th><th>Affected page</th><th>Severity</th><th>State</th><th>Remediation</th><th>Limitation</th></tr></thead><tbody>${findings || '<tr><td colspan="6"><div class="empty"><strong>No current findings</strong>No open or acknowledged findings are stored for this site.</div></td></tr>'}</tbody></table></div></section>`;
}

function renderDataQuality(model: OrapAnalyticsModel): string {
  const connections = model.dataQuality.connections
    .map((connection) => {
      const source = connection.propertyKind === 'ga4' ? 'GA4' : 'Search Console';
      const period =
        connection.availableStartDate && connection.availableEndDate
          ? `${connection.availableStartDate} through ${connection.availableEndDate}`
          : 'No persisted observations';
      const reportingCalendar =
        connection.propertyKind === 'ga4'
          ? 'Connected GA4 property time zone'
          : 'Pacific Time (Search Console API)';
      const failure = connection.lastErrorCode
        ? `<p class="notice error"><strong>Collection issue:</strong> ${escapeHtml(providerFailureMessage(connection.lastErrorCode))} <code>${escapeHtml(connection.lastErrorCode)}</code></p>`
        : '';
      const syncWindow = connection.syncWindow
        ? `<details><summary>Last collection window: ${escapeHtml(connection.syncWindow.startDate)} through ${escapeHtml(connection.syncWindow.endDate)} — ${connection.syncWindow.complete ? 'complete' : 'partial'}</summary><ul class="quality-list">${connection.syncWindow.diagnostics.map((diagnostic) => `<li><strong>${escapeHtml(collectionDatasetLabel(diagnostic.dataset))}:</strong> ${formatCount(diagnostic.rows)} rows across ${formatCount(diagnostic.pageCount)} page${diagnostic.pageCount === 1 ? '' : 's'}${diagnostic.totalRows === null ? '' : ` of ${formatCount(diagnostic.totalRows)}`} — ${diagnostic.complete ? 'complete' : 'bounded partial result'}</li>`).join('')}</ul></details>`
        : '<p class="help">Detailed collection-window diagnostics will appear after the next versioned sync.</p>';
      return `<article class="technical-stat connection-card"><div class="analytics-meta"><strong>${source}</strong><span class="badge${connection.status === 'connected' ? '' : ' disabled'}">${escapeHtml(connection.status)}</span></div><div><span class="help">Exact property ID</span><code>${escapeHtml(connection.propertyId)}</code></div><div><span class="help">Verified mapping</span><code>${escapeHtml(connection.propertyMapping)}</code></div><p class="help">Available stored period: ${escapeHtml(period)}</p><p class="help">Reporting calendar: ${escapeHtml(reportingCalendar)}</p><p class="help">Last collection attempt: ${escapeHtml(connection.lastAttemptedAt ? formatDateTime(connection.lastAttemptedAt) : 'Never')}</p><p class="help">Last stored collection: ${escapeHtml(connection.lastSyncedAt ? formatDateTime(connection.lastSyncedAt) : 'Never')}</p>${syncWindow}${failure}</article>`;
    })
    .join('');
  return `<section class="panel" aria-labelledby="data-quality"><div class="panel-header"><div><h2 id="data-quality">Connections &amp; data quality</h2><p class="help">Generated ${escapeHtml(formatDateTime(model.dataQuality.generatedAt))}</p></div><span class="state-pill ${escapeHtml(model.dataQuality.state)}">${escapeHtml(stateLabel(model.dataQuality.state))}</span></div><div class="section-grid"><div>${connections || '<div class="empty"><strong>No Google connection</strong>Connect a verified site property before expecting provider measurements.</div>'}</div><ul class="quality-list">${model.dataQuality.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul></div></section>`;
}

function analyticsHref(
  model: OrapAnalyticsModel,
  selection: OrapAnalyticsSelection,
  overrides: Partial<Pick<OrapAnalyticsSelection, 'pageSort' | 'querySort'>>,
): string {
  const query = new URLSearchParams({
    endDate: model.range.endDate,
    limit: String(selection.limit),
    pageSort: overrides.pageSort ?? selection.pageSort,
    querySort: overrides.querySort ?? selection.querySort,
    range: model.range.preset,
    siteId: model.site.id,
    startDate: model.range.startDate,
  });
  return `/orap/analytics?${escapeHtml(query.toString())}`;
}

function opportunityLabel(kind: OrapAnalyticsModel['opportunities'][number]['kind']): string {
  if (kind === 'click_through') return 'CTR review';
  if (kind === 'near_page_one') return 'Near page one';
  return 'Visibility review';
}

function stateLabel(state: AnalyticsAvailability): string {
  return state.replaceAll('_', ' ');
}

function formatMetric(
  value: number | null,
  unit: 'count' | 'percent' | 'position',
  state: AnalyticsAvailability,
): string {
  if (state === 'unsupported') return 'Unsupported';
  if (state === 'not_connected') return 'Not connected';
  if (value === null) return 'No data';
  if (unit === 'percent') return formatPercent(value);
  if (unit === 'position') return value.toFixed(1);
  return formatCount(value);
}

function formatMetricValue(value: number, unit: 'count' | 'percent' | 'position'): string {
  if (unit === 'percent') return formatPercent(value);
  if (unit === 'position') return value.toFixed(1);
  return formatCount(value);
}

function metricCell(value: number | null): string {
  return value === null ? '—' : formatCount(value);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    style: 'percent',
  }).format(value);
}

function formatSignedPercent(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    signDisplay: 'always',
    style: 'percent',
  }).format(value / 100);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
}

function providerFailureMessage(code: string): string {
  const messages: Record<string, string> = {
    collection_failed:
      'Collection failed. Review the worker event and retry after the provider recovers.',
    collection_truncated:
      'Google returned more rows than the bounded collection budget. Totals remain separately collected, but query or page detail may be partial.',
    insufficient_scope:
      'Reconnect this property with the approved read-only permission because Google denied the required scope.',
    insufficient_scope_or_quota:
      'Google denied the request. Verify the approved read-only permission and provider quota before reconnecting.',
    missing_refresh_token: 'Reconnect this property because no renewable permission is available.',
    property_not_found:
      'The mapped property is unavailable to this connection. Verify the exact property and reconnect it.',
    provider_rejected:
      'Google rejected the collection request. Verify the exact property mapping and approved API access.',
    provider_unavailable:
      'Google is temporarily unavailable. The bounded worker retry policy will try again.',
    quota_exhausted: 'Google throttled collection. The bounded worker retry policy will try again.',
    revoked_or_expired:
      'Reconnect this property because Google authorization expired or was revoked.',
  };
  if (code === 'rate_limited' || code === 'http_429') {
    return 'Google throttled collection. The bounded worker retry policy will try again.';
  }
  return messages[code] ?? 'Collection needs review in the integration and worker diagnostics.';
}

function collectionDatasetLabel(
  dataset:
    | 'ga4_source_medium'
    | 'search_console_page'
    | 'search_console_property'
    | 'search_console_query',
): string {
  const labels = {
    ga4_source_medium: 'GA4 source/medium detail',
    search_console_page: 'Search Console landing pages',
    search_console_property: 'Search Console property totals',
    search_console_query: 'Search Console queries',
  } as const;
  return labels[dataset];
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}
