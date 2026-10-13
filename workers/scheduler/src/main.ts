import { hostname } from 'node:os';
import { writeFile } from 'node:fs/promises';

import { createDatabase } from '@omnireach/database';
import { createLogger } from '@omnireach/observability';
import { BullQueueRouter } from '@omnireach/queue';
import type { TenantTransactionPool } from '@omnireach/tenant';

import { PostgresSchedulerRuntime } from './postgres.ts';

const database = createDatabase(required('DATABASE_URL'));
const pool = database.pool as unknown as TenantTransactionPool;
const router = new BullQueueRouter(
  required('REDIS_URL'),
  process.env.JOB_QUEUE_PREFIX?.trim() || 'omnireach',
);
const releaseSha = required('SOURCE_COMMIT_SHA');
const instanceId = `scheduler:${hostname()}:${process.pid}`;
const startedAt = new Date();
const runtime = new PostgresSchedulerRuntime(database.pool, instanceId, (envelope) =>
  router.enqueue(envelope),
);
const logger = createLogger(process.env.LOG_LEVEL ?? 'info');
const intervalMs = integerEnvironment('SCHEDULER_INTERVAL_MS', 15_000, 1_000, 300_000);
const claimLimit = integerEnvironment('SCHEDULER_CLAIM_LIMIT', 25, 1, 100);
const healthyPath = '/tmp/omnireach-worker-healthy';
let stopping = false;
let ticking = false;

async function tick(): Promise<void> {
  if (ticking || stopping) return;
  ticking = true;
  try {
    const result = await runtime.tick(new Date(), claimLimit);
    await writeHeartbeat('healthy', { ...result });
    await writeFile(healthyPath, `${Date.now()}\n`);
    if (result.claimed || result.enqueued || result.failed) {
      logger.info({ result }, 'Scheduler tick completed');
    }
  } catch (error) {
    logger.error({ error }, 'Scheduler tick failed');
    await writeHeartbeat('starting', { error: 'tick_failed' }).catch(() => undefined);
  } finally {
    ticking = false;
  }
}

await writeHeartbeat('starting', { claimLimit, intervalMs });
await tick();
const timer = setInterval(() => void tick(), intervalMs);
logger.info({ claimLimit, instanceId, intervalMs }, 'Scheduler started');

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  logger.info({ signal }, 'Scheduler stopping');
  while (ticking) await new Promise((resolve) => setTimeout(resolve, 25));
  await writeHeartbeat('stopped', { claimLimit, intervalMs }).catch(() => undefined);
  await router.close();
  await database.close();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

async function writeHeartbeat(
  state: 'healthy' | 'starting' | 'stopped',
  metadata: Record<string, unknown>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE omnireach_worker');
    await client.query(
      `INSERT INTO worker_heartbeats
         (instance_id, worker_kind, release_sha, started_at, last_seen_at, state, metadata)
       VALUES ($1, 'scheduler', $2, $3, now(), $4, $5::jsonb)
       ON CONFLICT (instance_id) DO UPDATE SET
         last_seen_at = now(), state = EXCLUDED.state, metadata = EXCLUDED.metadata,
         release_sha = EXCLUDED.release_sha`,
      [instanceId, releaseSha, startedAt, state, JSON.stringify(metadata)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function integerEnvironment(
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[key];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} is invalid`);
  }
  return value;
}
