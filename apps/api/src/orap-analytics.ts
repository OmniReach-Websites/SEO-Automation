export type AnalyticsAvailability =
  'available' | 'no_data' | 'not_connected' | 'partial' | 'stale' | 'unsupported';

export type AnalyticsRangePreset = '7' | '28' | '90' | 'custom';

export interface AnalyticsDateRange {
  days: number;
  endDate: string;
  label: string;
  previousEndDate: string;
  previousStartDate: string;
  preset: AnalyticsRangePreset;
  startDate: string;
}

export interface OrapAnalyticsInput {
  endDate: string;
  limit: number;
  pageSort: AnalyticsTableSort;
  previousEndDate: string;
  previousStartDate: string;
  preset: AnalyticsRangePreset;
  querySort: AnalyticsTableSort;
  siteId: string;
  startDate: string;
  tenantId: string;
}

export type AnalyticsTableSort = 'clicks' | 'impressions' | 'position' | 'ctr';

export interface OrapAnalyticsDashboard {
  dataQuality: {
    connections: readonly {
      availableEndDate: string | null;
      availableStartDate: string | null;
      lastErrorCode: string | null;
      lastSyncedAt: string | null;
      propertyId: string;
      propertyKind: 'ga4' | 'search_console';
      propertyMapping: string;
      status: string;
    }[];
    generatedAt: string;
    notes: readonly string[];
    state: AnalyticsAvailability;
  };
  kpis: readonly AnalyticsKpi[];
  opportunities: readonly AnalyticsOpportunity[];
  range: AnalyticsDateRange;
  series: readonly AnalyticsSeriesPoint[];
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
  timeline: readonly AnalyticsTimelineEvent[];
  topPages: readonly AnalyticsSearchRow[];
  topQueries: readonly AnalyticsSearchRow[];
}

export interface AnalyticsKpi {
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
}

export interface AnalyticsSeriesPoint {
  activeUsers: number | null;
  clicks: number | null;
  ctr: number | null;
  date: string;
  impressions: number | null;
  pageViews: number | null;
  position: number | null;
  sessions: number | null;
  totalSessions: number | null;
}

export interface AnalyticsSearchRow {
  clicks: number;
  ctr: number | null;
  impressions: number;
  label: string;
  position: number | null;
  previousClicks: number | null;
  previousImpressions: number | null;
  trafficDeltaPercent: number | null;
}

export interface AnalyticsOpportunity {
  evidence: string;
  kind: 'click_through' | 'near_page_one' | 'visibility';
  label: string;
  limitation: string;
  score: number;
}

export interface AnalyticsTimelineEvent {
  category: string;
  occurredAt: string;
  state: string;
  summary: string;
}

export function resolveAnalyticsDateRange(
  input: { endDate?: string; preset?: string; startDate?: string },
  now = new Date(),
): AnalyticsDateRange {
  const preset = normalizePreset(input.preset);
  const today = startOfUtcDate(now);
  const defaultEnd = addUtcDays(today, -1);
  let end = defaultEnd;
  let start: Date;

  if (preset === 'custom') {
    if (!input.startDate || !input.endDate) {
      throw new AnalyticsRangeError('Custom ranges require both startDate and endDate');
    }
    start = parseIsoDate(input.startDate);
    end = parseIsoDate(input.endDate);
    if (end.getTime() > today.getTime()) {
      throw new AnalyticsRangeError('Analytics ranges cannot end in the future');
    }
  } else {
    const days = Number(preset);
    start = addUtcDays(end, -(days - 1));
  }

  if (start.getTime() > end.getTime()) {
    throw new AnalyticsRangeError('Analytics range start must not be after its end');
  }
  const days = utcDayDifference(start, end) + 1;
  if (days < 1 || days > 90) {
    throw new AnalyticsRangeError('Analytics ranges must contain between 1 and 90 days');
  }
  const previousEnd = addUtcDays(start, -1);
  const previousStart = addUtcDays(previousEnd, -(days - 1));
  return {
    days,
    endDate: isoDate(end),
    label: preset === 'custom' ? `${isoDate(start)} to ${isoDate(end)}` : `Last ${days} days`,
    previousEndDate: isoDate(previousEnd),
    previousStartDate: isoDate(previousStart),
    preset,
    startDate: isoDate(start),
  };
}

export function analyticsDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function deriveVisibilityOpportunities(
  rows: readonly AnalyticsSearchRow[],
  limit = 8,
): AnalyticsOpportunity[] {
  return rows
    .flatMap((row): AnalyticsOpportunity[] => {
      if (row.impressions < 25 || row.position === null) return [];
      const ctr = row.ctr ?? 0;
      if (row.position >= 4 && row.position <= 12 && ctr < 0.04) {
        return [
          {
            evidence: `${formatInteger(row.impressions)} impressions, ${formatPercent(ctr)} CTR, average position ${row.position.toFixed(1)}`,
            kind: 'click_through',
            label: row.label,
            limitation:
              'This rule identifies measurable search visibility with a comparatively low click-through rate. It does not predict a ranking or traffic increase.',
            score: row.impressions * (0.04 - ctr),
          },
        ];
      }
      if (row.position > 10 && row.position <= 20) {
        return [
          {
            evidence: `${formatInteger(row.impressions)} impressions at average position ${row.position.toFixed(1)}`,
            kind: 'near_page_one',
            label: row.label,
            limitation:
              'This rule surfaces queries near the first result page. Search position is an aggregate observation, not a guaranteed outcome.',
            score: row.impressions / row.position,
          },
        ];
      }
      if (row.impressions >= 100 && row.clicks === 0) {
        return [
          {
            evidence: `${formatInteger(row.impressions)} impressions and no measured clicks in the selected period`,
            kind: 'visibility',
            label: row.label,
            limitation:
              'This rule highlights visibility without measured clicks. Search Console aggregation and privacy thresholds may affect the result.',
            score: row.impressions,
          },
        ];
      }
      return [];
    })
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
    .slice(0, Math.max(0, Math.min(limit, 20)));
}

export class AnalyticsRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyticsRangeError';
  }
}

function normalizePreset(value: string | undefined): Exclude<AnalyticsRangePreset, never> {
  if (value === undefined || value === '') return '28';
  if (value === '7' || value === '28' || value === '90' || value === 'custom') return value;
  throw new AnalyticsRangeError('Analytics range preset is invalid');
}

function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new AnalyticsRangeError('Analytics dates must use YYYY-MM-DD');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || isoDate(parsed) !== value) {
    throw new AnalyticsRangeError('Analytics date is invalid');
  }
  return parsed;
}

function startOfUtcDate(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

function utcDayDifference(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    style: 'percent',
  }).format(value);
}
