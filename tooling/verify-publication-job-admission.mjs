#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsRoot = join(repositoryRoot, 'packages', 'database', 'prisma', 'migrations');
const targetMigration = '20261011014000_publication_job_admission';
const postgresImage =
  'postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297';
const runId = randomUUID().replaceAll('-', '');
const containerName = `omnireach-publication-job-${runId}`;
const verifierLabel = 'com.omnireach.publication-job-verifier';
const database = 'omnireach_publication_job_verify';
const databaseUser = 'omnireach_publication_job_verify';
const databasePassword = 'local-publication-job-verifier-only';

const ids = Object.freeze({
  backfillRequest: '90000000-0000-4000-8000-000000000001',
  concurrentSite: '20000000-0000-4000-8000-000000000006',
  crossSite: '20000000-0000-4000-8000-000000000005',
  crossTenant: '10000000-0000-4000-8000-000000000002',
  crossUser: '40000000-0000-4000-8000-000000000002',
  oldRequest: '90000000-0000-4000-8000-000000000002',
  restoreRequest: '90000000-0000-4000-8000-000000000003',
  rollbackRequest: '90000000-0000-4000-8000-000000000004',
  rollbackSite: '20000000-0000-4000-8000-000000000004',
  site: '20000000-0000-4000-8000-000000000001',
  oldSite: '20000000-0000-4000-8000-000000000002',
  restoreSite: '20000000-0000-4000-8000-000000000003',
  tenant: '10000000-0000-4000-8000-000000000001',
  user: '40000000-0000-4000-8000-000000000001',
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

function psql(sql, context) {
  return runChecked(
    'docker',
    [
      'exec',
      '--interactive',
      containerName,
      'psql',
      '--no-psqlrc',
      '--set',
      'ON_ERROR_STOP=1',
      '--quiet',
      '--tuples-only',
      '--no-align',
      '--username',
      databaseUser,
      '--dbname',
      database,
    ],
    context,
    { input: sql },
  ).stdout.trim();
}

function psqlFailure(sql, expectedMessage, context) {
  const args = [
    'exec',
    '--interactive',
    containerName,
    'psql',
    '--no-psqlrc',
    '--set',
    'ON_ERROR_STOP=1',
    '--quiet',
    '--username',
    databaseUser,
    '--dbname',
    database,
  ];
  const result = run('docker', args, { input: sql });
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  if (result.status === 0) throw new Error(`${context}: SQL unexpectedly succeeded`);
  const details = `${result.stdout}\n${result.stderr}`;
  if (!details.includes(expectedMessage)) {
    throw failure(
      'docker',
      args,
      result,
      `${context}; expected ${JSON.stringify(expectedMessage)}`,
    );
  }
}

function psqlResultAsync(sql) {
  const args = [
    'exec',
    '--interactive',
    containerName,
    'psql',
    '--no-psqlrc',
    '--set',
    'ON_ERROR_STOP=1',
    '--quiet',
    '--username',
    databaseUser,
    '--dbname',
    database,
  ];

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('docker', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      rejectPromise(error);
    });
    child.on('close', (status) => {
      resolvePromise({ args, status, stdout, stderr });
    });
    child.stdin.end(sql);
  });
}

async function psqlAsync(sql, context) {
  let result;
  try {
    result = await psqlResultAsync(sql);
  } catch (error) {
    throw new Error(`${context}: ${error.message}`, { cause: error });
  }
  if (result.status !== 0) throw failure('docker', result.args, result, context);
  return result.stdout.trim();
}

async function psqlFailureAsync(sql, expectedMessage, context) {
  let result;
  try {
    result = await psqlResultAsync(sql);
  } catch (error) {
    throw new Error(`${context}: ${error.message}`, { cause: error });
  }
  if (result.status === 0) throw new Error(`${context}: SQL unexpectedly succeeded`);
  const details = `${result.stdout}\n${result.stderr}`;
  if (!details.includes(expectedMessage)) {
    throw failure(
      'docker',
      result.args,
      result,
      `${context}; expected ${JSON.stringify(expectedMessage)}`,
    );
  }
}

