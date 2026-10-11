import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  JobExecutionError,
  DrainController,
  MemoryJobRegistry,
  SiteLeaseRegistry,
  containsForbiddenRedisFields,
  createJobEnvelope,
  decideJobFailure,
  executeWithIdempotencyKey,
  recoverStalledJob,
  shouldRetainJob,
} from '@omnireach/queue';
import { executeGuardedJob } from '@omnireach/worker-runner';

function fixture() {
  return createJobEnvelope({
    attemptLimit: 3,
    category: 'crawl',
    dedupeKey: 'scheduled-2026-10-10',
    expiresAt: '2026-10-11T00:00:00.000Z',
    recordId: randomUUID(),
    siteId: randomUUID(),
    tenantId: randomUUID(),
    timeoutMs: 30_000,
  });
}

describe('typed job runtime', () => {
  it('deduplicates active work and excludes private payload fields', () => {
    const registry = new MemoryJobRegistry();
    const envelope = fixture();
    expect(registry.enqueue(envelope).id).toBe(registry.enqueue(envelope).id);
    expect(containsForbiddenRedisFields(envelope)).toBe(false);
    expect(() => createJobEnvelope({ ...envelope, password: 'forbidden' } as never)).toThrow();
  });

  it('rehydrates and rejects tampering, expiry, and disabled sites', async () => {
    const envelope = fixture();
    const base = {
      envelope,
      execute: async () => 'executed',
      leaseRegistry: new SiteLeaseRegistry(),
      now: new Date('2026-10-10T12:00:00.000Z'),
    };
    await expect(
      executeGuardedJob({
        ...base,
        rehydrate: async () => ({
          enabled: true,
          jobState: 'queued',
          siteId: randomUUID(),
          tenantId: envelope.tenantId,
        }),
      }),
    ).rejects.toThrow(/scope/u);
    await expect(
      executeGuardedJob({
        ...base,
        rehydrate: async () => ({
          enabled: false,
          jobState: 'queued',
          siteId: envelope.siteId,
          tenantId: envelope.tenantId,
        }),
      }),
    ).rejects.toMatchObject({ category: 'cancelled' });
    await expect(
      executeGuardedJob({
        ...base,
        now: new Date('2026-10-12T00:00:00.000Z'),
        rehydrate: async () => ({
          enabled: true,
          jobState: 'queued',
          siteId: envelope.siteId,
          tenantId: envelope.tenantId,
        }),
      }),
    ).rejects.toThrow(/expired/u);
    await expect(
      executeGuardedJob({
        ...base,
        rehydrate: async () => ({
          enabled: true,
          jobState: 'cancelled',
          siteId: envelope.siteId,
          tenantId: envelope.tenantId,
        }),
      }),
    ).rejects.toMatchObject({ category: 'cancelled' });
  });

  it('serializes work by type/site and releases leases after completion', async () => {
    const lease = new SiteLeaseRegistry();
    const envelope = fixture();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => (release = resolve));
    const first = lease.run(envelope, async () => waiting);
    await expect(lease.run(envelope, async () => undefined)).rejects.toBeInstanceOf(
      JobExecutionError,
    );
    release();
    await first;
    await expect(lease.run(envelope, async () => 'ok')).resolves.toBe('ok');
  });

  it('prunes 90-day details except holds and audit references', () => {
    const now = new Date('2026-10-10T00:00:00.000Z');
    const old = new Date('2026-07-01T00:00:00.000Z');
    expect(shouldRetainJob(old, now, { auditReferenced: false, hold: false })).toBe(false);
    expect(shouldRetainJob(old, now, { auditReferenced: true, hold: false })).toBe(true);
    expect(shouldRetainJob(old, now, { auditReferenced: false, hold: true })).toBe(true);
  });

  it('recovers stalled work, dead-letters exhausted failures, and cancels cleanly', () => {
    const registry = new MemoryJobRegistry();
    const record = registry.enqueue(fixture());
    registry.transition(record.id, 'running');
    expect(recoverStalledJob(registry, record.id, true).state).toBe('queued');
    expect(decideJobFailure(new JobExecutionError('temporary', 'retryable'), 1, 3)).toEqual({
      deadLetter: false,
      nextState: 'queued',
    });
    expect(decideJobFailure(new JobExecutionError('temporary', 'retryable'), 3, 3)).toEqual({
      deadLetter: true,
      nextState: 'failed',
    });
    expect(decideJobFailure(new JobExecutionError('disabled', 'cancelled'), 1, 3)).toEqual({
      deadLetter: false,
      nextState: 'cancelled',
    });
  });

  it('reuses the same external idempotency key after a crash and drains gracefully', async () => {
    const envelope = fixture();
    const externalEffects = new Map<string, number>();
    const effect = async (key: string) => {
      externalEffects.set(
        key,
        (externalEffects.get(key) ?? 0) + (externalEffects.has(key) ? 0 : 1),
      );
      return key;
    };
    const firstKey = await executeWithIdempotencyKey(envelope, effect);
    const retriedKey = await executeWithIdempotencyKey(envelope, effect);
    expect(retriedKey).toBe(firstKey);
    expect(externalEffects.get(firstKey)).toBe(1);

    const drain = new DrainController();
    let release!: () => void;
    const pending = drain.run(() => new Promise<void>((resolve) => (release = resolve)));
    const drained = drain.drain();
    await expect(drain.run(async () => undefined)).rejects.toMatchObject({
      category: 'retryable',
    });
    release();
    await Promise.all([pending, drained]);
  });
});
