import { randomUUID } from 'node:crypto';

import { createDatabase } from '@omnireach/database';
import { alertFingerprint, MemoryUrgentEmailAdapter } from '@omnireach/observability';
import type { TenantTransactionPool } from '@omnireach/tenant';
import { PostgresAlertCenter } from '@omnireach/worker-monitoring';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://omnireach_dev:local-development-only@127.0.0.1:54320/omnireach_dev';
const target = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/omnireach_dev') {
  throw new Error('Alert verification is restricted to the local omnireach_dev database');
}

const database = createDatabase(databaseUrl);
const center = new PostgresAlertCenter(database.pool as unknown as TenantTransactionPool, {
  sleep: async () => undefined,
});
const scope = {
  jobId: `alert-verify:${randomUUID()}`,
  siteId: '20000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000001',
};
const input = {
  message: `fictional monitor failure ${randomUUID()}`,
  scope: 'fictional-local-verifier',
  severity: 'critical' as const,
  source: 'local-verifier',
};
const fingerprint = alertFingerprint(input);
let alertId: string | undefined;

try {
  const email = new MemoryUrgentEmailAdapter({ failuresBeforeSuccess: 1 });
  const first = await center.report(scope, input, email);
  alertId = first.id;
  const second = await center.report(scope, input, email);
  const deliveries = await database.pool.query<{ attempt: number; state: string }>(
    `SELECT d.attempt, d.state
       FROM alert_deliveries d
       JOIN alerts a ON a.id = d.alert_id
      WHERE a.id = $1
      ORDER BY d.attempt`,
    [alertId],
  );
  if (second.occurrences !== 2 || email.delivered.length !== 1) {
    throw new Error('Alert fingerprint did not deduplicate the repeated incident');
  }
  if (
    JSON.stringify(deliveries.rows) !==
    JSON.stringify([
      { attempt: 1, state: 'failed' },
      { attempt: 2, state: 'sent' },
    ])
  ) {
    throw new Error('Alert delivery attempt history is incomplete');
  }
  console.log(
    JSON.stringify({
      check: 'alert-lifecycle',
      deliveries: deliveries.rows,
      emailDeduplicated: true,
      fingerprint,
      occurrences: second.occurrences,
      ok: true,
    }),
  );
} finally {
  try {
    if (alertId) {
      await database.pool.query('DELETE FROM alert_deliveries WHERE alert_id = $1', [alertId]);
      await database.pool.query('DELETE FROM alerts WHERE id = $1', [alertId]);
    }
  } finally {
    await database.close();
  }
}
