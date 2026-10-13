import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { PostgresContentRepository } from '@omnireach/content';
import { createDatabase } from '@omnireach/database';
import { BullQueueRouter, createJobEnvelope, type JobCategory } from '@omnireach/queue';
import type { TenantTransactionPool } from '@omnireach/tenant';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://omnireach_dev:local-development-only@127.0.0.1:54320/omnireach_dev';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:56379';
const target = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/omnireach_dev') {
  throw new Error(
    'Publisher daemon verification is restricted to the local omnireach_dev database',
  );
}

const ids = {
  siteId: '20000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000001',
  userId: '40000000-0000-4000-8000-000000000001',
};
const database = createDatabase(databaseUrl);
const pool = database.pool as unknown as TenantTransactionPool;
const temporary = await mkdtemp(join(tmpdir(), 'omnireach-publisher-daemon-'));
const queuePrefix = `omnireach-daemon-${randomUUID().slice(0, 8)}`;
const queue = new BullQueueRouter(redisUrl, queuePrefix);
let daemon: ChildProcess | undefined;
const daemonErrors: string[] = [];

try {
  await database.pool.query(
    `UPDATE publication_requests
        SET status = 'failed', completed_at = now(), error_code = 'verification_recovery'
      WHERE tenant_id = $1 AND site_id = $2 AND idempotency_key LIKE 'daemon-%'
        AND status IN ('queued', 'building')`,
    [ids.tenantId, ids.siteId],
  );
  await database.pool.query(
    `UPDATE jobs SET state = 'cancelled', completed_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND site_id = $2 AND dedupe_key LIKE 'daemon-%'
        AND state IN ('queued', 'running')`,
    [ids.tenantId, ids.siteId],
  );
  const content = new PostgresContentRepository(pool);
  const context = {
    role: 'customer_owner',
    siteId: ids.siteId,
    tenantId: ids.tenantId,
    traceId: `daemon-${randomUUID()}`,
    userId: ids.userId,
  } as const;
  const draft = await content.createDraft(context);
  const updated = await content.updateDraftField(context, {
    draftId: draft.id,
    expectedVersion: draft.version,
    fieldId: 'home.heading',
    value: `Daemon publication ${randomUUID()}`,
  });
  const publishKey = `daemon-publish-${randomUUID()}`;
  await content.prepareDraftPublication(context, {
    draftId: draft.id,
    expectedVersion: updated.version,
    idempotencyKey: publishKey,
    reason: 'Publisher daemon acceptance verification',
  });

  const publications = join(temporary, 'publications');
  const assets = join(temporary, 'assets');
  await mkdir(publications, { recursive: true });
  await mkdir(assets, { recursive: true });
  daemon = spawn(
    process.execPath,
    ['--experimental-transform-types', 'workers/runner/src/main.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ASSET_STORAGE_ROOT: assets,
        DATABASE_URL: databaseUrl,
        JOB_QUEUE_PREFIX: queuePrefix,
        LOG_LEVEL: 'silent',
        PUBLICATION_STORAGE_ROOT: publications,
        REDIS_URL: redisUrl,
        REPOSITORY_ROOT: process.cwd(),
        SOURCE_COMMIT_SHA: 'c'.repeat(40),
        WORKER_CATEGORIES: 'publish',
        WORKER_HEALTH_PATH: join(temporary, 'worker-healthy'),
        WORKER_KIND: 'publisher',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  daemon.stderr?.on('data', (chunk) => daemonErrors.push(String(chunk)));
  if (!daemon.pid) throw new Error('Publisher daemon process did not start');
  await waitForHeartbeat(`publisher:${hostname()}:${daemon.pid}`);

  await enqueuePublication(publishKey);
  const published = await waitForPublication(publishKey);
  if (published.publicationStatus !== 'published' || published.jobState !== 'succeeded') {
    throw new Error(`Queued publication failed: ${JSON.stringify(published)}`);
  }

  const restoreKey = `daemon-restore-${randomUUID()}`;
  await content.prepareRestorePublication(context, {
    idempotencyKey: restoreKey,
    reason: 'Publisher daemon restoration acceptance verification',
    revision: 1,
  });
  await enqueuePublication(restoreKey);
  const restored = await waitForPublication(restoreKey);
  if (restored.publicationStatus !== 'published' || restored.jobState !== 'succeeded') {
    throw new Error(`Queued restoration failed: ${JSON.stringify(restored)}`);
  }
  if (daemon.exitCode !== null) {
    throw new Error(`Publisher daemon exited early: ${daemonErrors.join(' ').slice(0, 500)}`);
  }

  console.log(
    JSON.stringify({
      check: 'publisher-daemon',
      immutableActivation: true,
      ok: true,
      publishJob: 'succeeded',
      restoreJob: 'succeeded',
    }),
  );
} catch (error) {
  const diagnostic = daemonErrors
    .join(' ')
    .replace(/[\r\n\t]+/gu, ' ')
    .slice(0, 1_000);
  throw new Error(
    `${error instanceof Error ? error.message : 'Publisher daemon verification failed'}${diagnostic ? `; daemon: ${diagnostic}` : ''}`,
    { cause: error },
  );
} finally {
  await queue.close().catch(() => undefined);
  if (daemon && daemon.exitCode === null) {
    daemon.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolvePromise) => daemon?.once('exit', () => resolvePromise())),
      new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 5_000)),
    ]);
    if (daemon.exitCode === null) daemon.kill('SIGKILL');
  }
  await database.close();
  await rm(temporary, { force: true, recursive: true });
}

