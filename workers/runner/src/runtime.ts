import { createHash } from 'node:crypto';

import {
  assertExecutable,
  classifyJobError,
  decideJobFailure,
  JobExecutionError,
  queueJobId,
  SiteLeaseRegistry,
  type JobEnvelope,
} from '@omnireach/queue';
import {
  withWorkerTransaction,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';

export interface DurableExecution {
  attempt: number;
  jobId: string;
  runId: string;
}

export class DurableJobRuntime {
  readonly #leaseRegistry = new SiteLeaseRegistry();
  readonly #workerHash: string;

  constructor(
    private readonly pool: TenantTransactionPool,
    workerIdentity: string,
    private readonly leaseMs = 60_000,
  ) {
    if (!workerIdentity.trim()) throw new Error('Worker identity is required');
    if (!Number.isInteger(leaseMs) || leaseMs < 15_000 || leaseMs > 900_000) {
      throw new Error('Worker lease must be between 15 seconds and 15 minutes');
    }
    this.#workerHash = createHash('sha256').update(workerIdentity).digest('hex');
  }

  async execute<T>(
    envelope: JobEnvelope,
    operation: (execution: DurableExecution) => Promise<T>,
  ): Promise<T> {
    return this.#leaseRegistry.run(envelope, async () => {
      const execution = await this.begin(envelope);
      if (!execution) throw new JobExecutionError('Site is disabled', 'cancelled');
      const heartbeat = setInterval(
        () => {
          void this.renew(envelope, execution).catch(() => undefined);
        },
        Math.max(5_000, Math.floor(this.leaseMs / 3)),
      );
      heartbeat.unref();
      try {
        assertExecutable(envelope, {
          enabled: true,
          now: new Date(),
          siteId: envelope.siteId,
          tenantId: envelope.tenantId,
        });
        const result = await withTimeout(operation(execution), envelope.timeoutMs);
        await this.complete(envelope, execution, undefined);
        return result;
      } catch (error) {
        await this.complete(envelope, execution, error);
        throw error;
      } finally {
        clearInterval(heartbeat);
      }
    });
  }

  private begin(envelope: JobEnvelope): Promise<DurableExecution | undefined> {
    return withWorkerTransaction(this.pool, scope(envelope), async (client) => {
      const job = required(
        (
          await query<{
            attempt_limit: number;
            id: string;
            site_status: string;
            state: string;
          }>(
            client,
            `SELECT job.id, job.state, job.attempt_limit, site.status AS site_status
               FROM jobs job
               JOIN sites site ON site.tenant_id = job.tenant_id AND site.id = job.site_id
              WHERE job.tenant_id = $1 AND job.site_id = $2
                AND job.category = $3 AND job.dedupe_key = $4 AND job.trace_id = $5
                AND job.record_id = $6
              FOR UPDATE OF job`,
            [
              envelope.tenantId,
              envelope.siteId,
              envelope.category,
              envelope.dedupeKey,
              envelope.traceId,
              envelope.recordId,
            ],
          )
        ).rows[0],
        'Durable job record is unavailable',
      );
      if (job.site_status !== 'active') {
        await client.query(
          `UPDATE jobs SET state = 'cancelled', completed_at = now(), updated_at = now(),
                  queue_claim_owner = NULL, queue_claimed_until = NULL
            WHERE id = $1`,
          [job.id],
        );
        return undefined;
      }
      if (job.state === 'cancelled') throw new JobExecutionError('Job was cancelled', 'cancelled');
      if (['failed', 'skipped', 'succeeded'].includes(job.state)) {
        throw new JobExecutionError('Job is already terminal', 'cancelled');
      }
      const runs = await query<{
        attempt: number;
        id: string;
        lease_expires_at: Date | null;
        state: string;
      }>(
        client,
        `SELECT id, attempt, state, lease_expires_at FROM job_runs
          WHERE tenant_id = $1 AND site_id = $2 AND job_id = $3
          ORDER BY attempt DESC FOR UPDATE`,
        [envelope.tenantId, envelope.siteId, job.id],
      );
      const latest = runs.rows[0];
      if (job.state === 'running' && latest?.state === 'running') {
        if (latest.lease_expires_at && latest.lease_expires_at.getTime() > Date.now()) {
          throw new JobExecutionError('Job lease is active', 'retryable');
        }
        await client.query(
          `UPDATE job_runs SET state = 'stalled', completed_at = now(),
                  error_category = 'retryable', safe_error = 'Worker lease expired'
            WHERE id = $1`,
          [latest.id],
        );
      }
      const attempt = (latest?.attempt ?? 0) + 1;
      if (attempt > job.attempt_limit) {
        await client.query(
          `UPDATE jobs SET state = 'failed', completed_at = now(), updated_at = now()
            WHERE id = $1`,
          [job.id],
        );
        throw new JobExecutionError('Job attempt limit is exhausted', 'permanent');
      }
      const run = required(
        (
          await query<{ id: string }>(
            client,
            `INSERT INTO job_runs
               (tenant_id, site_id, job_id, attempt, state, worker_id_hash,
                started_at, lease_expires_at)
             VALUES ($1, $2, $3, $4, 'running', $5, now(),
                     now() + ($6 * interval '1 millisecond'))
             RETURNING id`,
            [envelope.tenantId, envelope.siteId, job.id, attempt, this.#workerHash, this.leaseMs],
          )
        ).rows[0],
        'Job run could not be created',
      );
      await client.query(
        `UPDATE jobs SET state = 'running', updated_at = now(),
                queue_claim_owner = NULL, queue_claimed_until = NULL
          WHERE id = $1`,
        [job.id],
      );
      return { attempt, jobId: job.id, runId: run.id };
    });
  }

  private renew(envelope: JobEnvelope, execution: DurableExecution): Promise<void> {
    return withWorkerTransaction(this.pool, scope(envelope), async (client) => {
      const result = await query<{ id: string }>(
        client,
        `UPDATE job_runs SET lease_expires_at = now() + ($4 * interval '1 millisecond')
          WHERE tenant_id = $1 AND site_id = $2 AND id = $3 AND state = 'running'
          RETURNING id`,
        [envelope.tenantId, envelope.siteId, execution.runId, this.leaseMs],
      );
      if (!result.rows[0]) {
        throw new JobExecutionError('Job lease is no longer active', 'cancelled');
      }
    });
  }

  private complete(
    envelope: JobEnvelope,
    execution: DurableExecution,
    error: unknown,
  ): Promise<void> {
    return withWorkerTransaction(this.pool, scope(envelope), async (client) => {
      const category = error === undefined ? undefined : classifyJobError(error);
      const decision =
        error === undefined
          ? undefined
          : decideJobFailure(error, execution.attempt, envelope.attemptLimit);
      const jobState = error === undefined ? 'succeeded' : (decision?.nextState ?? 'failed');
      const runState =
        error === undefined ? 'succeeded' : category === 'cancelled' ? 'cancelled' : 'failed';
      await client.query(
        `UPDATE job_runs SET state = $4, completed_at = now(), lease_expires_at = NULL,
                error_category = $5, safe_error = $6
          WHERE tenant_id = $1 AND site_id = $2 AND id = $3 AND state = 'running'`,
        [
          envelope.tenantId,
          envelope.siteId,
          execution.runId,
          runState,
          category ?? null,
          safeError(error),
        ],
      );
      await client.query(
        `UPDATE jobs SET state = $4::varchar, updated_at = now(),
                completed_at = CASE WHEN $4::varchar = 'queued' THEN NULL ELSE now() END,
                queue_dispatched_at = CASE WHEN $4::varchar = 'queued' THEN NULL ELSE queue_dispatched_at END,
                queue_claim_owner = NULL, queue_claimed_until = NULL
          WHERE tenant_id = $1 AND site_id = $2 AND id = $3 AND state = 'running'`,
        [envelope.tenantId, envelope.siteId, execution.jobId, jobState],
      );
    });
  }
}

