import { createDatabase } from '@omnireach/database';
import type { PoolClient } from 'pg';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://omnireach_dev:local-development-only@127.0.0.1:54320/omnireach_dev';
const tenantId = '10000000-0000-4000-8000-000000000001';
const siteId = '20000000-0000-4000-8000-000000000001';
const actorId = '40000000-0000-4000-8000-000000000001';
const quotaKey = 'ai_review_cycles_per_month';
const database = createDatabase(databaseUrl);

async function inScope<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true), set_config('app.site_id', $2, true)",
      [tenantId, siteId],
    );
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function reserve(amount: number): Promise<string> {
  return inScope(async (client) => {
    const result = await client.query<{ id: string }>(
      "SELECT reserve_plan_quota($1, $2, $3, $4, now() + interval '10 minutes') AS id",
      [tenantId, siteId, quotaKey, amount],
    );
    return result.rows[0]?.id ?? '';
  });
}

async function resetUsage(): Promise<void> {
  await database.pool.query(
    'DELETE FROM plan_quota_reservations WHERE tenant_id = $1 AND site_id = $2 AND quota_key = $3',
    [tenantId, siteId, quotaKey],
  );
  await database.pool.query(
    'DELETE FROM plan_quota_usage WHERE tenant_id = $1 AND site_id = $2 AND quota_key = $3',
    [tenantId, siteId, quotaKey],
  );
}

try {
  await resetUsage();
  await database.pool.query(
    `INSERT INTO site_plan_quota_overrides
       (tenant_id, site_id, quota_key, quota_limit, reason, actor_id, policy_version)
     VALUES ($1, $2, $3, 2, 'Local verification fixture', $4, 1)
     ON CONFLICT (tenant_id, site_id, quota_key) DO UPDATE
       SET quota_limit = 2, reason = EXCLUDED.reason, actor_id = EXCLUDED.actor_id,
           policy_version = site_plan_quota_overrides.policy_version + 1, updated_at = now()`,
    [tenantId, siteId, quotaKey, actorId],
  );

  const concurrent = await Promise.allSettled([reserve(2), reserve(2)]);
  const admitted = concurrent.filter(
    (result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled',
  );
  const denied = concurrent.filter((result) => result.status === 'rejected');
  if (admitted.length !== 1 || denied.length !== 1) {
    throw new Error('Concurrent plan quota reservation did not enforce the hard cap');
  }
  const reservationId = admitted[0]?.value;
  if (!reservationId) throw new Error('Admitted plan quota reservation did not return an id');

  await inScope(async (client) => {
    await client.query('SELECT finalize_plan_quota($1, $2, $3, true)', [
      tenantId,
      siteId,
      reservationId,
    ]);
  });
  const afterConsumption = await Promise.allSettled([reserve(1)]);
  if (afterConsumption[0]?.status !== 'rejected') {
    throw new Error('Consumed plan quota was not retained in the UTC calendar period');
  }

  console.log(
    JSON.stringify({
      admitted: 1,
      check: 'plan-quota',
      denied: 1,
      limit: 2,
      ok: true,
      quotaKey,
      reset: 'UTC calendar month',
    }),
  );
} finally {
  try {
    await resetUsage();
    await database.pool.query(
      'DELETE FROM site_plan_quota_overrides WHERE tenant_id = $1 AND site_id = $2 AND quota_key = $3',
      [tenantId, siteId, quotaKey],
    );
  } finally {
    await database.close();
  }
}
