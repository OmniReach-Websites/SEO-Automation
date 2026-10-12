#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsRoot = join(repositoryRoot, 'packages', 'database', 'prisma', 'migrations');
const targetMigration = '20261011020000_g06_isolation_hardening';
const postgresImage =
  'postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297';
const runId = randomUUID().replaceAll('-', '');
const containerName = `omnireach-g06-isolation-${runId}`;
const verifierLabel = 'com.omnireach.g06-isolation-verifier';
const database = 'omnireach_g06_isolation_verify';
const ownerPassword = 'local-g06-owner-verifier-only';
const runtimeRole = 'g06_worker_runtime';
const authRuntimeRole = 'g06_auth_runtime';
const runtimePassword = 'local-g06-runtime-verifier-only';

const id = Object.freeze({
  tenantA: '10000000-0000-4000-8000-000000000001',
  tenantB: '10000000-0000-4000-8000-000000000002',
  siteA: '20000000-0000-4000-8000-000000000001',
  siteSister: '20000000-0000-4000-8000-000000000002',
  siteB: '20000000-0000-4000-8000-000000000003',
  userA: '30000000-0000-4000-8000-000000000001',
  userB: '30000000-0000-4000-8000-000000000002',
  domainA: '40000000-0000-4000-8000-000000000001',
  domainSister: '40000000-0000-4000-8000-000000000002',
  domainB: '40000000-0000-4000-8000-000000000003',
  jobA: '50000000-0000-4000-8000-000000000001',
  jobSister: '50000000-0000-4000-8000-000000000002',
  jobB: '50000000-0000-4000-8000-000000000003',
  periodA: '60000000-0000-4000-8000-000000000001',
  periodSister: '60000000-0000-4000-8000-000000000002',
  periodB: '60000000-0000-4000-8000-000000000003',
  reservationA: '70000000-0000-4000-8000-000000000001',
  connectionA: '80000000-0000-4000-8000-000000000001',
  connectionSister: '80000000-0000-4000-8000-000000000002',
  pageA: '81000000-0000-4000-8000-000000000001',
  fieldA: '82000000-0000-4000-8000-000000000001',
  publicationSister: '83000000-0000-4000-8000-000000000001',
  sessionA: '90000000-0000-4000-8000-000000000001',
  sessionSister: '90000000-0000-4000-8000-000000000002',
  platformSession: '90000000-0000-4000-8000-000000000003',
  platformRotated: '90000000-0000-4000-8000-000000000004',
  alertA: 'a0000000-0000-4000-8000-000000000001',
  alertSister: 'a0000000-0000-4000-8000-000000000002',
  alertB: 'a0000000-0000-4000-8000-000000000003',
  alertTenantGlobal: 'a0000000-0000-4000-8000-000000000004',
  alertPlatformGlobal: 'a0000000-0000-4000-8000-000000000005',
});

let containerCreated = false;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
}

function failure(command, args, result, context) {
  const details = [result.stdout, result.stderr]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join('\n');
  return new Error(
    `${context}: ${command} ${args.join(' ')} exited with ${result.status ?? 'no status'}${
      details ? `\n${details}` : ''
    }`,
  );
}