function roleScript(body, scope = { site: ids.oldSite, tenant: ids.tenant, user: ids.user }) {
  return `
BEGIN;
SET LOCAL ROLE omnireach_app;
SET LOCAL app.tenant_id = '${scope.tenant}';
SET LOCAL app.site_id = '${scope.site}';
SET LOCAL app.user_id = '${scope.user}';
${body}
COMMIT;
`;
}

function expectScalar(sql, expected, context) {
  const actual = psql(sql, context);
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
  return { before: migrations.slice(0, targetIndex), target: migrations[targetIndex] };
}

function publicationInsert({ id, idempotencyKey, origin, siteId, traceId }) {
  return `INSERT INTO publication_requests
    (id, tenant_id, site_id, idempotency_key, requested_by, origin, reason,
     content_revision, status${traceId ? ', trace_id' : ''})
   VALUES
    ('${id}', '${ids.tenant}', '${siteId}', '${idempotencyKey}', '${ids.user}',
     '${origin}', 'Approved verifier publication', 1, 'queued'${traceId ? `, '${traceId}'` : ''});`;
}

function cleanup() {
  if (!containerCreated) return;
  if (!/^omnireach-publication-job-[a-f0-9]{32}$/.test(containerName)) {
    throw new Error(`Refusing cleanup for unexpected container name: ${containerName}`);
  }
  const label = run('docker', [
    'container',
    'inspect',
    '--format',
    `{{ index .Config.Labels "${verifierLabel}" }}`,
    containerName,
  ]);
  if (label.status !== 0 || label.stdout.trim() !== runId) {
    throw new Error(`Refusing cleanup for a container without this verifier's ownership label`);
  }
  const removed = run('docker', ['container', 'rm', '--force', '--volumes', containerName]);
  if (removed.status !== 0) {
    throw failure(
      'docker',
      ['container', 'rm', '--force', '--volumes', containerName],
      removed,
      'Verifier cleanup failed',
    );
  }
  containerCreated = false;
}

