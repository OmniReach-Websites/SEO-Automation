import { randomUUID } from 'node:crypto';

export const defaultMonthlyBudgetUsdMicros = 5_000_000;
export const defaultPlatformMonthlyBudgetUsdMicros = 50_000_000;

export class BudgetCapExceededError extends Error {
  override readonly name = 'BudgetCapExceededError';

  constructor(readonly scope: 'platform' | 'site') {
    super(`AI ${scope} budget hard cap exceeded`);
  }
}

export interface ModelPrice {
  readonly effectiveAt: string;
  readonly inputUsdMicrosPerMillion: number;
  readonly modelAlias: string;
  readonly outputUsdMicrosPerMillion: number;
  readonly version: number;
}

export interface BudgetReservation {
  readonly amountUsdMicros: number;
  readonly expiresAt: string;
  readonly id: string;
  readonly periodStart: string;
  readonly siteId: string;
  readonly state: 'active' | 'expired' | 'reconciled' | 'released';
  readonly tenantId: string;
}

export interface UsageEntry {
  readonly amountUsdMicros: number;
  readonly correctionOf?: string;
  readonly id: string;
  readonly kind: 'charge' | 'correction';
  readonly modelPriceVersion: number;
  readonly periodStart: string;
  readonly reservationId: string;
  readonly siteId: string;
  readonly tenantId: string;
}

export interface AiBudgetLedger {
  reconcile(
    reservation: BudgetReservation,
    actualUsdMicros: number,
    modelPriceVersion: number,
  ): Promise<UsageEntry>;
  release(reservation: BudgetReservation): Promise<void>;
  reserve(input: {
    readonly amountUsdMicros: number;
    readonly capUsdMicros?: number;
    readonly expiresAt: Date;
    readonly now: Date;
    readonly platformCapUsdMicros?: number;
    readonly siteId: string;
    readonly tenantId: string;
  }): Promise<BudgetReservation>;
}

export function utcMonthStart(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

export function estimateCostUsdMicros(
  price: ModelPrice,
  inputTokens: number,
  maxOutputTokens: number,
  marginBasisPoints = 1_500,
): number {
  if (![inputTokens, maxOutputTokens, marginBasisPoints].every(Number.isSafeInteger)) {
    throw new Error('Token estimates and margin must be safe integers');
  }
  const base = Math.ceil(
    (inputTokens * price.inputUsdMicrosPerMillion +
      maxOutputTokens * price.outputUsdMicrosPerMillion) /
      1_000_000,
  );
  return Math.ceil((base * (10_000 + marginBasisPoints)) / 10_000);
}

export class MemoryBudgetLedger implements AiBudgetLedger {
  readonly reservations: BudgetReservation[] = [];
  readonly usage: UsageEntry[] = [];
  #gate = Promise.resolve();

  async reserve(input: {
    readonly amountUsdMicros: number;
    readonly capUsdMicros?: number;
    readonly expiresAt: Date;
    readonly now: Date;
    readonly platformCapUsdMicros?: number;
    readonly siteId: string;
    readonly tenantId: string;
  }): Promise<BudgetReservation> {
    return this.#serialized(async () => {
      if (!Number.isSafeInteger(input.amountUsdMicros) || input.amountUsdMicros <= 0) {
        throw new Error('Reservation amount must be a positive integer');
      }
      this.expire(input.now);
      const periodStart = utcMonthStart(input.now);
      const used = this.usage
        .filter(
          (entry) =>
            entry.siteId === input.siteId &&
            entry.tenantId === input.tenantId &&
            entry.periodStart === periodStart,
        )
        .reduce((sum, entry) => sum + entry.amountUsdMicros, 0);
      const reserved = this.reservations
        .filter(
          (entry) =>
            entry.siteId === input.siteId &&
            entry.tenantId === input.tenantId &&
            entry.periodStart === periodStart &&
            entry.state === 'active',
        )
        .reduce((sum, entry) => sum + entry.amountUsdMicros, 0);
      const cap = input.capUsdMicros ?? defaultMonthlyBudgetUsdMicros;
      if (used + reserved + input.amountUsdMicros > cap) throw new BudgetCapExceededError('site');
      const platformUsed = this.usage
        .filter((entry) => entry.periodStart === periodStart)
        .reduce((sum, entry) => sum + entry.amountUsdMicros, 0);
      const platformReserved = this.reservations
        .filter((entry) => entry.periodStart === periodStart && entry.state === 'active')
        .reduce((sum, entry) => sum + entry.amountUsdMicros, 0);
      const platformCap = input.platformCapUsdMicros ?? defaultPlatformMonthlyBudgetUsdMicros;
      if (platformUsed + platformReserved + input.amountUsdMicros > platformCap) {
        throw new BudgetCapExceededError('platform');
      }
      const result: BudgetReservation = {
        amountUsdMicros: input.amountUsdMicros,
        expiresAt: input.expiresAt.toISOString(),
        id: randomUUID(),
        periodStart,
        siteId: input.siteId,
        state: 'active',
        tenantId: input.tenantId,
      };
      this.reservations.push(result);
      return result;
    });
  }

  async reconcile(
    reservationInput: BudgetReservation,
    actualUsdMicros: number,
    modelPriceVersion: number,
  ): Promise<UsageEntry> {
    return this.#serialized(async () => {
      const reservationId = reservationInput.id;
      const index = this.reservations.findIndex((entry) => entry.id === reservationId);
      const reservation = this.reservations[index];
      if (!reservation || reservation.state !== 'active')
        throw new Error('Reservation is not active');
      if (!Number.isSafeInteger(actualUsdMicros) || actualUsdMicros < 0)
        throw new Error('Invalid usage');
      this.reservations[index] = { ...reservation, state: 'reconciled' };
      const entry: UsageEntry = {
        amountUsdMicros: actualUsdMicros,
        id: randomUUID(),
        kind: 'charge',
        modelPriceVersion,
        periodStart: reservation.periodStart,
        reservationId,
        siteId: reservation.siteId,
        tenantId: reservation.tenantId,
      };
      this.usage.push(entry);
      return entry;
    });
  }

  async release(reservationInput: BudgetReservation): Promise<void> {
    const reservationId = reservationInput.id;
    const index = this.reservations.findIndex((entry) => entry.id === reservationId);
    const reservation = this.reservations[index];
    if (!reservation || reservation.state !== 'active')
      throw new Error('Reservation is not active');
    this.reservations[index] = { ...reservation, state: 'released' };
  }

  expire(now: Date): void {
    for (const [index, reservation] of this.reservations.entries()) {
      if (reservation.state === 'active' && new Date(reservation.expiresAt) <= now) {
        this.reservations[index] = { ...reservation, state: 'expired' };
      }
    }
  }

  async #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#gate;
    let release!: () => void;
    this.#gate = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