export class WorkerHeartbeat {
  readonly #startedAt = new Date();
  constructor(
    private readonly pool: TenantTransactionPool,
    readonly instanceId: string,
    readonly kind: 'aio' | 'crawler' | 'monitoring' | 'publisher' | 'runner' | 'scheduler' | 'seo',
    private readonly releaseSha: string,
  ) {}

  async write(
    state: 'draining' | 'healthy' | 'starting' | 'stopped',
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE omnireach_worker');
      await client.query(
        `INSERT INTO worker_heartbeats
           (instance_id, worker_kind, release_sha, started_at, last_seen_at, state, metadata)
         VALUES ($1, $2, $3, $4, now(), $5, $6::jsonb)
         ON CONFLICT (instance_id) DO UPDATE SET
           last_seen_at = now(), state = EXCLUDED.state, metadata = EXCLUDED.metadata,
           release_sha = EXCLUDED.release_sha`,
        [
          this.instanceId,
          this.kind,
          this.releaseSha,
          this.#startedAt,
          state,
          JSON.stringify(metadata),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function recoverExpiredJobs(pool: TenantTransactionPool, limit = 50): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE omnireach_worker');
    const result = await query<{ recovered: number }>(
      client,
      `SELECT expire_stalled_job_runs(now(), $1) AS recovered`,
      [limit],
    );
    await client.query('COMMIT');
    return result.rows[0]?.recovered ?? 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function scope(envelope: JobEnvelope) {
  return {
    jobId: queueJobId(envelope),
    siteId: envelope.siteId,
    tenantId: envelope.tenantId,
  };
}
function safeError(error: unknown): string | null {
  if (error === undefined) return null;
  const message = error instanceof Error ? error.message : 'Worker operation failed';
  return message
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/(?:password|secret|token|credential)=[^ ]+/giu, '[REDACTED]')
    .slice(0, 500);
}
async function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new JobExecutionError('Job timed out', 'timeout')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
async function query<T extends Record<string, unknown>>(
  client: TenantTransactionClient,
  text: string,
  values?: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}