try {
  runChecked(
    'docker',
    ['version', '--format', '{{.Server.Version}}'],
    'Docker with a reachable daemon is required',
  );
  const migrations = migrationsThroughTarget();
  runChecked(
    'docker',
    [
      'run',
      '--detach',
      '--name',
      containerName,
      '--label',
      `${verifierLabel}=${runId}`,
      '--network',
      'none',
      '--env',
      `POSTGRES_DB=${database}`,
      '--env',
      `POSTGRES_USER=${databaseUser}`,
      '--env',
      `POSTGRES_PASSWORD=${databasePassword}`,
      postgresImage,
    ],
    'Disposable PostgreSQL startup failed',
  );
  containerCreated = true;

  let readyStreak = 0;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const result = run('docker', [
      'exec',
      containerName,
      'pg_isready',
      '--username',
      databaseUser,
      '--dbname',
      database,
    ]);
    readyStreak = result.status === 0 ? readyStreak + 1 : 0;
    // The official image briefly accepts connections during initialization and
    // then restarts PostgreSQL. Wait for the durable server, not that transient one.
    if (readyStreak >= 10) break;
    sleep(500);
  }
  if (readyStreak < 10) throw new Error('Disposable PostgreSQL did not become ready');

  for (const migration of migrations.before) {
    psql(migration.sql, `Migration ${migration.name} failed`);
  }

  psql(
    `
INSERT INTO users (id, normalized_email, display_name) VALUES
  ('${ids.user}', 'publication-one@example.test', 'Publication One'),
  ('${ids.crossUser}', 'publication-two@example.test', 'Publication Two');
INSERT INTO tenants (id, name) VALUES
  ('${ids.tenant}', 'Publication Tenant One'),
  ('${ids.crossTenant}', 'Publication Tenant Two');
INSERT INTO sites (id, tenant_id, name) VALUES
  ('${ids.site}', '${ids.tenant}', 'Backfill Site'),
  ('${ids.oldSite}', '${ids.tenant}', 'Old Binary Site'),
  ('${ids.restoreSite}', '${ids.tenant}', 'Restore Site'),
  ('${ids.rollbackSite}', '${ids.tenant}', 'Rollback Site'),
  ('${ids.concurrentSite}', '${ids.tenant}', 'Concurrent Admission Site'),
  ('${ids.crossSite}', '${ids.crossTenant}', 'Cross Tenant Site');
INSERT INTO publication_requests
  (id, tenant_id, site_id, idempotency_key, requested_by, origin, reason,
   content_revision, status)
VALUES
  ('${ids.backfillRequest}', '${ids.tenant}', '${ids.site}', 'backfill-publish',
   '${ids.user}', 'customer', 'Queued before admission migration', 1, 'queued');
`,
    'Pre-migration fixture creation failed',
  );

  psql(migrations.target.sql, `Migration ${migrations.target.name} failed`);

  expectScalar(
    `SELECT count(*)::text
       FROM publication_requests request
       JOIN jobs job ON job.id = request.job_id
      WHERE request.id = '${ids.backfillRequest}'
        AND job.tenant_id = request.tenant_id AND job.site_id = request.site_id
        AND job.category = 'publish' AND job.record_id = request.id
        AND job.dedupe_key = request.idempotency_key AND job.trace_id = request.trace_id
        AND job.state = 'queued' AND job.schema_version = 1
        AND job.policy_version = 1 AND job.attempt_limit = 3
        AND job.audit_referenced AND job.expires_at >= now() + interval '23 hours'`,
    '1',
    'Queued request backfill did not create the exact durable job',
  );

  psql(
    roleScript(
      publicationInsert({
        id: ids.oldRequest,
        idempotencyKey: 'old-binary-publish',
        origin: 'customer',
        siteId: ids.oldSite,
      }),
    ),
    'Prior application insert shape failed',
  );
  expectScalar(
    `SELECT count(*)::text
       FROM publication_requests request
       JOIN jobs job ON job.id = request.job_id
      WHERE request.id = '${ids.oldRequest}'
        AND length(request.trace_id) = 32
        AND job.tenant_id = request.tenant_id AND job.site_id = request.site_id
        AND job.category = 'publish' AND job.record_id = request.id
        AND job.dedupe_key = request.idempotency_key AND job.trace_id = request.trace_id`,
    '1',
    'Prior application insert did not receive one exact linked job',
  );

  expectScalar(
    roleScript(
      `WITH attempted AS (
         INSERT INTO publication_requests
           (tenant_id, site_id, idempotency_key, requested_by, origin, reason,
            content_revision, status, trace_id)
         VALUES
           ('${ids.tenant}', '${ids.oldSite}', 'old-binary-publish', '${ids.user}',
            'customer', 'Publisher begin compatibility check', 1, 'building',
            'publisher_begin_trace_12345')
         ON CONFLICT (tenant_id, site_id, idempotency_key) DO NOTHING
         RETURNING id
       )
       SELECT count(*)::text FROM attempted;`,
    ),
    '0',
    'Publisher begin could not reach its existing-request conflict handler',
  );
  expectScalar(
    `SELECT concat(
       (SELECT count(*) FROM publication_requests WHERE site_id = '${ids.oldSite}'), ':',
       (SELECT count(*) FROM jobs WHERE site_id = '${ids.oldSite}' AND category = 'publish')
     )`,
    '1:1',
    'Publisher begin compatibility path changed durable admission state',
  );

  const restoreTrace = 'trace_restore_publication_1234';
  psql(
    roleScript(
      publicationInsert({
        id: ids.restoreRequest,
        idempotencyKey: 'restore-publish',
        origin: 'restore',
        siteId: ids.restoreSite,
        traceId: restoreTrace,
      }),
      { site: ids.restoreSite, tenant: ids.tenant, user: ids.user },
    ),
    'Trace-aware restore insert failed',
  );
  expectScalar(
    `SELECT count(*)::text
       FROM publication_requests request
       JOIN jobs job ON job.id = request.job_id
      WHERE request.id = '${ids.restoreRequest}'
        AND request.origin = 'restore' AND request.trace_id = '${restoreTrace}'
        AND job.trace_id = '${restoreTrace}' AND job.record_id = request.id`,
    '1',
    'Restore request did not preserve its trace in the durable job',
  );

  await psqlFailureAsync(
    roleScript(
      publicationInsert({
        id: '90000000-0000-4000-8000-000000000099',
        idempotencyKey: 'old-binary-publish',
        origin: 'customer',
        siteId: ids.oldSite,
      }),
    ),
    'duplicate key value violates unique constraint',
    'Duplicate idempotency key did not fail closed',
  );
  expectScalar(
    `SELECT concat(
       (SELECT count(*) FROM publication_requests WHERE site_id = '${ids.oldSite}'), ':',
       (SELECT count(*) FROM jobs WHERE site_id = '${ids.oldSite}' AND category = 'publish')
     )`,
    '1:1',
    'Duplicate request left duplicate durable state',
  );

  const concurrentWinnerId = '90000000-0000-4000-8000-000000000094';
  const concurrentLoserId = '90000000-0000-4000-8000-000000000093';
  const concurrentKey = 'concurrent-publish';
  const concurrentWinner = psqlAsync(
    `SET application_name = 'omnireach_publication_admission_winner';
BEGIN;
SET LOCAL ROLE omnireach_app;
SET LOCAL app.tenant_id = '${ids.tenant}';
SET LOCAL app.site_id = '${ids.concurrentSite}';
SET LOCAL app.user_id = '${ids.user}';
${publicationInsert({
  id: concurrentWinnerId,
  idempotencyKey: concurrentKey,
  origin: 'customer',
  siteId: ids.concurrentSite,
  traceId: 'concurrent_winner_trace_1234',
})}
SELECT pg_sleep(5);
COMMIT;`,
    'Concurrent admission winner failed',
  );

  let concurrentWinnerSleeping = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const sleeping = psql(
      `SELECT count(*)::text
         FROM pg_stat_activity
        WHERE application_name = 'omnireach_publication_admission_winner'
          AND state = 'active'
          AND query LIKE '%pg_sleep%';`,
      'Concurrent admission synchronization failed',
    );
    if (sleeping === '1') {
      concurrentWinnerSleeping = true;
      break;
    }
    sleep(100);
  }
  if (!concurrentWinnerSleeping) {
    await concurrentWinner;
    throw new Error('Concurrent admission winner did not reach its transaction hold point');
  }

  await psqlFailureAsync(
    roleScript(
      publicationInsert({
        id: concurrentLoserId,
        idempotencyKey: concurrentKey,
        origin: 'customer',
        siteId: ids.concurrentSite,
        traceId: 'concurrent_loser_trace_12345',
      }),
      { site: ids.concurrentSite, tenant: ids.tenant, user: ids.user },
    ),
    'publication job identity conflicts with an existing durable job',
    'Concurrent duplicate admission did not fail closed',
  );
  await concurrentWinner;
  expectScalar(
    `SELECT concat(
       (SELECT count(*) FROM publication_requests
         WHERE tenant_id = '${ids.tenant}' AND site_id = '${ids.concurrentSite}'
           AND idempotency_key = '${concurrentKey}'), ':',
       (SELECT count(*) FROM jobs
         WHERE tenant_id = '${ids.tenant}' AND site_id = '${ids.concurrentSite}'
           AND category = 'publish' AND dedupe_key = '${concurrentKey}')
     )`,
    '1:1',
    'Concurrent duplicate admission left more than one request or durable job',
  );

  psqlFailure(
    roleScript(
      publicationInsert({
        id: '90000000-0000-4000-8000-000000000097',
        idempotencyKey: 'hostile-trace-publish',
        origin: 'customer',
        siteId: ids.rollbackSite,
        traceId: 'bad trace',
      }),
      { site: ids.rollbackSite, tenant: ids.tenant, user: ids.user },
    ),
    'publication_trace_id_envelope_safe',
    'Queue-envelope-unsafe publication trace was accepted',
  );
  expectScalar(
    `SELECT concat(
       (SELECT count(*) FROM publication_requests
         WHERE id = '90000000-0000-4000-8000-000000000097'), ':',
       (SELECT count(*) FROM jobs
         WHERE record_id = '90000000-0000-4000-8000-000000000097')
     )`,
    '0:0',
    'Rejected hostile trace left request or job state',
  );

  psql(
    roleScript(
      `INSERT INTO jobs
        (tenant_id, site_id, category, schema_version, record_id, dedupe_key, trace_id,
         state, policy_version, attempt_limit, expires_at)
       VALUES
        ('${ids.tenant}', '${ids.rollbackSite}', 'publish', 1,
         '90000000-0000-4000-8000-000000000096', 'orphan-collision',
         'orphan_collision_trace_1234', 'queued', 1, 3, now() + interval '24 hours');`,
      { site: ids.rollbackSite, tenant: ids.tenant, user: ids.user },
    ),
    'Orphan collision fixture creation failed',
  );
  psqlFailure(
    roleScript(
      publicationInsert({
        id: '90000000-0000-4000-8000-000000000095',
        idempotencyKey: 'orphan-collision',
        origin: 'customer',
        siteId: ids.rollbackSite,
        traceId: 'request_collision_trace_123',
      }),
      { site: ids.rollbackSite, tenant: ids.tenant, user: ids.user },
    ),
    'publication job identity conflicts with an existing durable job',
    'Unrelated durable job collision did not fail closed',
  );
  expectScalar(
    `SELECT count(*)::text FROM publication_requests
      WHERE id = '90000000-0000-4000-8000-000000000095'`,
    '0',
    'Job collision admitted a publication request',
  );

  psql(
    roleScript(
      publicationInsert({
        id: ids.rollbackRequest,
        idempotencyKey: 'rolled-back-publish',
        origin: 'customer',
        siteId: ids.rollbackSite,
      }),
      { site: ids.rollbackSite, tenant: ids.tenant, user: ids.user },
    ).replace(/\nCOMMIT;\n$/u, '\nROLLBACK;\n'),
    'Publication rollback transaction failed',
  );
  expectScalar(
    `SELECT concat(
       (SELECT count(*) FROM publication_requests WHERE id = '${ids.rollbackRequest}'), ':',
       (SELECT count(*) FROM jobs WHERE record_id = '${ids.rollbackRequest}')
     )`,
    '0:0',
    'Request rollback did not remove its trigger-admitted job',
  );

  psqlFailure(
    roleScript(
      `INSERT INTO publication_requests
        (id, tenant_id, site_id, idempotency_key, requested_by, origin, reason,
         content_revision, status)
       VALUES
        ('90000000-0000-4000-8000-000000000098', '${ids.crossTenant}', '${ids.crossSite}',
         'cross-tenant-publish', '${ids.crossUser}', 'customer', 'Forbidden', 1, 'queued');`,
    ),
    'row-level security',
    'Cross-tenant admission did not fail under RLS',
  );
  expectScalar(
    `SELECT concat(
       (SELECT count(*) FROM publication_requests WHERE id = '90000000-0000-4000-8000-000000000098'), ':',
       (SELECT count(*) FROM jobs WHERE record_id = '90000000-0000-4000-8000-000000000098')
     )`,
    '0:0',
    'Rejected cross-tenant admission left durable state',
  );

  psqlFailure(
    roleScript(
      `UPDATE publication_requests SET trace_id = 'tampered_trace_identifier'
        WHERE id = '${ids.oldRequest}';`,
    ),
    'publication job link is immutable',
    'Publication identity mutation was not rejected',
  );
  psqlFailure(
    roleScript(
      `UPDATE jobs SET record_id = gen_random_uuid()
        WHERE id = (SELECT job_id FROM publication_requests WHERE id = '${ids.oldRequest}');`,
    ),
    'linked publication job identity is immutable',
    'Linked job identity mutation was not rejected',
  );

  process.stdout.write(
    'Verified atomic publication/job admission, backfill, old/new insert compatibility, dedupe, rollback, identity guards, and tenant RLS.\n',
  );
} finally {
  cleanup();
}