function runChecked(command, args, context, options = {}) {
  const result = run(command, args, options);
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  if (result.status !== 0) throw failure(command, args, result, context);
  return result;
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function psqlArgs(user = 'postgres', host = false) {
  return [
    'exec',
    '--interactive',
    ...(host ? ['--env', `PGPASSWORD=${runtimePassword}`] : []),
    containerName,
    'psql',
    '--no-psqlrc',
    '--set',
    'ON_ERROR_STOP=1',
    '--quiet',
    '--tuples-only',
    '--no-align',
    ...(host ? ['--host', '127.0.0.1'] : []),
    '--username',
    user,
    '--dbname',
    database,
  ];
}

function psql(sql, context) {
  return runChecked('docker', psqlArgs(), context, { input: sql }).stdout.trim();
}

function runtimePsql(sql, context) {
  return runChecked('docker', psqlArgs(runtimeRole, true), context, { input: sql }).stdout.trim();
}

function authPsql(sql, context) {
  return runChecked('docker', psqlArgs(authRuntimeRole, true), context, {
    input: sql,
  }).stdout.trim();
}

function expectFailure(sql, expected, context, runtime = false) {
  const args = runtime ? psqlArgs(runtimeRole, true) : psqlArgs();
  const result = run('docker', args, { input: sql });
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  if (result.status === 0) throw new Error(`${context}: SQL unexpectedly succeeded`);
  const details = `${result.stdout}\n${result.stderr}`;
  if (!details.includes(expected)) {
    throw failure('docker', args, result, `${context}; expected ${JSON.stringify(expected)}`);
  }
}

function expectAuthFailure(sql, expected, context) {
  const args = psqlArgs(authRuntimeRole, true);
  const result = run('docker', args, { input: sql });
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  if (result.status === 0) throw new Error(`${context}: SQL unexpectedly succeeded`);
  const details = `${result.stdout}\n${result.stderr}`;
  if (!details.includes(expected)) {
    throw failure('docker', args, result, `${context}; expected ${JSON.stringify(expected)}`);
  }
}

function expectScalar(sql, expected, context, runtime = false) {
  const actual = runtime ? runtimePsql(sql, context) : psql(sql, context);
  if (actual !== expected) {
    throw new Error(
      `${context}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function migrationsThroughTarget() {
  const migrations = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      sql: readFileSync(join(migrationsRoot, entry.name, 'migration.sql'), 'utf8'),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const targetIndex = migrations.findIndex(({ name }) => name === targetMigration);
  if (targetIndex < 0) throw new Error(`Migration ${targetMigration} was not found`);
  return migrations.slice(0, targetIndex + 1);
}

function cleanup() {
  if (!containerCreated) return;
  if (!/^omnireach-g06-isolation-[a-f0-9]{32}$/.test(containerName)) {
    throw new Error(`Refusing cleanup for unexpected container name: ${containerName}`);
  }
  const label = run('docker', [
    'container',
    'inspect',
    '--format',
    `{{ index .Config.Labels "${verifierLabel}" }}`,
    containerName,
  ]);
  if (label.status === 0 && label.stdout.trim() === runId) {
    runChecked('docker', ['container', 'rm', '--force', '--volumes', containerName], 'cleanup');
  }
  containerCreated = false;
}

function startPostgres() {
  runChecked('docker', ['version', '--format', '{{.Server.Version}}'], 'Docker availability');
  runChecked(
    'docker',
    [
      'run',
      '--detach',
      '--name',
      containerName,
      '--label',
      `${verifierLabel}=${runId}`,
      '--env',
      `POSTGRES_DB=${database}`,
      '--env',
      `POSTGRES_PASSWORD=${ownerPassword}`,
      postgresImage,
    ],
    'start disposable PostgreSQL',
  );
  containerCreated = true;
  let consecutiveReadyChecks = 0;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const ready = run('docker', [
      'exec',
      containerName,
      'pg_isready',
      '--username',
      'postgres',
      '--dbname',
      database,
    ]);
    const query =
      ready.status === 0
        ? run('docker', psqlArgs(), {
            input: 'SELECT 1;',
          })
        : undefined;
    if (ready.status === 0 && query?.status === 0) {
      consecutiveReadyChecks += 1;
      if (consecutiveReadyChecks >= 2) return;
    } else {
      consecutiveReadyChecks = 0;
    }
    sleep(500);
  }
  throw new Error('Disposable PostgreSQL did not become ready');
}

function installMigrations() {
  for (const migration of migrationsThroughTarget()) {
    psql(migration.sql, `apply ${migration.name}`);
  }
}

function seedFixtures() {
  psql(
    `
CREATE ROLE ${runtimeRole} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
  PASSWORD '${runtimePassword}';
GRANT omnireach_worker TO ${runtimeRole};
CREATE ROLE ${authRuntimeRole} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
  PASSWORD '${runtimePassword}';
GRANT omnireach_auth TO ${authRuntimeRole};

INSERT INTO users (id, normalized_email, display_name) VALUES
  ('${id.userA}', 'worker-a@example.test', 'Worker A'),
  ('${id.userB}', 'worker-b@example.test', 'Worker B');
INSERT INTO tenants (id, name) VALUES
  ('${id.tenantA}', 'Tenant A'),
  ('${id.tenantB}', 'Tenant B');
INSERT INTO sites (id, tenant_id, name, source_path) VALUES
  ('${id.siteA}', '${id.tenantA}', 'Site A', 'sites/a'),
  ('${id.siteSister}', '${id.tenantA}', 'Sister Site', 'sites/sister'),
  ('${id.siteB}', '${id.tenantB}', 'Site B', 'sites/b');
INSERT INTO domains (id, tenant_id, site_id, hostname, kind, verification_status, active) VALUES
  ('${id.domainA}', '${id.tenantA}', '${id.siteA}', 'admin.a.example.test', 'admin', 'verified', true),
  ('${id.domainSister}', '${id.tenantA}', '${id.siteSister}', 'admin.sister.example.test', 'admin', 'verified', true),
  ('${id.domainB}', '${id.tenantB}', '${id.siteB}', 'admin.b.example.test', 'admin', 'verified', true);
INSERT INTO memberships (tenant_id, site_id, user_id, role) VALUES
  ('${id.tenantA}', '${id.siteA}', '${id.userA}', 'customer_owner'),
  ('${id.tenantA}', '${id.siteSister}', '${id.userA}', 'customer_owner'),
  ('${id.tenantB}', '${id.siteB}', '${id.userB}', 'customer_owner');

INSERT INTO plan_quota_usage (tenant_id, site_id, quota_key, period_start, used) VALUES
  ('${id.tenantA}', '${id.siteA}', 'ai_review_cycles_per_month', '2026-10-01', 1),
  ('${id.tenantA}', '${id.siteSister}', 'ai_review_cycles_per_month', '2026-10-01', 2),
  ('${id.tenantB}', '${id.siteB}', 'ai_review_cycles_per_month', '2026-10-01', 3);
INSERT INTO plan_quota_reservations
  (tenant_id, site_id, quota_key, period_start, amount, expires_at) VALUES
  ('${id.tenantA}', '${id.siteA}', 'ai_review_cycles_per_month', '2026-10-01', 1, '2030-01-01T00:00:00Z'),
  ('${id.tenantA}', '${id.siteSister}', 'ai_review_cycles_per_month', '2026-10-01', 1, '2030-01-01T00:00:00Z'),
  ('${id.tenantB}', '${id.siteB}', 'ai_review_cycles_per_month', '2026-10-01', 1, '2030-01-01T00:00:00Z');
INSERT INTO site_contact_forms
  (tenant_id, site_id, form_id, reason, actor_id, policy_version) VALUES
  ('${id.tenantA}', '${id.siteA}', 'form-a', 'G06 fixture', '${id.userA}', 1),
  ('${id.tenantA}', '${id.siteSister}', 'form-sister', 'G06 fixture', '${id.userA}', 1),
  ('${id.tenantB}', '${id.siteB}', 'form-b', 'G06 fixture', '${id.userB}', 1);

INSERT INTO alerts
  (id, tenant_id, site_id, fingerprint, severity, state, source, safe_message,
   first_seen_at, last_seen_at) VALUES
  ('${id.alertA}', '${id.tenantA}', '${id.siteA}', repeat('a', 64), 'warning', 'open', 'g06', 'Site A', now(), now()),
  ('${id.alertSister}', '${id.tenantA}', '${id.siteSister}', repeat('b', 64), 'warning', 'open', 'g06', 'Sister', now(), now()),
  ('${id.alertB}', '${id.tenantB}', '${id.siteB}', repeat('c', 64), 'warning', 'open', 'g06', 'Site B', now(), now()),
  ('${id.alertTenantGlobal}', '${id.tenantA}', NULL, repeat('d', 64), 'warning', 'open', 'g06', 'Tenant global', now(), now()),
  ('${id.alertPlatformGlobal}', NULL, NULL, repeat('e', 64), 'warning', 'open', 'g06', 'Platform global', now(), now());
INSERT INTO alert_deliveries (alert_id, channel, state) VALUES
  ('${id.alertA}', 'orap', 'pending'),
  ('${id.alertSister}', 'orap', 'pending'),
  ('${id.alertB}', 'orap', 'pending'),
  ('${id.alertTenantGlobal}', 'orap', 'pending'),
  ('${id.alertPlatformGlobal}', 'orap', 'pending');
INSERT INTO operational_logs (tenant_id, site_id, trace_id, category, safe_detail) VALUES
  ('${id.tenantA}', '${id.siteA}', 'trace-g06-site-a', 'g06', '{}'),
  ('${id.tenantA}', '${id.siteSister}', 'trace-g06-sister', 'g06', '{}'),
  ('${id.tenantA}', NULL, 'trace-g06-tenant', 'g06', '{}'),
  (NULL, NULL, 'trace-g06-platform', 'g06', '{}');

INSERT INTO jobs
  (id, tenant_id, site_id, category, schema_version, record_id, dedupe_key, trace_id,
   state, policy_version, attempt_limit, expires_at) VALUES
  ('${id.jobA}', '${id.tenantA}', '${id.siteA}', 'crawl', 1, gen_random_uuid(), 'job-a', 'trace_job_a_0001', 'queued', 1, 3, '2030-01-01T00:00:00Z'),
  ('${id.jobSister}', '${id.tenantA}', '${id.siteSister}', 'crawl', 1, gen_random_uuid(), 'job-sister', 'trace_job_sister_0001', 'queued', 1, 3, '2030-01-01T00:00:00Z'),
  ('${id.jobB}', '${id.tenantB}', '${id.siteB}', 'crawl', 1, gen_random_uuid(), 'job-b', 'trace_job_b_0001', 'queued', 1, 3, '2030-01-01T00:00:00Z');
INSERT INTO ai_budget_periods
  (id, tenant_id, site_id, period_start, cap_usd_micros) VALUES
  ('${id.periodA}', '${id.tenantA}', '${id.siteA}', '2026-10-01T00:00:00Z', 5000000),
  ('${id.periodSister}', '${id.tenantA}', '${id.siteSister}', '2026-10-01T00:00:00Z', 5000000),
  ('${id.periodB}', '${id.tenantB}', '${id.siteB}', '2026-10-01T00:00:00Z', 5000000);
INSERT INTO ai_reservations
  (id, tenant_id, site_id, period_id, job_id, amount_usd_micros, state, expires_at) VALUES
  ('${id.reservationA}', '${id.tenantA}', '${id.siteA}', '${id.periodA}', '${id.jobA}', 1000, 'active', '2030-01-01T00:00:00Z');

INSERT INTO integration_connections
  (id, tenant_id, site_id, provider, property_kind, property_id, property_mapping,
   credential_ref, scopes, status, permissions_provenance) VALUES
  ('${id.connectionA}', '${id.tenantA}', '${id.siteA}', 'google', 'ga4', 'ga4-a', 'site-a', 'secret:a', '[]', 'connected', '{}'),
  ('${id.connectionSister}', '${id.tenantA}', '${id.siteSister}', 'google', 'ga4', 'ga4-sister', 'site-sister', 'secret:sister', '[]', 'connected', '{}');
INSERT INTO content_pages (id, tenant_id, site_id, stable_id, route)
VALUES ('${id.pageA}', '${id.tenantA}', '${id.siteA}', 'page-a', '/');
INSERT INTO content_fields
  (id, tenant_id, site_id, page_id, stable_id, field_type, protected, ai_mode)
VALUES
  ('${id.fieldA}', '${id.tenantA}', '${id.siteA}', '${id.pageA}', 'field-a', 'text', false, 'suggestion');
INSERT INTO publication_requests
  (id, tenant_id, site_id, idempotency_key, requested_by, origin, reason,
   content_revision, status, completed_at, trace_id)
VALUES
  ('${id.publicationSister}', '${id.tenantA}', '${id.siteSister}', 'publication-sister', '${id.userA}',
   'orap', 'G06 fixture', 1, 'failed', now(), 'trace_publication_sister_0001');

INSERT INTO sessions
  (id, user_id, tenant_id, site_id, host, token_hash, expires_at) VALUES
  ('${id.sessionA}', '${id.userA}', '${id.tenantA}', '${id.siteA}', 'admin.a.example.test', repeat('1', 64), '2030-01-01T00:00:00Z'),
  ('${id.sessionSister}', '${id.userA}', '${id.tenantA}', '${id.siteSister}', 'admin.sister.example.test', repeat('2', 64), '2030-01-01T00:00:00Z'),
  ('${id.platformSession}', '${id.userA}', NULL, NULL, 'admin.platform.example.test', repeat('3', 64), '2030-01-01T00:00:00Z');
INSERT INTO sessions
  (id, user_id, tenant_id, site_id, host, token_hash, rotated_from_id, expires_at) VALUES
  ('${id.platformRotated}', '${id.userA}', NULL, NULL, 'admin.platform.example.test', repeat('4', 64), '${id.platformSession}', '2030-01-01T00:00:00Z');
`,
    'seed A/B/sister-site fixtures and restricted runtime login',
  );
}

function verifyCatalog() {
  const constraints = [
    'sessions_rotation_scope_fk',
    'sessions_membership_scope_fk',
    'domain_operations_domain_scope_fk',
    'job_runs_job_scope_fk',
    'ai_reservations_period_scope_fk',
    'ai_reservations_job_scope_fk',
    'ai_usage_period_scope_fk',
    'ai_usage_reservation_scope_fk',
    'ai_usage_correction_scope_fk',
    'crawl_runs_job_scope_fk',
    'crawl_pages_run_scope_fk',
    'crawl_edges_run_scope_fk',
    'audit_runs_crawl_scope_fk',
    'findings_audit_scope_fk',
    'content_proposals_publication_scope_fk',
    'metric_snapshots_connection_scope_fk',
  ];
  expectScalar(
    `SELECT count(*) FROM pg_constraint WHERE conname = ANY (ARRAY[${constraints
      .map((name) => `'${name}'`)
      .join(',')}]) AND convalidated;`,
    String(constraints.length),
    'all same-scope constraints are installed and validated',
  );
  expectScalar(
    `SELECT count(*) FROM pg_policies
      WHERE tablename IN ('plan_quota_usage','plan_quota_reservations','site_contact_forms')
        AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%omnireach_worker%';`,
    '0',
    'worker bypasses are absent from target policies',
  );
  expectScalar(
    `SELECT count(*) FROM pg_policies
      WHERE tablename = 'alert_deliveries' AND policyname = 'indirect_alert_delivery_scope';`,
    '1',
    'alert deliveries have an indirect exact-site policy',
  );

  const expected = [
    ['omnireach_app', 'users', 'SELECT', false],
    ['omnireach_app', 'tenants', 'SELECT', true],
    ['omnireach_app', 'tenants', 'INSERT', false],
    ['omnireach_app', 'sites', 'UPDATE', false],
    ['omnireach_app', 'domains', 'DELETE', false],
    ['omnireach_app', 'memberships', 'SELECT', true],
    ['omnireach_app', 'memberships', 'UPDATE', false],
    ['omnireach_app', 'audit_events', 'SELECT', true],
    ['omnireach_app', 'audit_events', 'INSERT', true],
    ['omnireach_app', 'audit_events', 'UPDATE', false],
    ['omnireach_worker', 'sites', 'SELECT', true],
    ['omnireach_worker', 'sites', 'UPDATE', false],
    ['omnireach_worker', 'memberships', 'SELECT', true],
    ['omnireach_worker', 'memberships', 'INSERT', false],
    ['omnireach_worker', 'audit_events', 'SELECT', false],
    ['omnireach_worker', 'audit_events', 'INSERT', true],
    ['omnireach_auth', 'users', 'SELECT', true],
    ['omnireach_auth', 'users', 'INSERT', true],
    ['omnireach_auth', 'users', 'UPDATE', true],
    ['omnireach_auth', 'users', 'DELETE', false],
    ['omnireach_auth', 'tenants', 'SELECT', true],
    ['omnireach_auth', 'domains', 'UPDATE', false],
    ['omnireach_auth', 'memberships', 'UPDATE', true],
    ['omnireach_auth', 'memberships', 'DELETE', false],
    ['omnireach_platform', 'users', 'SELECT', true],
    ['omnireach_platform', 'users', 'UPDATE', false],
    ['omnireach_platform', 'tenants', 'DELETE', true],
    ['omnireach_platform', 'audit_events', 'INSERT', true],
    ['omnireach_platform', 'audit_events', 'DELETE', false],
    ['omnireach_worker', 'plan_quota_usage', 'SELECT', true],
    ['omnireach_worker', 'plan_quota_usage', 'UPDATE', false],
    ['omnireach_platform', 'plan_quota_reservations', 'INSERT', false],
    ['omnireach_app', 'site_contact_forms', 'UPDATE', true],
    ['omnireach_app', 'site_contact_forms', 'INSERT', false],
    ['omnireach_worker', 'site_contact_forms', 'SELECT', true],
    ['omnireach_worker', 'site_contact_forms', 'UPDATE', false],
    ['omnireach_auth', 'site_contact_forms', 'SELECT', false],
    ['omnireach_app', 'subscriptions', 'SELECT', true],
    ['omnireach_app', 'subscriptions', 'INSERT', false],
    ['omnireach_app', 'site_feature_overrides', 'UPDATE', false],
    ['omnireach_app', 'site_emergency_controls', 'UPDATE', false],
    ['omnireach_worker', 'subscriptions', 'SELECT', true],
    ['omnireach_worker', 'site_feature_overrides', 'UPDATE', false],
    ['omnireach_auth', 'subscriptions', 'SELECT', true],
    ['omnireach_auth', 'site_feature_overrides', 'SELECT', false],
    ['omnireach_platform', 'subscriptions', 'SELECT', true],
    ['omnireach_platform', 'subscriptions', 'INSERT', true],
    ['omnireach_platform', 'subscriptions', 'UPDATE', true],
    ['omnireach_platform', 'subscriptions', 'DELETE', false],
    ['omnireach_platform', 'site_feature_overrides', 'UPDATE', true],
    ['omnireach_platform', 'site_emergency_controls', 'UPDATE', true],
  ];
  const values = expected
    .map(
      ([role, table, verb, allowed]) =>
        `('${role}'::text,'${table}'::text,'${verb}'::text,${allowed ? 'true' : 'false'})`,
    )
    .join(',\n');
  expectScalar(
    `WITH expected(role_name, table_name, verb, allowed) AS (VALUES ${values})
     SELECT count(*)
       FROM expected
      WHERE has_table_privilege(role_name, table_name, verb) IS DISTINCT FROM allowed;`,
    '0',
    'runtime privilege matrix matches repository needs',
  );
}

function verifyRuntimeIsolation() {
  expectFailure(
    'SELECT count(*) FROM plan_quota_usage;',
    'permission denied for table plan_quota_usage',
    'NOINHERIT runtime login cannot use worker privileges before SET ROLE',
    true,
  );

  const authResolverCount = authPsql(
    `BEGIN;
SET LOCAL ROLE omnireach_auth;
SELECT set_config('app.authentication_contract_version', '3', true);
SELECT count(*)
  FROM sessions session
  JOIN users account ON account.id = session.user_id AND account.status = 'active'
  JOIN memberships membership
    ON membership.user_id = session.user_id
   AND membership.tenant_id = session.tenant_id
   AND membership.site_id = session.site_id
   AND membership.active
  JOIN sites site
    ON site.tenant_id = membership.tenant_id AND site.id = membership.site_id
   AND site.status = 'active'
  JOIN tenants tenant ON tenant.id = membership.tenant_id AND tenant.status = 'active'
  JOIN domains domain
    ON domain.tenant_id = membership.tenant_id AND domain.site_id = membership.site_id
   AND domain.kind = 'admin' AND domain.active AND domain.verification_status = 'verified'
 WHERE session.token_hash = repeat('1', 64)
   AND session.host = 'admin.a.example.test'
   AND domain.hostname = session.host
   AND session.revoked_at IS NULL;
COMMIT;`,
    'actual auth login executes the customer request-context resolver joins',
  );
  if (authResolverCount !== ['3', '1'].join('\n')) {
    throw new Error(
      `auth resolver query: expected contract marker and one row, received ${JSON.stringify(authResolverCount)}`,
    );
  }

  expectScalar(
    `BEGIN;
SET LOCAL ROLE omnireach_worker;
SELECT set_config('app.tenant_id', '${id.tenantA}', true);
SELECT set_config('app.site_id', '${id.siteA}', true);
SELECT set_config('app.job_id', '${id.jobA}', true);
SELECT
  (SELECT count(*) FROM plan_quota_usage),
  (SELECT count(*) FROM plan_quota_reservations),
  (SELECT count(*) FROM site_contact_forms),
  (SELECT count(*) FROM alerts),
  (SELECT count(*) FROM operational_logs),
  (SELECT count(*) FROM alert_deliveries);
COMMIT;
SELECT
  COALESCE(NULLIF(current_setting('app.tenant_id', true), ''), '<unset>'),
  COALESCE(NULLIF(current_setting('app.site_id', true), ''), '<unset>'),
  COALESCE(NULLIF(current_setting('app.job_id', true), ''), '<unset>');`,
    [id.tenantA, id.siteA, id.jobA, '1|1|1|1|1|1', '<unset>|<unset>|<unset>'].join('\n'),
    'actual worker login sees only exact-site rows and transaction GUCs are cleared',
    true,
  );

  expectFailure(
    `BEGIN;
SET LOCAL ROLE omnireach_worker;
SELECT set_config('app.tenant_id', '${id.tenantA}', true);
SELECT set_config('app.site_id', '${id.siteA}', true);
SELECT set_config('app.job_id', '${id.jobA}', true);
INSERT INTO alerts
  (tenant_id, site_id, fingerprint, severity, state, source, safe_message,
   first_seen_at, last_seen_at)
VALUES
  ('${id.tenantA}', '${id.siteSister}', repeat('f', 64), 'warning', 'open',
   'g06', 'cross-site write', now(), now());
COMMIT;`,
    'new row violates row-level security policy for table "alerts"',
    'worker cannot write a sister-site alert',
    true,
  );

  expectFailure(
    `BEGIN;
SET LOCAL ROLE omnireach_worker;
SELECT set_config('app.tenant_id', '${id.tenantA}', true);
SELECT set_config('app.site_id', '${id.siteA}', true);
SELECT set_config('app.job_id', '${id.jobA}', true);
SELECT reserve_plan_quota(
  '${id.tenantA}', '${id.siteSister}', 'ai_review_cycles_per_month', 1,
  now() + interval '5 minutes');
COMMIT;`,
    'scope mismatch',
    'worker quota function rejects a sister-site scope',
    true,
  );
}

function verifyNegativeConstraints() {
  expectFailure(
    `INSERT INTO sessions
      (user_id, tenant_id, site_id, host, token_hash, expires_at)
     VALUES
      ('${id.userA}', '${id.tenantA}', NULL, 'admin.a.example.test', repeat('5', 64), '2030-01-01T00:00:00Z');`,
    'sessions_scope_pair_check',
    'session partial scope is rejected',
  );
  expectFailure(
    `INSERT INTO sessions
      (user_id, tenant_id, site_id, host, token_hash, rotated_from_id, expires_at)
     VALUES
      ('${id.userA}', '${id.tenantA}', '${id.siteA}', 'admin.a.example.test', repeat('6', 64),
       '${id.sessionSister}', '2030-01-01T00:00:00Z');`,
    'rotated session must have the same tenant/site scope',
    'session rotation cannot cross sister-site scope',
  );
  expectAuthFailure(
    `BEGIN;
SET LOCAL ROLE omnireach_auth;
SELECT set_config('app.authentication_contract_version', '3', true);
INSERT INTO sessions
  (user_id, tenant_id, site_id, host, token_hash, expires_at)
VALUES
  ('${id.userB}', '${id.tenantA}', '${id.siteA}', 'admin.a.example.test', repeat('7', 64),
   '2030-01-01T00:00:00Z');
COMMIT;`,
    'sessions_membership_scope_fk',
    'auth role cannot create a customer session for an identity without same-scope membership',
  );
  expectFailure(
    `INSERT INTO domain_operations
      (tenant_id, site_id, domain_id, actor_id, idempotency_key, operation,
       dry_run, proposed_changes, outcome)
     VALUES
      ('${id.tenantA}', '${id.siteA}', '${id.domainSister}', '${id.userA}', 'cross-domain',
       'dns_plan', true, '{}', 'planned');`,
    'domain_operations_domain_scope_fk',
    'domain operation cannot reference a sister-site domain',
  );
  expectFailure(
    `INSERT INTO job_runs
      (tenant_id, site_id, job_id, attempt, state, started_at)
     VALUES
      ('${id.tenantA}', '${id.siteA}', '${id.jobSister}', 1, 'running', now());`,
    'job_runs_job_scope_fk',
    'job run cannot reference a sister-site job',
  );
  expectFailure(
    `INSERT INTO ai_reservations
      (tenant_id, site_id, period_id, amount_usd_micros, state, expires_at)
     VALUES
      ('${id.tenantA}', '${id.siteA}', '${id.periodSister}', 1000, 'active', '2030-01-01T00:00:00Z');`,
    'ai_reservations_period_scope_fk',
    'AI reservation cannot reference a sister-site period',
  );
  expectFailure(
    `INSERT INTO content_proposals
      (tenant_id, site_id, field_id, base_revision, state, proposed_value,
       policy_version, publication_request_id)
     VALUES
      ('${id.tenantA}', '${id.siteA}', '${id.fieldA}', 1, 'applied', '"safe"', 1,
       '${id.publicationSister}');`,
    'content_proposals_publication_scope_fk',
    'content proposal cannot reference a sister-site publication',
  );
  expectFailure(
    `INSERT INTO metric_snapshots
      (tenant_id, site_id, connection_id, source, metric, dimensions,
       window_start, window_end, value, source_hash, ingested_at, expires_at)
     VALUES
      ('${id.tenantA}', '${id.siteA}', '${id.connectionSister}', 'ga4', 'sessions', '{}',
       '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', 1, repeat('9', 64), now(),
       '2030-01-01T00:00:00Z');`,
    'metric_snapshots_connection_scope_fk',
    'metric snapshot cannot reference a sister-site connection',
  );
}

function verifyHostnameReservation() {
  psql(
    `INSERT INTO platform_reserved_hostnames (purpose, hostname)
     VALUES ('orap', 'admin.control.example.test');`,
    'configure verifier-only ORAP hostname reservation',
  );
  expectFailure(
    `INSERT INTO domains (tenant_id, site_id, hostname, kind)
     VALUES ('${id.tenantA}', '${id.siteA}', 'admin.control.example.test', 'admin');`,
    'hostname is reserved for the platform control plane',
    'customer domain cannot claim configured ORAP hostname',
  );
  expectFailure(
    `UPDATE platform_reserved_hostnames
        SET hostname = 'admin.a.example.test'
      WHERE purpose = 'orap';`,
    'reserved hostname is already assigned to a customer site',
    'ORAP reservation cannot claim an existing customer hostname',
  );
}

try {
  startPostgres();
  installMigrations();
  seedFixtures();
  verifyCatalog();
  verifyRuntimeIsolation();
  verifyNegativeConstraints();
  verifyHostnameReservation();
  console.log(
    'G06 isolation hardening verified: restricted login, exact-site RLS, least privileges, same-scope FKs, GUC cleanup, and hostname reservation all passed.',
  );
} finally {
  cleanup();
}
