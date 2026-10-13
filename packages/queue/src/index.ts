import { createHash, randomUUID } from 'node:crypto';

import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { z } from 'zod';

export const jobCategories = [
  'aio_proposal',
  'backup',
  'crawl',
  'health_check',
  'metrics_sync',
  'publish',
  'seo_audit',
] as const;

export type JobCategory = (typeof jobCategories)[number];
export type JobState = 'cancelled' | 'failed' | 'queued' | 'running' | 'skipped' | 'succeeded';
export type JobErrorCategory = 'cancelled' | 'permanent' | 'retryable' | 'timeout';

const uuid = z.string().uuid();
export const jobEnvelopeSchema = z
  .object({
    attemptLimit: z.number().int().min(1).max(10).default(3),
    category: z.enum(jobCategories),
    dedupeKey: z.string().min(1).max(160),
    expiresAt: z.string().datetime(),
    recordId: uuid,
    siteId: uuid,
    tenantId: uuid,
    timeoutMs: z.number().int().min(1_000).max(900_000),
    traceId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/u),
    version: z.literal(1),
  })
  .strict();

export type JobEnvelope = z.infer<typeof jobEnvelopeSchema>;

export interface JobRecord {
  readonly envelope: JobEnvelope;
  readonly id: string;
  readonly lastErrorCategory?: JobErrorCategory;
  readonly state: JobState;
  readonly updatedAt: string;
}

export function createJobEnvelope(
  input: Omit<JobEnvelope, 'traceId' | 'version'> & { readonly traceId?: string },
): JobEnvelope {
  return jobEnvelopeSchema.parse({ ...input, traceId: input.traceId ?? randomUUID(), version: 1 });
}

export function queueJobId(envelope: JobEnvelope): string {
  return createHash('sha256')
    .update(`${envelope.tenantId}\0${envelope.siteId}\0${envelope.category}\0${envelope.dedupeKey}`)
    .digest('hex');
}

export function classifyJobError(error: unknown): JobErrorCategory {
  return error instanceof JobExecutionError ? error.category : 'permanent';
}

export class JobExecutionError extends Error {
  override readonly name = 'JobExecutionError';

  constructor(
    message: string,
    readonly category: JobErrorCategory,
  ) {
    super(message);
  }
}

export class MemoryJobRegistry {
  readonly records = new Map<string, JobRecord>();

  enqueue(envelopeInput: JobEnvelope): JobRecord {
    const envelope = jobEnvelopeSchema.parse(envelopeInput);
    const id = queueJobId(envelope);
    const existing = this.records.get(id);
    if (existing && !['cancelled', 'failed', 'succeeded'].includes(existing.state)) return existing;
    const record: JobRecord = {
      envelope,
      id,
      state: 'queued',
      updatedAt: new Date().toISOString(),
    };
    this.records.set(id, record);
    return record;
  }

  transition(id: string, state: JobState, error?: unknown): JobRecord {
    const current = this.records.get(id);
    if (!current) throw new Error('Unknown job');
    const allowed: Readonly<Record<JobState, readonly JobState[]>> = {
      cancelled: [],
      failed: ['queued'],
      queued: ['cancelled', 'running', 'skipped'],
      running: ['cancelled', 'failed', 'queued', 'skipped', 'succeeded'],
      skipped: [],
      succeeded: [],
    };
    if (!allowed[current.state].includes(state)) {
      throw new Error(`Invalid job transition: ${current.state} -> ${state}`);
    }
    const next: JobRecord = {
      ...current,
      ...(error === undefined ? {} : { lastErrorCategory: classifyJobError(error) }),
      state,
      updatedAt: new Date().toISOString(),
    };
    this.records.set(id, next);
    return next;
  }
}

export class SiteLeaseRegistry {
  readonly active = new Set<string>();

  async run<T>(envelope: JobEnvelope, operation: () => Promise<T>): Promise<T> {
    const key = `${envelope.category}:${envelope.siteId}`;
    if (this.active.has(key)) throw new JobExecutionError('Site job lease is active', 'retryable');
    this.active.add(key);
    try {
      return await operation();
    } finally {
      this.active.delete(key);
    }
  }
}

export class BullQueueAdapter {
  readonly queue: Queue<JobEnvelope>;

  constructor(name: string, redisUrl: string) {
    this.queue = new Queue<JobEnvelope>(name, {
      connection: redisConnectionOptions(redisUrl),
      defaultJobOptions: { removeOnComplete: 1_000, removeOnFail: 5_000 },
    });
  }

