import { createJobEnvelope, type JobEnvelope } from '@omnireach/queue';
import { isSeoAuditDue, type PlanDefinition } from '@omnireach/tenant';

export { nextDailyOccurrence, scheduleWindowKey, type DailySchedule } from './schedule-time.ts';

export class SchedulerLease {
  #expiresAt = 0;
  #owner: string | null = null;

  acquire(owner: string, now: Date, durationMs: number): boolean {
    if (this.#owner && this.#expiresAt > now.getTime() && this.#owner !== owner) return false;
    this.#owner = owner;
    this.#expiresAt = now.getTime() + durationMs;
    return true;
  }

  release(owner: string): void {
    if (this.#owner !== owner) throw new Error('Scheduler lease is owned by another process');
    this.#owner = null;
    this.#expiresAt = 0;
  }
}

export async function admitSeoAudit(input: {
  enqueue(envelope: JobEnvelope): Promise<unknown> | unknown;
  lastCompletedAt?: Date;
  now: Date;
  plan: PlanDefinition;
  siteId: string;
  tenantId: string;
}): Promise<{ admitted: boolean; envelope?: JobEnvelope }> {
  if (!isSeoAuditDue(input.plan, input.lastCompletedAt, input.now)) return { admitted: false };
  const intervalMs = input.plan.seoAuditIntervalHours * 60 * 60 * 1_000;
  const windowStart = new Date(Math.floor(input.now.getTime() / intervalMs) * intervalMs);
  const envelope = createJobEnvelope({
    attemptLimit: 3,
    category: 'seo_audit',
    dedupeKey: `plan-cadence:${windowStart.toISOString()}`,
    expiresAt: new Date(input.now.getTime() + intervalMs).toISOString(),
    recordId: input.siteId,
    siteId: input.siteId,
    tenantId: input.tenantId,
    timeoutMs: 10 * 60_000,
  });
  await input.enqueue(envelope);
  return { admitted: true, envelope };
}

export async function runContactRetention(input: {
  now: Date;
  purge(site: { siteId: string; tenantId: string }, now: Date): Promise<{ deleted: number }>;
  sites: readonly { siteId: string; tenantId: string }[];
}): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (const site of input.sites) {
    try {
      deleted += (await input.purge(site, input.now)).deleted;
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed };
}

export {
  PostgresSchedulerRuntime,
  type SchedulerQueryPool,
  type SchedulerTickResult,
} from './postgres.ts';
