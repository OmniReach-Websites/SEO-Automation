import { randomUUID } from 'node:crypto';

import { PostgresOrapService } from '@omnireach/api/postgres-orap';
import { createDatabase } from '@omnireach/database';
import type { TenantTransactionPool } from '@omnireach/tenant';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://omnireach_dev:local-development-only@127.0.0.1:54320/omnireach_dev';
const target = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/omnireach_dev') {
  throw new Error('ORAP operations verification is restricted to the local omnireach_dev database');
}

const database = createDatabase(databaseUrl);
const actorId = randomUUID();
const firstJobId = randomUUID();
const secondJobId = randomUUID();
const firstAlertId = randomUUID();
const secondAlertId = randomUUID();
const tenantA = '10000000-0000-4000-8000-000000000001';
const siteA = '20000000-0000-4000-8000-000000000001';
const tenantB = '10000000-0000-4000-8000-000000000002';
const siteB = '20000000-0000-4000-8000-000000000002';
const actor = {
  id: actorId,
  role: 'platform_owner' as const,
  traceId: `orap-operations-${randomUUID()}`,
};

try {
  await database.pool.query(
    `INSERT INTO users (id, normalized_email, display_name)
     VALUES ($1, $2, 'Fictional ORAP Verifier')`,
    [actorId, `orap-${actorId}@example.test`],
  );
  await database.pool.query(
    `INSERT INTO jobs
       (id, tenant_id, site_id, category, schema_version, record_id, dedupe_key,
        trace_id, state, policy_version, attempt_limit, expires_at)
     VALUES
       ($1, $2, $3, 'health_check', 1, $3, $4, $5, 'queued', 1, 3, now() + interval '1 day'),
       ($6, $7, $8, 'health_check', 1, $8, $9, $10, 'failed', 1, 3, now() + interval '1 day')`,
    [
      firstJobId,
      tenantA,
      siteA,
      `orap-verify:${randomUUID()}`,
      `orap-job-${randomUUID()}`,
      secondJobId,
      tenantB,
      siteB,
      `orap-verify:${randomUUID()}`,
      `orap-job-${randomUUID()}`,
    ],
  );
  await database.pool.query(
    `INSERT INTO alerts
       (id, tenant_id, site_id, fingerprint, severity, state, source, safe_message,
        first_seen_at, last_seen_at)
     VALUES
       ($1::uuid, $2::uuid, $3::uuid, encode(digest(($1::uuid)::text, 'sha256'), 'hex'), 'warning', 'open',
        'orap-verifier', 'Fictional first incident', now(), now()),
       ($4::uuid, $5::uuid, $6::uuid, encode(digest(($4::uuid)::text, 'sha256'), 'hex'), 'warning', 'open',
        'orap-verifier', 'Fictional second incident', now(), now())`,
    [firstAlertId, tenantA, siteA, secondAlertId, tenantB, siteB],
  );

  const service = new PostgresOrapService(
    database.pool as unknown as TenantTransactionPool,
    { send: async () => undefined },
    async () => undefined,
  );
  const operations = (await service.listOperations(actor)) as {
    alerts: { id: string }[];
    jobs: { id: string }[];
  };
  if (
    !operations.jobs.some(({ id }) => id === firstJobId) ||
    !operations.jobs.some(({ id }) => id === secondJobId) ||
    !operations.alerts.some(({ id }) => id === firstAlertId) ||
    !operations.alerts.some(({ id }) => id === secondAlertId)
  ) {
    throw new Error('Platform operations view did not cross tenant RLS safely');
  }
  await service.cancelJob(actor, {
    jobId: firstJobId,
    reason: 'Fictional local cancellation verification',
  });
  const replay = (await service.replayJob(actor, {
    jobId: secondJobId,
    reason: 'Fictional local replay verification',
  })) as { id?: unknown; state?: unknown };
  if (typeof replay.id !== 'string' || replay.state !== 'queued') {
    throw new Error('Audited job replay did not create queued work');
  }
  console.log(
    JSON.stringify({
      alertsAcrossTenants: 2,
      cancellation: 'audited',
      check: 'orap-operations',
      jobsAcrossTenants: 2,
      ok: true,
      replay: 'queued',
    }),
  );
} finally {
  try {
    await database.pool.query(
      `DELETE FROM audit_events WHERE actor_id = $1 OR target_id = ANY($2::uuid[])`,
      [actorId, [firstJobId, secondJobId]],
    );
    await database.pool.query(
      `UPDATE jobs SET state = 'cancelled', completed_at = now() - interval '91 days'
        WHERE id = ANY($1::uuid[]) OR dedupe_key LIKE $2`,
      [[firstJobId, secondJobId], `replay:${secondJobId}:%`],
    );
    await database.pool.query(`DELETE FROM jobs WHERE id = ANY($1::uuid[]) OR dedupe_key LIKE $2`, [
      [firstJobId, secondJobId],
      `replay:${secondJobId}:%`,
    ]);
    await database.pool.query('DELETE FROM alerts WHERE id = ANY($1::uuid[])', [
      [firstAlertId, secondAlertId],
    ]);
    await database.pool.query('DELETE FROM users WHERE id = $1', [actorId]);
  } finally {
    await database.close();
  }
}
