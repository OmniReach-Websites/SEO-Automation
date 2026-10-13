import { randomUUID } from 'node:crypto';

import { createDatabase } from '@omnireach/database';
import { createJobEnvelope, JobExecutionError, type JobEnvelope } from '@omnireach/queue';
import type { TenantTransactionPool } from '@omnireach/tenant';
import { DurableJobRuntime, recoverExpiredJobs, WorkerHeartbeat } from '@omnireach/worker-runner';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://omnireach_dev:local-development-only@127.0.0.1:54320/omnireach_dev';
const target = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/omnireach_dev') {
  throw new Error('Worker verification is restricted to the local omnireach_dev database');
}

const database = createDatabase(databaseUrl);
const pool = database.pool as unknown as TenantTransactionPool;
const tenantId = randomUUID();
const siteId = randomUUID();
const runtime = new DurableJobRuntime(pool, `worker-verifier:${randomUUID()}`, 15_000);

try {
  await database.pool.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Worker verifier')`, [
    tenantId,
  ]);
  await database.pool.query(
    `INSERT INTO sites (id, tenant_id, name, status)
     VALUES ($1, $2, 'Worker verifier site', 'active')`,
    [siteId, tenantId],
  );

  const succeeded = envelope('success');
  await insertJob(succeeded);
  const operationResult = await runtime.execute(succeeded, async ({ attempt }) => attempt);
  if (operationResult !== 1)
    throw new Error('Successful worker operation returned the wrong attempt');
  await assertState(succeeded, 'succeeded', 'succeeded');

  const retryable = envelope('retryable');
  await insertJob(retryable);
  await expectCategory(
    runtime.execute(retryable, async () => {
      throw new JobExecutionError('Injected retryable failure', 'retryable');
    }),
    'retryable',
  );
  await assertState(retryable, 'queued', 'failed', 'retryable');

  const expired = envelope('expired', new Date(Date.now() - 1_000));
  await insertJob(expired);
  await expectCategory(
    runtime.execute(expired, async () => undefined),
    'cancelled',
  );
  await assertState(expired, 'cancelled', 'cancelled', 'cancelled');

  const disabled = envelope('disabled');
  await insertJob(disabled);
  await database.pool.query(`UPDATE sites SET status = 'disabled' WHERE id = $1`, [siteId]);
  await expectCategory(
    runtime.execute(disabled, async () => undefined),
    'cancelled',
  );
  const disabledState = await jobState(disabled);
  if (disabledState.jobState !== 'cancelled' || disabledState.runState !== null) {
    throw new Error('Disabled-site kill switch was not persisted as a cancellation');
  }
  await database.pool.query(`UPDATE sites SET status = 'active' WHERE id = $1`, [siteId]);

  const stalled = envelope('stalled');
  const stalledJobId = await insertJob(stalled, 'running');
  await database.pool.query(
    `INSERT INTO job_runs
       (tenant_id, site_id, job_id, attempt, state, worker_id_hash,
        started_at, lease_expires_at)
     VALUES ($1, $2, $3, 1, 'running', $4, now() - interval '1 minute',
             now() - interval '1 second')`,
    [tenantId, siteId, stalledJobId, 'a'.repeat(64)],
  );
  const recovered = await recoverExpiredJobs(pool, 10);
  if (recovered !== 1) throw new Error('Expired worker lease was not recovered');
  await assertState(stalled, 'queued', 'stalled', 'retryable');

  const heartbeat = new WorkerHeartbeat(
    pool,
    `worker-verifier:${randomUUID()}`,
    'runner',
    'b'.repeat(40),
  );
  await heartbeat.write('healthy', { verification: true });

  console.log(
    JSON.stringify({
      check: 'worker-runtime',
      disabledSiteCancellation: true,
      heartbeat: 'healthy',
      ok: true,
      retryLifecycle: true,
      staleLeaseRecovered: true,
      terminalLifecycle: true,
    }),
  );
} finally {
  try {
    await database.pool.query(
      `UPDATE jobs SET state = 'cancelled', completed_at = now() - interval '91 days',
              updated_at = now() - interval '91 days'
        WHERE tenant_id = $1`,
      [tenantId],
    );
    await database.pool.query(`DELETE FROM job_runs WHERE tenant_id = $1`, [tenantId]);
    await database.pool.query(`DELETE FROM jobs WHERE tenant_id = $1`, [tenantId]);
    await database.pool.query(
      `DELETE FROM worker_heartbeats WHERE metadata->>'verification' = 'true'`,
    );
    await database.pool.query(`DELETE FROM sites WHERE id = $1 AND tenant_id = $2`, [
      siteId,
      tenantId,
    ]);
    await database.pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  } finally {
    await database.close();
  }
}

function envelope(label: string, expiresAt = new Date(Date.now() + 60_000)): JobEnvelope {
  return createJobEnvelope({
    attemptLimit: 2,
    category: 'metrics_sync',
    dedupeKey: `worker-verifier:${label}:${randomUUID()}`,
    expiresAt: expiresAt.toISOString(),
    recordId: randomUUID(),
    siteId,
    tenantId,
    timeoutMs: 1_000,
  });
}

async function insertJob(envelopeValue: JobEnvelope, state = 'queued'): Promise<string> {
  const result = await database.pool.query<{ id: string }>(
    `INSERT INTO jobs
       (tenant_id, site_id, category, schema_version, record_id, dedupe_key,
        trace_id, state, policy_version, attempt_limit, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10)
     RETURNING id`,
    [
      envelopeValue.tenantId,
      envelopeValue.siteId,
      envelopeValue.category,
      envelopeValue.version,
      envelopeValue.recordId,
      envelopeValue.dedupeKey,
      envelopeValue.traceId,
      state,
      envelopeValue.attemptLimit,
      envelopeValue.expiresAt,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Verification job could not be inserted');
  return id;
}

async function jobState(envelopeValue: JobEnvelope): Promise<{
  errorCategory: string | null;
  jobState: string;
  runState: string | null;
}> {
  const result = await database.pool.query<{
    error_category: string | null;
    job_state: string;
    run_state: string | null;
  }>(
    `SELECT job.state AS job_state, run.state AS run_state, run.error_category
       FROM jobs job
       LEFT JOIN LATERAL (
         SELECT state, error_category FROM job_runs
          WHERE job_id = job.id ORDER BY attempt DESC LIMIT 1
       ) run ON true
      WHERE job.tenant_id = $1 AND job.site_id = $2
        AND job.category = $3 AND job.dedupe_key = $4`,
    [envelopeValue.tenantId, envelopeValue.siteId, envelopeValue.category, envelopeValue.dedupeKey],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Verification job state is missing');
  return {
    errorCategory: row.error_category,
    jobState: row.job_state,
    runState: row.run_state,
  };
}

async function assertState(
  envelopeValue: JobEnvelope,
  expectedJob: string,
  expectedRun: string,
  expectedCategory: string | null = null,
): Promise<void> {
  const actual = await jobState(envelopeValue);
  if (
    actual.jobState !== expectedJob ||
    actual.runState !== expectedRun ||
    actual.errorCategory !== expectedCategory
  ) {
    throw new Error(`Unexpected durable worker state: ${JSON.stringify(actual)}`);
  }
}

async function expectCategory(operation: Promise<unknown>, category: string): Promise<void> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof JobExecutionError && error.category === category) return;
    throw error;
  }
  throw new Error(`Expected ${category} worker failure`);
}
