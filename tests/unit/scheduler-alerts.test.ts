import { describe, expect, it } from 'vitest';

import {
  AlertCenter,
  MemoryUrgentEmailAdapter,
  shouldRetainOperationalRecord,
} from '@omnireach/observability';
import {
  admitSeoAudit,
  PostgresSchedulerRuntime,
  runContactRetention,
  SchedulerLease,
  nextDailyOccurrence,
  scheduleWindowKey,
} from '@omnireach/worker-scheduler';
import { selectedPlanProposals } from '@omnireach/tenant';
import { randomUUID } from 'node:crypto';

describe('scheduler and alert lifecycle', () => {
  it('durably leases, claims, enqueues, advances, and releases due schedules', async () => {
    const tenantId = randomUUID();
    const siteId = randomUUID();
    const scheduleId = randomUUID();
    const jobId = randomUUID();
    const queries: string[] = [];
    const query = async (text: string) => {
      queries.push(text);
      if (text.includes('claim_scheduler_lease')) return { rows: [{ acquired: true }] };
      if (text.includes('claim_due_schedules')) {
        return {
          rows: [
            {
              category: 'seo_audit',
              dedupe_key: `schedule:${'a'.repeat(64)}`,
              expires_at: new Date('2026-10-11T12:00:00.000Z'),
              jitter_minutes: 0,
              job_id: jobId,
              local_hour: 8,
              local_minute: 0,
              schedule_id: scheduleId,
              site_id: siteId,
              tenant_id: tenantId,
              timezone: 'America/Chicago',
              window_key: `${scheduleId}:202610101200`,
            },
          ],
        };
      }
      if (text.includes('claim_dispatchable_jobs')) {
        return {
          rows: [
            {
              attempt_limit: 3,
              category: 'seo_audit',
              dedupe_key: `schedule:${'a'.repeat(64)}`,
              expires_at: new Date('2026-10-11T12:00:00.000Z'),
              job_id: jobId,
              record_id: siteId,
              schema_version: 1,
              site_id: siteId,
              tenant_id: tenantId,
              trace_id: 'trace-fictional-scheduler-job',
            },
          ],
        };
      }
      if (text.includes('complete_schedule_claim')) return { rows: [{ completed: true }] };
      if (text.includes('finalize_job_dispatch')) return { rows: [{ finalized: true }] };
      if (text.includes('release_scheduler_lease')) return { rows: [{ released: true }] };
      return { rows: [] };
    };
    const pool = {
      connect: async () => ({ query, release: () => undefined }),
    };
    const enqueued: unknown[] = [];
    const runtime = new PostgresSchedulerRuntime(
      pool,
      'fictional-scheduler-process',
      async (job) => {
        enqueued.push(job);
      },
    );

    await expect(runtime.tick(new Date('2026-10-10T12:00:00.000Z'))).resolves.toEqual({
      claimed: 1,
      enqueued: 1,
      failed: 0,
      leaseAcquired: true,
    });
    expect(enqueued).toEqual([
      expect.objectContaining({ category: 'seo_audit', siteId, tenantId }),
    ]);
    expect(queries.some((text) => text.includes('complete_schedule_claim'))).toBe(true);
    expect(queries.some((text) => text.includes('finalize_job_dispatch'))).toBe(true);
    expect(queries.some((text) => text.includes('release_scheduler_lease'))).toBe(true);
    expect(queries.at(-1)).toBe('COMMIT');
  });

  it('does not claim schedules when another scheduler owns the durable lease', async () => {
    const query = async (text: string) => ({
      rows: text.includes('claim_scheduler_lease') ? [{ acquired: false }] : [],
    });
    const enqueue = async () => {
      throw new Error('must not enqueue');
    };
    const runtime = new PostgresSchedulerRuntime(
      { connect: async () => ({ query, release: () => undefined }) },
      'second-scheduler',
      enqueue,
    );
    await expect(runtime.tick()).resolves.toEqual({
      claimed: 0,
      enqueued: 0,
      failed: 0,
      leaseAcquired: false,
    });
  });

  it('calculates one timezone-local window across DST and deduplicates it', () => {
    const schedule = {
      hour: 2,
      jitterMinutes: 0,
      minute: 30,
      siteId: 'fictional-site',
      timezone: 'America/New_York',
    };
    const occurrence = nextDailyOccurrence(schedule, new Date('2026-11-01T04:00:00.000Z'));
    expect(occurrence.toISOString()).toBe('2026-11-01T07:30:00.000Z');
    expect(scheduleWindowKey(schedule, occurrence)).toContain('fictional-site:');
  });

  it('permits only one active scheduler lease', () => {
    const lease = new SchedulerLease();
    const now = new Date('2026-10-10T00:00:00.000Z');
    expect(lease.acquire('one', now, 60_000)).toBe(true);
    expect(lease.acquire('two', now, 60_000)).toBe(false);
    lease.release('one');
    expect(lease.acquire('two', now, 60_000)).toBe(true);
  });

  it('admits SEO audits using the selected plan cadence and a deterministic queue window', async () => {
    const tenantId = randomUUID();
    const siteId = randomUUID();
    const envelopes: unknown[] = [];
    const now = new Date('2026-10-10T12:00:00.000Z');
    await expect(
      admitSeoAudit({
        enqueue: (envelope) => envelopes.push(envelope),
        lastCompletedAt: new Date('2026-10-09T11:59:59.000Z'),
        now,
        plan: selectedPlanProposals.GROWTH,
        siteId,
        tenantId,
      }),
    ).resolves.toMatchObject({ admitted: true });
    await expect(
      admitSeoAudit({
        enqueue: (envelope) => envelopes.push(envelope),
        lastCompletedAt: new Date('2026-10-09T11:59:59.000Z'),
        now,
        plan: selectedPlanProposals.STARTER,
        siteId,
        tenantId,
      }),
    ).resolves.toEqual({ admitted: false });
    expect(envelopes).toHaveLength(1);
  });

  it('runs contact retention per site without one failure stopping another site', async () => {
    const first = { siteId: randomUUID(), tenantId: randomUUID() };
    const second = { siteId: randomUUID(), tenantId: randomUUID() };
    await expect(
      runContactRetention({
        now: new Date('2026-11-01T00:00:00.000Z'),
        purge: async (site) => {
          if (site.siteId === first.siteId) throw new Error('fictional failure');
          return { deleted: 3 };
        },
        sites: [first, second],
      }),
    ).resolves.toEqual({ deleted: 3, failed: 1 });
  });

  it('deduplicates alerts and sends one urgent mock email per open incident', async () => {
    const center = new AlertCenter();
    const email = new MemoryUrgentEmailAdapter();
    const input = {
      message: 'worker unavailable',
      scope: 'site-fixture',
      severity: 'error' as const,
      source: 'worker',
    };
    const first = await center.report(input, email);
    const second = await center.report(input, email);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(second.occurrences).toBe(2);
    expect(email.delivered).toHaveLength(1);
    center.resolve(first.fingerprint);
    await center.report(input, email);
    expect(email.delivered).toHaveLength(2);
  });

  it('retries email failures, rejects bad recipients, redacts unsafe bodies, and applies retention', async () => {
    const center = new AlertCenter();
    const flaky = new MemoryUrgentEmailAdapter({ failuresBeforeSuccess: 1 });
    const input = {
      message: 'backup unavailable',
      scope: 'site-fixture',
      severity: 'critical' as const,
      source: 'backup',
    };
    await expect(center.report(input, flaky)).resolves.toMatchObject({ occurrences: 1 });
    expect(center.emailFailures.get([...center.alerts.keys()][0] ?? '')).toMatchObject({
      attempts: 1,
      message: 'Urgent email delivery failed',
    });
    await expect(center.report(input, flaky)).resolves.toMatchObject({ occurrences: 2 });
    expect(flaky.delivered).toHaveLength(1);
    await expect(
      center.report(
        { ...input, message: 'different failure' },
        new MemoryUrgentEmailAdapter({ recipient: 'invalid' }),
      ),
    ).resolves.toMatchObject({ occurrences: 1 });
    await expect(
      new MemoryUrgentEmailAdapter().send({
        alertFingerprint: 'fixture',
        safeBody: 'password=unsafe',
        subject: 'Unsafe',
      }),
    ).rejects.toThrow(/sensitive/u);
    const now = new Date('2026-10-10T00:00:00Z');
    const oldLog = new Date('2026-09-01T00:00:00Z');
    const oldAudit = new Date('2025-09-01T00:00:00Z');
    expect(
      shouldRetainOperationalRecord(oldLog, now, {
        activeIncident: false,
        hold: false,
        kind: 'log',
      }),
    ).toBe(false);
    expect(
      shouldRetainOperationalRecord(oldAudit, now, {
        activeIncident: true,
        hold: false,
        kind: 'audit',
      }),
    ).toBe(true);
  });
});