  async enqueue(envelopeInput: JobEnvelope): Promise<string> {
    const envelope = jobEnvelopeSchema.parse(envelopeInput);
    const options: JobsOptions = {
      attempts: envelope.attemptLimit,
      backoff: { delay: 1_000, type: 'exponential' },
      jobId: queueJobId(envelope),
    };
    const job = await this.queue.add(envelope.category, envelope, options);
    return job.id ?? queueJobId(envelope);
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function jobQueueName(category: JobCategory, prefix = 'omnireach'): string {
  if (!jobCategories.includes(category)) throw new Error('Invalid job queue category');
  if (!/^[a-z][a-z0-9-]{0,39}$/u.test(prefix)) throw new Error('Invalid queue prefix');
  return `${prefix}-${category.replaceAll('_', '-')}`;
}

export function redisConnectionOptions(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('Redis URL is invalid');
  return {
    host: url.hostname,
    ...(url.password ? { password: url.password } : {}),
    port: Number(url.port || 6379),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    ...(url.username ? { username: url.username } : {}),
  };
}

export class BullQueueRouter {
  readonly #queues = new Map<JobCategory, BullQueueAdapter>();

  constructor(
    private readonly redisUrl: string,
    private readonly prefix = 'omnireach',
  ) {}

  enqueue(envelopeInput: JobEnvelope): Promise<string> {
    const envelope = jobEnvelopeSchema.parse(envelopeInput);
    let queue = this.#queues.get(envelope.category);
    if (!queue) {
      queue = new BullQueueAdapter(jobQueueName(envelope.category, this.prefix), this.redisUrl);
      this.#queues.set(envelope.category, queue);
    }
    return queue.enqueue(envelope);
  }

  async close(): Promise<void> {
    await Promise.all([...this.#queues.values()].map((queue) => queue.close()));
    this.#queues.clear();
  }
}

export function assertExecutable(
  envelope: JobEnvelope,
  context: {
    readonly enabled: boolean;
    readonly now: Date;
    readonly siteId: string;
    readonly tenantId: string;
  },
): void {
  jobEnvelopeSchema.parse(envelope);
  if (envelope.tenantId !== context.tenantId || envelope.siteId !== context.siteId) {
    throw new JobExecutionError('Job scope does not match rehydrated record', 'permanent');
  }
  if (!context.enabled) throw new JobExecutionError('Site or feature is disabled', 'cancelled');
  if (new Date(envelope.expiresAt) <= context.now) {
    throw new JobExecutionError('Job expired before execution', 'cancelled');
  }
}

export function containsForbiddenRedisFields(value: unknown): boolean {
  const serialized = JSON.stringify(value).toLowerCase();
  return ['password', 'secret', 'token', 'content', 'prompt', 'credential'].some((field) =>
    serialized.includes(`"${field}`),
  );
}

export function shouldRetainJob(
  completedAt: Date,
  now: Date,
  options: { readonly auditReferenced: boolean; readonly hold: boolean },
): boolean {
  if (options.hold || options.auditReferenced) return true;
  return now.getTime() - completedAt.getTime() < 90 * 24 * 60 * 60 * 1_000;
}

export interface JobFailureDecision {
  readonly deadLetter: boolean;
  readonly nextState: Extract<JobState, 'cancelled' | 'failed' | 'queued'>;
}

export function decideJobFailure(
  error: unknown,
  attempt: number,
  attemptLimit: number,
): JobFailureDecision {
  const category = classifyJobError(error);
  if (category === 'cancelled') return { deadLetter: false, nextState: 'cancelled' };
  if ((category === 'retryable' || category === 'timeout') && attempt < attemptLimit) {
    return { deadLetter: false, nextState: 'queued' };
  }
  return { deadLetter: true, nextState: 'failed' };
}

export function recoverStalledJob(
  registry: MemoryJobRegistry,
  id: string,
  leaseExpired: boolean,
): JobRecord {
  const current = registry.records.get(id);
  if (!current) throw new Error('Unknown job');
  if (current.state !== 'running') throw new Error('Only running jobs can be recovered');
  if (!leaseExpired) throw new JobExecutionError('Job lease is still active', 'retryable');
  return registry.transition(
    id,
    'queued',
    new JobExecutionError('Stalled lease recovered', 'retryable'),
  );
}

export async function executeWithIdempotencyKey<T>(
  envelope: JobEnvelope,
  effect: (idempotencyKey: string) => Promise<T>,
): Promise<T> {
  return effect(queueJobId(envelope));
}

export class DrainController {
  #accepting = true;
  #active = 0;
  readonly #waiters = new Set<() => void>();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.#accepting) throw new JobExecutionError('Worker is draining', 'retryable');
    this.#active += 1;
    try {
      return await operation();
    } finally {
      this.#active -= 1;
      if (this.#active === 0) {
        for (const resolve of this.#waiters) resolve();
        this.#waiters.clear();
      }
    }
  }

  async drain(): Promise<void> {
    this.#accepting = false;
    if (this.#active === 0) return;
    await new Promise<void>((resolve) => this.#waiters.add(resolve));
  }
}
