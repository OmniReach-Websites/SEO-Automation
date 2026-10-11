import { createHash } from 'node:crypto';

import { createJobEnvelope, type JobCategory, type JobEnvelope } from '@omnireach/queue';

import { nextDailyOccurrence } from './schedule-time.ts';

export interface SchedulerQueryPool {
  connect(): Promise<{
    query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[] }>;
    release(): void;
  }>;
}

interface ClaimedScheduleRow {
  category: JobCategory;
  dedupe_key: string;
  expires_at: Date;
  jitter_minutes: number;
  job_id: string;
  local_hour: number;
  local_minute: number;
  schedule_id: string;
  site_id: string;
  tenant_id: string;
  timezone: string;
  window_key: string;
}

interface DispatchableJobRow {
  attempt_limit: number;
  category: JobCategory;
  dedupe_key: string;
  expires_at: Date;
  job_id: string;
  record_id: string;
  schema_version: number;
  site_id: string;
  tenant_id: string;
  trace_id: string;
}

export interface SchedulerTickResult {
  readonly claimed: number;
  readonly enqueued: number;
  readonly failed: number;
  readonly leaseAcquired: boolean;
}

export class PostgresSchedulerRuntime {
  private readonly ownerHash: string;

  constructor(
    private readonly pool: SchedulerQueryPool,
    ownerIdentity: string,
    private readonly enqueue: (envelope: JobEnvelope) => Promise<unknown>,
  ) {
    if (!ownerIdentity.trim()) throw new Error('Scheduler owner identity is required');
    this.ownerHash = createHash('sha256').update(ownerIdentity).digest('hex');
  }

  async tick(now = new Date(), limit = 25): Promise<SchedulerTickResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Scheduler claim limit must be between 1 and 100');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE omnireach_worker');
      const lease = await client.query(
        `SELECT claim_scheduler_lease($1::char(64), $2::timestamptz, $3::integer) AS acquired`,
        [this.ownerHash, now, 60],
      );
      if (record(lease.rows[0]).acquired !== true) {
        await client.query('COMMIT');
        return { claimed: 0, enqueued: 0, failed: 0, leaseAcquired: false };
      }
      const result = await client.query(
        `SELECT * FROM claim_due_schedules($1::char(64), $2::timestamptz, $3::integer)`,
        [this.ownerHash, now, limit],
      );
      const schedules = result.rows.map(parseClaimedSchedule);
      let enqueued = 0;
      let failed = 0;
      for (const schedule of schedules) {
        try {
          const next = nextDailyOccurrence(
            {
              hour: schedule.local_hour,
              jitterMinutes: schedule.jitter_minutes,
              minute: schedule.local_minute,
              siteId: schedule.site_id,
              timezone: schedule.timezone,
            },
            now,
          );
          await client.query(
            `SELECT complete_schedule_claim(
               $1::char(64), $2::uuid, $3::varchar(200), $4::timestamptz, $5::timestamptz
             ) AS completed`,
            [this.ownerHash, schedule.schedule_id, schedule.window_key, next, now],
          );
        } catch {
          failed += 1;
        }
      }
      const dispatchResult = await client.query(
        `SELECT * FROM claim_dispatchable_jobs($1::char(64), $2::timestamptz, $3::integer)`,
        [this.ownerHash, now, limit],
      );
      for (const job of dispatchResult.rows.map(parseDispatchableJob)) {
        try {
          const envelope = createJobEnvelope({
            attemptLimit: job.attempt_limit,
            category: job.category,
            dedupeKey: job.dedupe_key,
            expiresAt: job.expires_at.toISOString(),
            recordId: job.record_id,
            siteId: job.site_id,
            tenantId: job.tenant_id,
            timeoutMs: 10 * 60_000,
            traceId: job.trace_id,
          });
          await this.enqueue(envelope);
          await client.query(
            `SELECT finalize_job_dispatch(
               $1::char(64), $2::uuid, true, $3::timestamptz
             ) AS finalized`,
            [this.ownerHash, job.job_id, now],
          );
          enqueued += 1;
        } catch {
          failed += 1;
          await client.query(
            `SELECT finalize_job_dispatch(
               $1::char(64), $2::uuid, false, $3::timestamptz
             ) AS finalized`,
            [this.ownerHash, job.job_id, now],
          );
        }
      }
      await client.query(`SELECT release_scheduler_lease($1::char(64)) AS released`, [
        this.ownerHash,
      ]);
      await client.query('COMMIT');
      return {
        claimed: schedules.length,
        enqueued,
        failed,
        leaseAcquired: true,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function parseDispatchableJob(value: unknown): DispatchableJobRow {
  const row = record(value);
  const category = jobCategory(row.category);
  const schemaVersion = integer(row.schema_version);
  if (schemaVersion !== 1) throw new Error('Unsupported queued job schema version');
  return {
    attempt_limit: integer(row.attempt_limit),
    category,
    dedupe_key: string(row.dedupe_key),
    expires_at: date(row.expires_at),
    job_id: uuid(row.job_id),
    record_id: uuid(row.record_id),
    schema_version: schemaVersion,
    site_id: uuid(row.site_id),
    tenant_id: uuid(row.tenant_id),
    trace_id: string(row.trace_id),
  };
}

function parseClaimedSchedule(value: unknown): ClaimedScheduleRow {
  const row = record(value);
  const category = jobCategory(row.category);
  return {
    category,
    dedupe_key: string(row.dedupe_key),
    expires_at: date(row.expires_at),
    jitter_minutes: integer(row.jitter_minutes),
    job_id: uuid(row.job_id),
    local_hour: integer(row.local_hour),
    local_minute: integer(row.local_minute),
    schedule_id: uuid(row.schedule_id),
    site_id: uuid(row.site_id),
    tenant_id: uuid(row.tenant_id),
    timezone: string(row.timezone),
    window_key: string(row.window_key),
  };
}

function jobCategory(value: unknown): JobCategory {
  const category = string(value);
  const categories = new Set<JobCategory>([
    'aio_proposal',
    'backup',
    'crawl',
    'health_check',
    'metrics_sync',
    'publish',
    'seo_audit',
  ]);
  if (!categories.has(category as JobCategory)) throw new Error('Invalid claimed job category');
  return category as JobCategory;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid scheduler database response');
  }
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Invalid scheduler text field');
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('Invalid scheduler integer field');
  }
  return value;
}

function date(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new Error('Invalid scheduler timestamp');
}

function uuid(value: unknown): string {
  const parsed = string(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(parsed)) {
    throw new Error('Invalid scheduler UUID');
  }
  return parsed;
}
