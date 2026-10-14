import { randomUUID } from 'node:crypto';

import { withWorkerTransaction, type TenantTransactionPool } from './transaction.ts';

export class AiReviewCycleQuotaExceededError extends Error {
  override readonly name = 'AiReviewCycleQuotaExceededError';
  constructor() {
    super('AI review-cycle quota hard cap exceeded');
  }
}

export interface PlanQuotaReservation {
  id: string;
  siteId: string;
  tenantId: string;
}

export interface AiReviewCycleQuota {
  consume(reservation: PlanQuotaReservation): Promise<void>;
  release(reservation: PlanQuotaReservation): Promise<void>;
  reserve(input: {
    expiresAt: Date;
    now: Date;
    siteId: string;
    tenantId: string;
  }): Promise<PlanQuotaReservation>;
}

export class MemoryAiReviewCycleQuota implements AiReviewCycleQuota {
  readonly reservations = new Map<
    string,
    { period: string; state: 'active' | 'consumed' | 'released' }
  >();
  private readonly expirationTimes = new Map<string, number>();
  private readonly usage = new Map<string, number>();

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid AI review-cycle limit');
  }

  async reserve(input: {
    expiresAt: Date;
    now: Date;
    siteId: string;
    tenantId: string;
  }): Promise<PlanQuotaReservation> {
    this.expire(input.now);
    const period = `${input.tenantId}:${input.siteId}:${utcMonth(input.now)}`;
    const active = [...this.reservations.values()].filter(
      (reservation) => reservation.period === period && reservation.state === 'active',
    ).length;
    if ((this.usage.get(period) ?? 0) + active >= this.limit) {
      throw new Error('AI review-cycle quota exceeded');
    }
    const id = randomUUID();
    this.reservations.set(id, { period, state: 'active' });
    this.expirationTimes.set(id, input.expiresAt.getTime());
    return { id, siteId: input.siteId, tenantId: input.tenantId };
  }

  async consume(reservation: PlanQuotaReservation): Promise<void> {
    const record = this.active(reservation.id);
    record.state = 'consumed';
    this.usage.set(record.period, (this.usage.get(record.period) ?? 0) + 1);
  }

  async release(reservation: PlanQuotaReservation): Promise<void> {
    this.active(reservation.id).state = 'released';
  }

  private active(id: string): { period: string; state: 'active' | 'consumed' | 'released' } {
    const record = this.reservations.get(id);
    if (!record || record.state !== 'active')
      throw new Error('Plan quota reservation is not active');
    return record;
  }

  private expire(now: Date): void {
    for (const [id, reservation] of this.reservations) {
      if (reservation.state === 'active' && (this.expirationTimes.get(id) ?? 0) <= now.getTime()) {
        reservation.state = 'released';
      }
    }
  }
}

export class PostgresAiReviewCycleQuota implements AiReviewCycleQuota {
  constructor(private readonly pool: TenantTransactionPool) {}

  async reserve(input: {
    expiresAt: Date;
    now: Date;
    siteId: string;
    tenantId: string;
  }): Promise<PlanQuotaReservation> {
    const jobId = `ai-cycle-reserve:${input.siteId}:${randomUUID()}`;
    try {
      return await withWorkerTransaction(this.pool, { ...input, jobId }, async (client) => {
        const result = (await client.query(
          `SELECT reserve_plan_quota($1, $2, 'ai_review_cycles_per_month', 1, $3) AS id`,
          [input.tenantId, input.siteId, input.expiresAt],
        )) as { rows: { id: string }[] };
        const id = result.rows[0]?.id;
        if (!id) throw new Error('AI review-cycle reservation failed');
        return { id, siteId: input.siteId, tenantId: input.tenantId };
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('plan quota hard cap exceeded')) {
        throw new AiReviewCycleQuotaExceededError();
      }
      throw error;
    }
  }

  async consume(reservation: PlanQuotaReservation): Promise<void> {
    await this.finalize(reservation, true);
  }

  async release(reservation: PlanQuotaReservation): Promise<void> {
    await this.finalize(reservation, false);
  }

  private async finalize(reservation: PlanQuotaReservation, consumed: boolean): Promise<void> {
    const jobId = `ai-cycle-finalize:${reservation.id}`;
    await withWorkerTransaction(this.pool, { ...reservation, jobId }, async (client) => {
      await client.query('SELECT finalize_plan_quota($1, $2, $3, $4)', [
        reservation.tenantId,
        reservation.siteId,
        reservation.id,
        consumed,
      ]);
    });
  }
}

function utcMonth(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
