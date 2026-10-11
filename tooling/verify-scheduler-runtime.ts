import { randomUUID } from 'node:crypto';

import { createDatabase } from '@omnireach/database';
import type { JobEnvelope } from '@omnireach/queue';
import { PostgresSchedulerRuntime, type SchedulerQueryPool } from '@omnireach/worker-scheduler';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://omnireach_dev:local-development-only@127.0.0.1:54320/omnireach_dev';
const target = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/omnireach_dev') {
  throw new Error('Scheduler verification is restricted to the local omnireach_dev database');
}

const database = createDatabase(databaseUrl);
const scheduleId = randomUUID();
const tenantId = '10000000-0000-4000-8000-000000000001';
const siteId = '20000000-0000-4000-8000-000000000001';
const now = new Date();
const enqueued: JobEnvelope[] = [];

try {
  await database.pool.query(
    `INSERT INTO schedules
       (id, tenant_id, site_id, category, timezone, local_hour, local_minute,
        jitter_minutes, enabled, next_attempt_at)
     VALUES ($1, $2, $3, 'health_check', 'UTC', 4, 0, 0, true, $4)`,
    [scheduleId, tenantId, siteId, new Date(now.getTime() - 60_000)],
  );
  const runtime = new PostgresSchedulerRuntime(
    database.pool as unknown as SchedulerQueryPool,
    `local-scheduler-verifier:${randomUUID()}`,
    async (envelope) => {
      enqueued.push(envelope);
    },
  );
  const result = await runtime.tick(now, 10);
  const persisted = await database.pool.query<{
    job_count: string;
    last_window_key: string | null;
    next_attempt_at: Date;
  }>(
    `SELECT s.last_window_key, s.next_attempt_at,
            (SELECT count(*)::text FROM jobs j
              WHERE j.tenant_id = s.tenant_id AND j.site_id = s.site_id
                AND j.category = s.category AND j.dedupe_key LIKE 'schedule:%') AS job_count
       FROM schedules s WHERE s.id = $1`,
    [scheduleId],
  );
  const row = persisted.rows[0];
  if (
    result.claimed !== 1 ||
    result.enqueued !== 1 ||
    enqueued.length !== 1 ||
    !row?.last_window_key ||
    row.next_attempt_at <= now ||
    Number(row.job_count) < 1
  ) {
    throw new Error('Durable scheduler lifecycle verification failed');
  }
  console.log(
    JSON.stringify({
      check: 'scheduler-runtime',
      claimed: result.claimed,
      enqueued: result.enqueued,
      lease: 'released',
      nextAttemptAdvanced: true,
      ok: true,
    }),
  );
} finally {
  try {
    const jobs = enqueued[0]
      ? await database.pool.query<{ id: string }>(
          `SELECT id FROM jobs WHERE tenant_id = $1 AND site_id = $2
             AND category = 'health_check' AND dedupe_key = $3`,
          [tenantId, siteId, enqueued[0].dedupeKey],
        )
      : { rows: [] };
    await database.pool.query('DELETE FROM schedules WHERE id = $1', [scheduleId]);
    for (const job of jobs.rows) {
      await database.pool.query(
        `UPDATE jobs SET completed_at = now() - interval '91 days', state = 'cancelled'
          WHERE id = $1`,
        [job.id],
      );
      await database.pool.query('DELETE FROM jobs WHERE id = $1', [job.id]);
    }
  } finally {
    await database.close();
  }
}