async function enqueuePublication(idempotencyKey: string): Promise<void> {
  const result = await database.pool.query<{
    attempt_limit: number;
    category: JobCategory;
    dedupe_key: string;
    expires_at: Date;
    record_id: string;
    site_id: string;
    tenant_id: string;
    trace_id: string;
  }>(
    `SELECT category, record_id, dedupe_key, trace_id, attempt_limit, expires_at,
            tenant_id, site_id
       FROM jobs
      WHERE tenant_id = $1 AND site_id = $2 AND dedupe_key = $3`,
    [ids.tenantId, ids.siteId, idempotencyKey],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Publication job was not admitted');
  await queue.enqueue(
    createJobEnvelope({
      attemptLimit: row.attempt_limit,
      category: row.category,
      dedupeKey: row.dedupe_key,
      expiresAt: row.expires_at.toISOString(),
      recordId: row.record_id,
      siteId: row.site_id,
      tenantId: row.tenant_id,
      timeoutMs: 120_000,
      traceId: row.trace_id,
    }),
  );
}

async function waitForHeartbeat(instanceId: string): Promise<void> {
  await waitUntil(async () => {
    const result = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM worker_heartbeats
        WHERE instance_id = $1 AND worker_kind = 'publisher' AND state = 'healthy'
          AND metadata->'categories' ? 'publish' AND last_seen_at > now() - interval '30 seconds'`,
      [instanceId],
    );
    return Number(result.rows[0]?.count ?? 0) > 0;
  }, 'Publisher daemon did not become healthy');
}

async function waitForPublication(idempotencyKey: string): Promise<{
  jobState: string;
  publicationStatus: string;
}> {
  let state = { jobState: 'missing', publicationStatus: 'missing' };
  await waitUntil(
    async () => {
      const result = await database.pool.query<{
        job_state: string;
        publication_status: string;
      }>(
        `SELECT job.state AS job_state, request.status AS publication_status
         FROM publication_requests request
         JOIN jobs job ON job.id = request.job_id
        WHERE request.tenant_id = $1 AND request.site_id = $2
          AND request.idempotency_key = $3`,
        [ids.tenantId, ids.siteId, idempotencyKey],
      );
      const row = result.rows[0];
      if (row) state = { jobState: row.job_state, publicationStatus: row.publication_status };
      return ['failed', 'succeeded', 'cancelled'].includes(state.jobState);
    },
    'Queued publication did not reach a terminal state',
    45_000,
  );
  return state;
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  message: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(message);
}
