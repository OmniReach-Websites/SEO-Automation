import type { BudgetReservation } from '@omnireach/ai';
import { createDatabase } from '@omnireach/database';
import type { TenantTransactionPool } from '@omnireach/tenant';
import { PostgresAiBudgetLedger } from '@omnireach/worker-aio';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://omnireach_dev:local-development-only@127.0.0.1:54320/omnireach_dev';
const databaseTarget = new URL(databaseUrl);
if (
  !['127.0.0.1', 'localhost'].includes(databaseTarget.hostname) ||
  databaseTarget.pathname !== '/omnireach_dev'
) {
  throw new Error('AI budget verification is restricted to the local omnireach_dev database');
}
const scopes = [
  {
    tenantId: '10000000-0000-4000-8000-000000000001',
    siteId: '20000000-0000-4000-8000-000000000001',
  },
  {
    tenantId: '10000000-0000-4000-8000-000000000002',
    siteId: '20000000-0000-4000-8000-000000000002',
  },
] as const;
const database = createDatabase(databaseUrl);
const ledger = new PostgresAiBudgetLedger(database.pool as unknown as TenantTransactionPool);

function reserve(
  scope: (typeof scopes)[number],
  amountUsdMicros: number,
): Promise<BudgetReservation> {
  const now = new Date();
  return ledger.reserve({
    amountUsdMicros,
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    now,
    ...scope,
  });
}

async function releaseActiveReservations(): Promise<void> {
  for (const scope of scopes) {
    const active = await database.pool.query<{
      amount_usd_micros: string;
      expires_at: Date;
      id: string;
      period_start: Date;
    }>(
      `SELECT r.id, r.amount_usd_micros::text, r.expires_at, bp.period_start
         FROM ai_reservations r
         JOIN ai_budget_periods bp ON bp.id = r.period_id
        WHERE r.tenant_id = $1 AND r.site_id = $2 AND r.state = 'active'`,
      [scope.tenantId, scope.siteId],
    );
    for (const row of active.rows) {
      await ledger.release({
        amountUsdMicros: Number(row.amount_usd_micros),
        expiresAt: row.expires_at.toISOString(),
        id: row.id,
        periodStart: row.period_start.toISOString(),
        siteId: scope.siteId,
        state: 'active',
        tenantId: scope.tenantId,
      });
    }
  }
}

async function setCaps(siteCapUsdMicros: number, platformCapUsdMicros: number): Promise<void> {
  for (const scope of scopes) {
    await database.pool.query(
      'INSERT INTO site_ai_budgets (tenant_id,site_id,cap_usd_micros,policy_version) VALUES ($1,$2,$3,1) ON CONFLICT (tenant_id,site_id) DO UPDATE SET cap_usd_micros=EXCLUDED.cap_usd_micros, policy_version=site_ai_budgets.policy_version+1',
      [scope.tenantId, scope.siteId, siteCapUsdMicros],
    );
    await database.pool.query(
      `UPDATE ai_budget_periods SET cap_usd_micros = $3
        WHERE tenant_id = $1 AND site_id = $2
          AND period_start = date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
      [scope.tenantId, scope.siteId, siteCapUsdMicros],
    );
  }
  await database.pool.query(
    'UPDATE platform_ai_budget SET cap_usd_micros = $1, policy_version = policy_version + 1, updated_at = now() WHERE singleton = true',
    [platformCapUsdMicros],
  );
  await database.pool.query(
    `UPDATE platform_ai_budget_periods SET cap_usd_micros = $1, updated_at = now()
      WHERE period_start = date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    [platformCapUsdMicros],
  );
}

async function currentUsed(): Promise<{ platform: number; sites: [number, number] }> {
  const siteValues: number[] = [];
  for (const scope of scopes) {
    const result = await database.pool.query<{ used_usd_micros: string }>(
      `SELECT COALESCE(used_usd_micros, 0)::text AS used_usd_micros
         FROM ai_budget_periods
        WHERE tenant_id = $1 AND site_id = $2
          AND period_start = date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
      [scope.tenantId, scope.siteId],
    );
    siteValues.push(Number(result.rows[0]?.used_usd_micros ?? 0));
  }
  const platform = await database.pool.query<{ used_usd_micros: string }>(
    `SELECT COALESCE(used_usd_micros, 0)::text AS used_usd_micros
       FROM platform_ai_budget_periods
      WHERE period_start = date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
  );
  return {
    platform: Number(platform.rows[0]?.used_usd_micros ?? 0),
    sites: [siteValues[0] ?? 0, siteValues[1] ?? 0],
  };
}

async function releaseFulfilled(results: PromiseSettledResult<BudgetReservation>[]): Promise<void> {
  for (const result of results) {
    if (result.status === 'fulfilled') await ledger.release(result.value);
  }
}

function assertOneAdmitted(
  results: PromiseSettledResult<BudgetReservation>[],
  label: string,
): void {
  const admitted = results.filter((result) => result.status === 'fulfilled');
  const denied = results.filter((result) => result.status === 'rejected');
  if (admitted.length !== 1 || denied.length !== 1) {
    throw new Error(`${label} did not enforce the hard cap`);
  }
}

try {
  await releaseActiveReservations();
  let baseline = await currentUsed();
  await setCaps(baseline.sites[0] + 5_000_000, baseline.platform + 50_000_000);
  const siteResults = await Promise.allSettled([
    reserve(scopes[0], 3_000_000),
    reserve(scopes[0], 3_000_000),
  ]);
  assertOneAdmitted(siteResults, 'Concurrent site budget reservation');
  await releaseFulfilled(siteResults);

  baseline = await currentUsed();
  await setCaps(Math.max(...baseline.sites) + 50_000_000, baseline.platform + 50_000_000);
  const platformResults = await Promise.allSettled([
    reserve(scopes[0], 30_000_000),
    reserve(scopes[1], 30_000_000),
  ]);
  assertOneAdmitted(platformResults, 'Concurrent platform budget reservation');
  await releaseFulfilled(platformResults);

  baseline = await currentUsed();
  await setCaps(baseline.sites[0] + 5_000_000, baseline.platform + 50_000_000);
  const reconciledReservation = await reserve(scopes[0], 1_000_000);
  const charge = await ledger.reconcile(reconciledReservation, 750_000, 1);
  if (charge.amountUsdMicros !== 750_000) throw new Error('Budget reconciliation failed');
  const releasedReservation = await reserve(scopes[0], 1_000_000);
  await ledger.release(releasedReservation);
  const counters = await database.pool.query<{
    reserved_usd_micros: string;
    used_usd_micros: string;
  }>(
    `SELECT reserved_usd_micros::text, used_usd_micros::text
       FROM ai_budget_periods
      WHERE tenant_id = $1 AND site_id = $2
        AND period_start = date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    [scopes[0].tenantId, scopes[0].siteId],
  );
  if (
    counters.rows[0]?.reserved_usd_micros !== '0' ||
    counters.rows[0]?.used_usd_micros !== String(baseline.sites[0] + 750_000)
  ) {
    throw new Error('Budget counters did not reconcile or release correctly');
  }

  console.log(
    JSON.stringify({
      check: 'ai-budget',
      ok: true,
      period: 'UTC calendar month',
      platformHardCapUsd: 50,
      platformReservations: { admitted: 1, denied: 1 },
      reconciliation: { chargedUsdMicros: 750_000, released: true },
      siteHardCapUsd: 5,
      siteReservations: { admitted: 1, denied: 1 },
    }),
  );
} finally {
  try {
    await releaseActiveReservations();
    await setCaps(5_000_000, 50_000_000);
  } finally {
    await database.close();
  }
}
