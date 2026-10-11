import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  BudgetCapExceededError,
  MemoryBudgetLedger,
  estimateCostUsdMicros,
  utcMonthStart,
} from '@omnireach/ai';

const scope = { siteId: randomUUID(), tenantId: randomUUID() };

describe('AI budget ledger', () => {
  it('uses UTC calendar periods and deterministic conservative estimates', () => {
    expect(utcMonthStart(new Date('2026-10-31T23:59:59-06:00'))).toBe('2026-11-01T00:00:00.000Z');
    expect(
      estimateCostUsdMicros(
        {
          effectiveAt: '2026-10-01T00:00:00.000Z',
          inputUsdMicrosPerMillion: 1_000_000,
          modelAlias: 'fixture-model',
          outputUsdMicrosPerMillion: 2_000_000,
          version: 1,
        },
        1_000,
        1_000,
      ),
    ).toBe(3_450);
  });

  it('atomically refuses concurrent reservations over the hard cap', async () => {
    const ledger = new MemoryBudgetLedger();
    const request = {
      ...scope,
      amountUsdMicros: 3_000_000,
      expiresAt: new Date('2026-10-10T01:00:00.000Z'),
      now: new Date('2026-10-10T00:00:00.000Z'),
    };
    const results = await Promise.allSettled([ledger.reserve(request), ledger.reserve(request)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('atomically refuses cross-site reservations over the platform hard cap', async () => {
    const ledger = new MemoryBudgetLedger();
    const now = new Date('2026-10-10T00:00:00.000Z');
    const request = (siteId: string) => ({
      amountUsdMicros: 3_000_000,
      capUsdMicros: 5_000_000,
      expiresAt: new Date('2026-10-10T01:00:00.000Z'),
      now,
      platformCapUsdMicros: 5_000_000,
      siteId,
      tenantId: scope.tenantId,
    });
    const results = await Promise.allSettled([
      ledger.reserve(request(randomUUID())),
      ledger.reserve(request(randomUUID())),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: new BudgetCapExceededError('platform') });
  });

  it('releases stale reservations and reconciles actual cost immutably', async () => {
    const ledger = new MemoryBudgetLedger();
    const reservation = await ledger.reserve({
      ...scope,
      amountUsdMicros: 4_000_000,
      expiresAt: new Date('2026-10-10T01:00:00.000Z'),
      now: new Date('2026-10-10T00:00:00.000Z'),
    });
    const charge = await ledger.reconcile(reservation, 2_500_000, 7);
    expect(charge.amountUsdMicros).toBe(2_500_000);
    expect(ledger.reservations[0]?.state).toBe('reconciled');
    await expect(ledger.reconcile(reservation, 1, 7)).rejects.toThrow(/not active/u);
  });

  it('resets admission at UTC month boundaries and records estimate variance', async () => {
    const ledger = new MemoryBudgetLedger();
    const october = await ledger.reserve({
      ...scope,
      amountUsdMicros: 4_900_000,
      expiresAt: new Date('2026-10-31T23:59:59.000Z'),
      now: new Date('2026-10-31T23:00:00.000Z'),
    });
    await ledger.reconcile(october, 4_950_000, 8);
    const november = await ledger.reserve({
      ...scope,
      amountUsdMicros: 4_900_000,
      expiresAt: new Date('2026-11-01T01:00:00.000Z'),
      now: new Date('2026-11-01T00:00:00.000Z'),
    });
    expect(november.periodStart).toBe('2026-11-01T00:00:00.000Z');
    await ledger.reconcile(november, 4_000_000, 8);
    expect(ledger.usage.map((entry) => entry.amountUsdMicros)).toEqual([4_950_000, 4_000_000]);
  });
});
