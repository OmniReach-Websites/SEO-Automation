import {
  assertExecutable,
  JobExecutionError,
  type JobEnvelope,
  type JobState,
  type SiteLeaseRegistry,
} from '@omnireach/queue';

export interface RehydratedJobContext {
  readonly enabled: boolean;
  readonly jobState: JobState;
  readonly siteId: string;
  readonly tenantId: string;
}

export async function executeGuardedJob<T>(options: {
  readonly envelope: JobEnvelope;
  readonly execute: (context: RehydratedJobContext) => Promise<T>;
  readonly leaseRegistry: SiteLeaseRegistry;
  readonly now?: Date;
  readonly rehydrate: (envelope: JobEnvelope) => Promise<RehydratedJobContext>;
}): Promise<T> {
  const context = await options.rehydrate(options.envelope);
  assertExecutable(options.envelope, { ...context, now: options.now ?? new Date() });
  if (!['queued', 'running'].includes(context.jobState)) {
    throw new JobExecutionError('Durable job state does not permit execution', 'cancelled');
  }
  return options.leaseRegistry.run(options.envelope, () => options.execute(context));
}

export {
  DurableJobRuntime,
  WorkerHeartbeat,
  recoverExpiredJobs,
  type DurableExecution,
} from './runtime.ts';
