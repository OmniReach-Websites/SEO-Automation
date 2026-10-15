import { randomUUID } from 'node:crypto';

import {
  type AiBudgetLedger,
  type BudgetReservation,
  type UsageEntry,
  utcMonthStart,
} from '@omnireach/ai';
import { withWorkerTransaction, type TenantTransactionPool } from '@omnireach/tenant';

export class PostgresAiBudgetLedger implements AiBudgetLedger {
  constructor(
    private readonly pool: TenantTransactionPool,
    private readonly durableJobId?: string,
  ) {}

  reserve(input: {
    readonly amountUsdMicros: number;
    readonly capUsdMicros?: number;
    readonly expiresAt: Date;
    readonly now: Date;
    readonly platformCapUsdMicros?: number;
    readonly siteId: string;
    readonly tenantId: string;
  }): Promise<BudgetReservation> {
    if (!Number.isSafeInteger(input.amountUsdMicros) || input.amountUsdMicros <= 0) {
      throw new Error('Reservation amount must be a positive integer');
    }
    if (input.expiresAt <= input.now) throw new Error('Reservation expiry must be in the future');
    const jobId = `ai-budget-reserve:${input.siteId}:${randomUUID()}`;
    return withWorkerTransaction(this.pool, { ...input, jobId }, async (client) => {
      const result = await query<{ id: string }>(
        client,
        'SELECT reserve_ai_budget($1, $2, $3, $4, $5, $6) AS id',
        [
          input.tenantId,
          input.siteId,
          input.amountUsdMicros,
          input.expiresAt,
          input.capUsdMicros ?? null,
          input.platformCapUsdMicros ?? null,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error('AI budget reservation failed');
      if (this.durableJobId) {
        const linked = await query<{ id: string }>(
          client,
          `UPDATE ai_reservations
              SET job_id = $4
            WHERE tenant_id = $1 AND site_id = $2 AND id = $3 AND job_id IS NULL
            RETURNING id`,
          [input.tenantId, input.siteId, id, this.durableJobId],
        );
        if (!linked.rows[0]) throw new Error('AI budget reservation job link failed');
      }
      return {
        amountUsdMicros: input.amountUsdMicros,
        expiresAt: input.expiresAt.toISOString(),
        id,
        periodStart: utcMonthStart(input.now),
        siteId: input.siteId,
        state: 'active',
        tenantId: input.tenantId,
      };
    });
  }

  reconcile(
    reservation: BudgetReservation,
    actualUsdMicros: number,
    modelPriceVersion: number,
  ): Promise<UsageEntry> {
    if (!Number.isSafeInteger(actualUsdMicros) || actualUsdMicros < 0) {
      throw new Error('Invalid usage');
    }
    if (!Number.isSafeInteger(modelPriceVersion) || modelPriceVersion < 1) {
      throw new Error('Invalid model price version');
    }
    const jobId = `ai-budget-reconcile:${reservation.id}`;
    return withWorkerTransaction(this.pool, { ...reservation, jobId }, async (client) => {
      const usage = await query<{ id: string }>(
        client,
        'SELECT finalize_ai_budget($1, $2, $3, $4, $5) AS id',
        [
          reservation.tenantId,
          reservation.siteId,
          reservation.id,
          actualUsdMicros,
          modelPriceVersion,
        ],
      );
      const id = usage.rows[0]?.id;
      if (!id) throw new Error('AI usage charge was not recorded');
      return {
        amountUsdMicros: actualUsdMicros,
        id,
        kind: 'charge',
        modelPriceVersion,
        periodStart: reservation.periodStart,
        reservationId: reservation.id,
        siteId: reservation.siteId,
        tenantId: reservation.tenantId,
      };
    });
  }

  async release(reservation: BudgetReservation): Promise<void> {
    const jobId = `ai-budget-release:${reservation.id}`;
    await withWorkerTransaction(this.pool, { ...reservation, jobId }, async (client) => {
      await client.query('SELECT finalize_ai_budget($1, $2, $3, NULL, NULL)', [
        reservation.tenantId,
        reservation.siteId,
        reservation.id,
      ]);
    });
  }
}

async function query<T extends Record<string, unknown>>(
  client: { query(text: string, values?: unknown[]): Promise<unknown> },
  text: string,
  values: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}
