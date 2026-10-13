import { spawnSync } from 'node:child_process';

import { PostgresRequestContextResolver } from '../apps/api/src/server.ts';
import { digestToken } from '../packages/auth/src/index.ts';
import { createDatabase } from '../packages/database/src/index.ts';
import { createClient } from 'redis';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://omnireach_dev:local-development-only@127.0.0.1:54320/omnireach_dev';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:56379';
for (const value of [databaseUrl, redisUrl]) {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new Error('Local stack verification refuses non-loopback dependencies');
}

const npmCli = process.env.npm_execpath ?? process.argv[1];
for (const script of ['db:migrate', 'db:migrate', 'db:seed']) {
  const result = spawnSync(process.execPath, [npmCli, 'run', script], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const database = createDatabase(databaseUrl);
const redis = createClient({ url: redisUrl });
try {
  await database.healthCheck();
  const tables = await database.pool.query(
    `SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const policies = await database.pool.query(
    `SELECT count(*)::text AS count FROM pg_policies WHERE schemaname = 'public'`,
  );
  await verifyTenantIsolation(database.pool);
  await redis.connect();
  if ((await redis.ping()) !== 'PONG') throw new Error('Redis health check failed');
  console.log(
    JSON.stringify({
      check: 'local-stack',
      ok: true,
      policies: Number(policies.rows[0]?.count ?? 0),
      rlsIsolation: 'verified',
      tables: Number(tables.rows[0]?.count ?? 0),
    }),
  );
} finally {
  if (redis.isOpen) await redis.quit();
  await database.close();
}

async function verifyTenantIsolation(pool) {
  const fixture = {
    pageA: '41000000-0000-4000-8000-000000000001',
    pageA2: '41000000-0000-4000-8000-000000000003',
    pageB: '41000000-0000-4000-8000-000000000002',
    siteA: '42000000-0000-4000-8000-000000000001',
    siteA2: '42000000-0000-4000-8000-000000000003',
    siteB: '42000000-0000-4000-8000-000000000002',
    sessionA: '45000000-0000-4000-8000-000000000001',
    tenantA: '43000000-0000-4000-8000-000000000001',
    tenantB: '43000000-0000-4000-8000-000000000002',
    userA: '44000000-0000-4000-8000-000000000001',
  };
  await pool.query(
    `INSERT INTO tenants (id, name) VALUES ($1, 'Fictional RLS Alpha'), ($2, 'Fictional RLS Beta')
     ON CONFLICT (id) DO NOTHING`,
    [fixture.tenantA, fixture.tenantB],
  );
  await pool.query(
    `INSERT INTO sites (id, tenant_id, name) VALUES
       ($1, $2, 'Fictional RLS Alpha Site'),
       ($3, $2, 'Fictional RLS Alpha Sister Site'),
       ($4, $5, 'Fictional RLS Beta Site')
     ON CONFLICT (id) DO NOTHING`,
    [fixture.siteA, fixture.tenantA, fixture.siteA2, fixture.siteB, fixture.tenantB],
  );
  await pool.query(
    `INSERT INTO users (id, normalized_email, display_name)
     VALUES ($1, 'rls-alpha@example.test', 'Fictional RLS User') ON CONFLICT (id) DO NOTHING`,
    [fixture.userA],
  );
  await pool.query(
    `INSERT INTO memberships (tenant_id, site_id, user_id, role)
     VALUES ($1, $2, $3, 'customer_owner') ON CONFLICT (tenant_id, site_id, user_id) DO NOTHING`,
    [fixture.tenantA, fixture.siteA, fixture.userA],
  );
  await pool.query(
    `INSERT INTO domains (tenant_id, site_id, hostname, kind, verification_status, active)
     VALUES
       ($1, $2, 'admin.rls-alpha.test', 'admin', 'verified', true),
       ($1, $3, 'admin.rls-alpha-sister.test', 'admin', 'verified', true)
     ON CONFLICT (hostname) DO NOTHING`,
    [fixture.tenantA, fixture.siteA, fixture.siteA2],
  );
  const sessionToken = 'fictional-local-rls-session-token';
  await pool.query(
    `INSERT INTO sessions (id, user_id, tenant_id, site_id, host, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, 'admin.rls-alpha.test', $5, now() + interval '1 hour')
     ON CONFLICT (token_hash) DO UPDATE SET
       revoked_at = NULL,
       expires_at = excluded.expires_at,
       last_seen_at = now()`,
    [fixture.sessionA, fixture.userA, fixture.tenantA, fixture.siteA, digestToken(sessionToken)],
  );
  await pool.query(
    `INSERT INTO content_pages (id, tenant_id, site_id, stable_id, route)
     VALUES
       ($1, $2, $3, 'home', '/'),
       ($4, $2, $5, 'home', '/'),
       ($6, $7, $8, 'home', '/')
     ON CONFLICT (tenant_id, site_id, stable_id) DO NOTHING`,
    [
      fixture.pageA,
      fixture.tenantA,
      fixture.siteA,
      fixture.pageA2,
      fixture.siteA2,
      fixture.pageB,
      fixture.tenantB,
      fixture.siteB,
    ],
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE omnireach_app');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [fixture.tenantA]);
    await client.query(`SELECT set_config('app.site_id', $1, true)`, [fixture.siteA]);
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [fixture.userA]);
    const visible = await client.query(
      'SELECT tenant_id::text, site_id::text FROM content_pages ORDER BY tenant_id',
    );
    if (
      visible.rows.length !== 1 ||
      visible.rows[0]?.tenant_id !== fixture.tenantA ||
      visible.rows[0]?.site_id !== fixture.siteA
    ) {
      throw new Error('RLS exposed a cross-tenant content page');
    }
    let denied = false;
    try {
      await client.query(
        `INSERT INTO content_pages (tenant_id, site_id, stable_id, route)
         VALUES ($1, $2, 'forbidden', '/forbidden')`,
        [fixture.tenantA, fixture.siteA2],
      );
    } catch {
      denied = true;
    }
    if (!denied) throw new Error('RLS allowed a cross-tenant write');
    await client.query('ROLLBACK');

    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE omnireach_app');
    const afterReuse = await client.query('SELECT id FROM content_pages');
    if (afterReuse.rows.length !== 0) throw new Error('Tenant context leaked across transactions');
    await client.query('ROLLBACK');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original isolation failure is more useful than rollback failure.
    }
    throw error;
  } finally {
    client.release();
  }

  const resolver = new PostgresRequestContextResolver(pool, 'admin.omnireach.test');
  const customerRequest = (hostname) => ({
    cookies: { '__Host-omnireach_session': sessionToken },
    hostname,
    id: 'local-stack-verification',
  });
  const resolved = await resolver.customer(customerRequest('admin.rls-alpha.test'));
  if (resolved?.tenantId !== fixture.tenantA || resolved.siteId !== fixture.siteA) {
    throw new Error('Verified host/session context did not resolve the expected site');
  }
  if (await resolver.customer(customerRequest('admin.rls-alpha-sister.test'))) {
    throw new Error('A session was accepted on a sister-site admin host');
  }
}
