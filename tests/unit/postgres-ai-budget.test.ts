import type { TenantTransactionPool } from '@omnireach/tenant';
import { PostgresAiBudgetLedger } from '@omnireach/worker-aio';
import { describe, expect, it, vi } from 'vitest';

const scope = {
  siteId: '20000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000001',
};

describe('PostgreSQL AI budget ledger', () => {
  it('reserves, records an immutable charge, and refreshes site/platform counters', async () => {
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.includes('reserve_ai_budget')) return { rows: [{ id: 'reservation-a' }] };
      if (text.includes('finalize_ai_budget')) return { rows: [{ id: 'usage-a' }] };
      return { rows: [] };
    });
    const pool: TenantTransactionPool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };
    const ledger = new PostgresAiBudgetLedger(pool);
    const now = new Date('2026-10-11T00:00:00.000Z');
    const reservation = await ledger.reserve({
      amountUsdMicros: 1_000_000,
      capUsdMicros: 1_000_000,
      expiresAt: new Date('2026-10-11T00:10:00.000Z'),
      now,
      platformCapUsdMicros: 1_000_000,
      ...scope,
    });
    const reserveCall = query.mock.calls.find(([text]) => text.includes('reserve_ai_budget'));
    expect(reserveCall?.[0]).toContain('$5, $6');
    expect(reserveCall?.[1]).toEqual([
      scope.tenantId,
      scope.siteId,
      1_000_000,
      new Date('2026-10-11T00:10:00.000Z'),
      1_000_000,
      1_000_000,
    ]);
    await expect(ledger.reconcile(reservation, 750_000, 1)).resolves.toMatchObject({
      amountUsdMicros: 750_000,
      id: 'usage-a',
      reservationId: 'reservation-a',
    });
    expect(query.mock.calls.some(([text]) => text.includes('finalize_ai_budget'))).toBe(true);
  });

  it('releases an active reservation without writing a charge', async () => {
    const query = vi.fn(async (text: string) => ({
      rows: text.includes('finalize_ai_budget') ? [{ id: null }] : [],
    }));
    const ledger = new PostgresAiBudgetLedger({
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    });
    await ledger.release({
      amountUsdMicros: 1_000_000,
      expiresAt: '2026-10-11T00:10:00.000Z',
      id: 'reservation-a',
      periodStart: '2026-10-01T00:00:00.000Z',
      state: 'active',
      ...scope,
    });
    expect(query.mock.calls.some(([text]) => text.includes('NULL, NULL'))).toBe(true);
  });
});
