import { hostname } from 'node:os';

import { createDatabase } from '@omnireach/database';
import { createLogger } from '@omnireach/observability';
import {
  jobCategories,
  jobQueueName,
  JobExecutionError,
  redisConnectionOptions,
  type JobCategory,
  type JobEnvelope,
} from '@omnireach/queue';
import type { TenantTransactionPool } from '@omnireach/tenant';
import { Worker } from 'bullmq';

import { executeCategory } from './job-handlers.ts';
import { DurableJobRuntime, recoverExpiredJobs, WorkerHeartbeat } from './runtime.ts';

const databaseUrl = required('DATABASE_URL');
const redisUrl = required('REDIS_URL');
const releaseSha = required('SOURCE_COMMIT_SHA');
const kind = workerKind(required('WORKER_KIND'));
const instanceId = `${kind}:${hostname()}:${process.pid}`;
const database = createDatabase(databaseUrl);
const pool = database.pool as unknown as TenantTransactionPool;
const heartbeat = new WorkerHeartbeat(pool, instanceId, kind, releaseSha);
const logger = createLogger(process.env.LOG_LEVEL ?? 'info');
const healthyPath = process.env.WORKER_HEALTH_PATH?.trim() || '/tmp/omnireach-worker-healthy';
const categories = parseCategories(process.env.WORKER_CATEGORIES ?? '');
const workers: Worker<JobEnvelope>[] = [];
const runtime = new DurableJobRuntime(
  pool,
  instanceId,
  integerEnvironment('WORKER_LEASE_MS', 60_000, 15_000, 900_000),
);
let stopping = false;

await heartbeat.write('starting', { categories });
for (const category of categories) {
  const worker = new Worker<JobEnvelope>(
    jobQueueName(category, process.env.JOB_QUEUE_PREFIX || 'omnireach'),
    async (job) => {
      try {
        await runtime.execute(job.data, (execution) =>
          executeCategory(job.data, {
            environment: process.env,
            execution,
            pool,
          }),
        );
      } catch (error) {
        if (error instanceof JobExecutionError && error.category === 'cancelled') return;
        throw error;
      }
    },
    {
      autorun: true,
      concurrency: integerEnvironment('WORKER_CONCURRENCY', 1, 1, 20),
      connection: redisConnectionOptions(redisUrl),
      lockDuration: integerEnvironment('WORKER_BULL_LOCK_MS', 120_000, 30_000, 900_000),
      maxStalledCount: 1,
      stalledInterval: 30_000,
    },
  );
  worker.on('completed', (job) => logger.info({ category, jobId: job.id }, 'Job completed'));
  worker.on('failed', (job, error) =>
    logger.error({ category, error, jobId: job?.id }, 'Job failed'),
  );
  worker.on('error', (error) => logger.error({ category, error }, 'Worker queue error'));
  workers.push(worker);
}

async function pulse(): Promise<void> {
  const recovered = kind === 'runner' ? await recoverExpiredJobs(pool) : 0;
  await heartbeat.write('healthy', { categories, recovered });
  await import('node:fs/promises').then(({ writeFile }) =>
    writeFile(healthyPath, `${Date.now()}\n`),
  );
}
await pulse();
const pulseTimer = setInterval(
  () => void pulse().catch((error) => logger.error({ error }, 'Worker heartbeat failed')),
  30_000,
);
logger.info({ categories, instanceId, kind }, 'Worker started');

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(pulseTimer);
  logger.info({ signal }, 'Worker draining');
  await heartbeat.write('draining', { categories }).catch(() => undefined);
  await Promise.all(workers.map((worker) => worker.close()));
  await heartbeat.write('stopped', { categories }).catch(() => undefined);
  await database.close();
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

function parseCategories(value: string): JobCategory[] {
  if (!value.trim()) return [];
  const parsed = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (parsed.some((entry) => !jobCategories.includes(entry as JobCategory))) {
    throw new Error('WORKER_CATEGORIES contains an unsupported category');
  }
  return [...new Set(parsed)] as JobCategory[];
}
function workerKind(value: string): 'crawler' | 'monitoring' | 'publisher' | 'runner' | 'seo' {
  if (!['crawler', 'monitoring', 'publisher', 'runner', 'seo'].includes(value))
    throw new Error('WORKER_KIND is invalid');
  return value as 'crawler' | 'monitoring' | 'publisher' | 'runner' | 'seo';
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
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(`${key} is invalid`);
  return value;
}
