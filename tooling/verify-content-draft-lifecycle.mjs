#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsRoot = join(repositoryRoot, 'packages', 'database', 'prisma', 'migrations');
const targetMigration = '20261011012000_content_draft_lifecycle';
const postgresImage =
  'postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297';
const runId = randomUUID().replaceAll('-', '');
const containerName = `omnireach-content-draft-${runId}`;
const verifierLabel = 'com.omnireach.content-draft-verifier';
const database = 'omnireach_content_draft_verify';
const databaseUser = 'omnireach_content_draft_verify';
const databasePassword = 'local-content-draft-verifier-only';

const ids = Object.freeze({
  activeDraft: '80000000-0000-4000-8000-000000000002',
  insertedDraft: '80000000-0000-4000-8000-000000000004',
  oldDraft: '80000000-0000-4000-8000-000000000001',
  otherDraft: '80000000-0000-4000-8000-000000000003',
  otherSite: '20000000-0000-4000-8000-000000000002',
  otherTenant: '10000000-0000-4000-8000-000000000002',
  otherUser: '40000000-0000-4000-8000-000000000002',
  site: '20000000-0000-4000-8000-000000000001',
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

function roleScript(role, body, scope = ids) {
  return `
BEGIN;
SET LOCAL ROLE ${role};
SET LOCAL app.tenant_id = '${scope.tenant}';
SET LOCAL app.site_id = '${scope.site}';
SET LOCAL app.user_id = '${scope.user}';
${body}
COMMIT;
`;
}

function expectScalar(role, sql, expected, context, scope = ids) {
  const actual = psql(roleScript(role, `${sql};`, scope), context);
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
  return {
    before: migrations.slice(0, targetIndex),
    target: migrations[targetIndex],
  };
}

function cleanup() {
  if (!containerCreated) return;
  if (!/^omnireach-content-draft-[a-f0-9]{32}$/.test(containerName)) {
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

  let ready = false;
  let consecutiveReadyChecks = 0;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = run('docker', [
      'exec',
      containerName,
      'pg_isready',
      '--username',
      databaseUser,
      '--dbname',
      database,
    ]);
    if (result.status === 0) {
      consecutiveReadyChecks += 1;
      if (consecutiveReadyChecks >= 3) {
        ready = true;
        break;
      }
    } else {
      consecutiveReadyChecks = 0;
    }
    sleep(250);
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready');

  for (const migration of migrations.before) {
    psql(migration.sql, `Migration ${migration.name} failed`);
  }

  psql(
    `
INSERT INTO users (id, normalized_email, display_name) VALUES
  ('${ids.user}', 'draft-one@example.test', 'Draft One'),
  ('${ids.otherUser}', 'draft-two@example.test', 'Draft Two');
INSERT INTO tenants (id, name) VALUES
  ('${ids.tenant}', 'Draft Tenant One'),
  ('${ids.otherTenant}', 'Draft Tenant Two');
INSERT INTO sites (id, tenant_id, name) VALUES
  ('${ids.site}', '${ids.tenant}', 'Draft Site One'),
  ('${ids.otherSite}', '${ids.otherTenant}', 'Draft Site Two');
INSERT INTO content_revisions
  (tenant_id, site_id, revision, schema_version, content, facts_snapshot, created_by, origin)
VALUES
  ('${ids.tenant}', '${ids.site}', 1, 1, '{"home.heading":"Seed one"}', '{}', '${ids.user}', 'seed'),
  ('${ids.otherTenant}', '${ids.otherSite}', 1, 1, '{"home.heading":"Seed two"}', '{}', '${ids.otherUser}', 'seed');
INSERT INTO content_drafts
  (id, tenant_id, site_id, base_revision, version, content, created_by, created_at, updated_at)
VALUES
  ('${ids.oldDraft}', '${ids.tenant}', '${ids.site}', 1, 1, '{"home.heading":"Older"}', '${ids.user}', '2026-10-10T10:00:00Z', '2026-10-10T10:00:00Z'),
  ('${ids.activeDraft}', '${ids.tenant}', '${ids.site}', 1, 2, '{"home.heading":"Newest"}', '${ids.user}', '2026-10-10T11:00:00Z', '2026-10-10T11:00:00Z'),
  ('${ids.otherDraft}', '${ids.otherTenant}', '${ids.otherSite}', 1, 1, '{"home.heading":"Other tenant"}', '${ids.otherUser}', '2026-10-10T12:00:00Z', '2026-10-10T12:00:00Z');
`,
    'Pre-migration fixture creation failed',
  );

  psql(migrations.target.sql, `Migration ${migrations.target.name} failed`);

  psql(
    `
DO $$
DECLARE
  view_kind "char";
  draft_role record;
BEGIN
  SELECT relkind INTO view_kind FROM pg_class WHERE oid = 'public.content_drafts'::regclass;
  IF view_kind <> 'v' THEN RAISE EXCEPTION 'content_drafts is not a view'; END IF;
  IF to_regclass('public.content_draft_records') IS NULL THEN
    RAISE EXCEPTION 'content_draft_records is missing';
  END IF;
  IF (SELECT count(*) FROM content_draft_records) <> 3 THEN
    RAISE EXCEPTION 'base draft count mismatch';
  END IF;
  IF (SELECT count(*) FROM content_draft_records WHERE state = 'active') <> 2 THEN
    RAISE EXCEPTION 'active draft count mismatch';
  END IF;
  IF (SELECT count(*) FROM content_draft_records WHERE state = 'archived') <> 1 THEN
    RAISE EXCEPTION 'duplicate draft was not archived';
  END IF;
  SELECT * INTO draft_role FROM pg_roles WHERE rolname = 'omnireach_draft_view';
  IF draft_role.rolsuper OR draft_role.rolcreaterole OR draft_role.rolcreatedb
     OR draft_role.rolcanlogin OR draft_role.rolbypassrls OR draft_role.rolinherit THEN
    RAISE EXCEPTION 'draft view role is over-privileged';
  END IF;
  IF has_table_privilege('omnireach_app', 'content_draft_records', 'SELECT')
     OR has_table_privilege('omnireach_worker', 'content_draft_records', 'SELECT') THEN
    RAISE EXCEPTION 'application roles retain base-table access';
  END IF;
  IF NOT has_table_privilege('omnireach_app', 'content_drafts', 'SELECT,INSERT,UPDATE')
     OR has_table_privilege('omnireach_app', 'content_drafts', 'DELETE') THEN
    RAISE EXCEPTION 'application view grants are invalid';
  END IF;
  IF NOT has_table_privilege('omnireach_worker', 'content_drafts', 'SELECT,INSERT,UPDATE')
     OR has_table_privilege('omnireach_worker', 'content_drafts', 'DELETE') THEN
    RAISE EXCEPTION 'worker view grants are invalid';
  END IF;
  IF NOT (
    SELECT relrowsecurity AND relforcerowsecurity
      FROM pg_class WHERE oid = 'public.content_draft_records'::regclass
  ) THEN
    RAISE EXCEPTION 'base-table RLS is not forced';
  END IF;
END
$$;
`,
    'Relation, grant, and RLS assertions failed',
  );

  expectScalar(
    'omnireach_app',
    `SELECT id::text FROM content_drafts
      WHERE tenant_id = '${ids.tenant}' AND site_id = '${ids.site}'
      ORDER BY updated_at DESC LIMIT 1`,
    ids.activeDraft,
    'Legacy SELECT did not resolve the live draft',
  );
  expectScalar(
    'omnireach_app',
    `SELECT count(*)::text FROM content_drafts
      WHERE tenant_id = '${ids.otherTenant}' AND site_id = '${ids.otherSite}'`,
    '0',
    'View RLS exposed another tenant',
  );
  expectScalar(
    'omnireach_app',
    `SELECT state FROM content_drafts
      WHERE tenant_id = '${ids.tenant}' AND site_id = '${ids.site}'`,
    'active',
    'Lifecycle-aware SELECT could not read state',
  );
  expectScalar(
    'omnireach_app',
    `SELECT id::text FROM content_drafts
      WHERE tenant_id = '${ids.tenant}' AND site_id = '${ids.site}' FOR UPDATE`,
    ids.activeDraft,
    'Legacy SELECT FOR UPDATE failed',
  );
  expectScalar(
    'omnireach_worker',
    `SELECT id::text FROM content_drafts
      WHERE tenant_id = '${ids.tenant}' AND site_id = '${ids.site}'`,
    ids.activeDraft,
    'Worker SELECT through the compatibility view failed',
  );

  psqlFailure(
    roleScript(
      'omnireach_app',
      `UPDATE content_drafts
          SET state = 'archived', archived_at = now(), archive_reason = 'tampered',
              content = '{"home.heading":"Rewritten"}'
        WHERE id = '${ids.activeDraft}';`,
    ),
    'archiving cannot rewrite content draft evidence',
    'Archive evidence mutation was not rejected',
  );

  expectScalar(
    'omnireach_app',
    `UPDATE content_drafts
        SET state = 'archived', archived_at = now(), archive_reason = 'published', updated_at = now()
      WHERE tenant_id = '${ids.tenant}' AND site_id = '${ids.site}' AND id = '${ids.activeDraft}'
      RETURNING id::text`,
    ids.activeDraft,
    'Legitimate archive transition through the view failed',
  );
  expectScalar(
    'omnireach_app',
    `SELECT count(*)::text FROM content_drafts
      WHERE tenant_id = '${ids.tenant}' AND site_id = '${ids.site}'`,
    '0',
    'Archived drafts remained visible through the compatibility view',
  );
  expectScalar(
    'omnireach_app',
    `INSERT INTO content_drafts
       (id, tenant_id, site_id, base_revision, content, created_by)
     VALUES
       ('${ids.insertedDraft}', '${ids.tenant}', '${ids.site}', 1,
        '{"home.heading":"Parent insert"}', '${ids.user}')
     RETURNING id::text`,
    ids.insertedDraft,
    'Legacy INSERT through the compatibility view failed',
  );
  expectScalar(
    'omnireach_app',
    `UPDATE content_drafts
        SET content = '{"home.heading":"Parent update"}', version = 2, updated_at = now()
      WHERE tenant_id = '${ids.tenant}' AND site_id = '${ids.site}'
        AND id = '${ids.insertedDraft}' AND version = 1
      RETURNING version::text`,
    '2',
    'Legacy optimistic UPDATE through the compatibility view failed',
  );
  expectScalar(
    'omnireach_app',
    `SELECT version::text FROM content_drafts
      WHERE tenant_id = '${ids.tenant}' AND site_id = '${ids.site}'
        AND id = '${ids.insertedDraft}' FOR UPDATE`,
    '2',
    'Legacy publish SELECT FOR UPDATE failed after INSERT/UPDATE',
  );

  psqlFailure(
    roleScript('omnireach_app', 'SELECT count(*) FROM content_draft_records;'),
    'permission denied for table content_draft_records',
    'Direct application access to the retained base table was not revoked',
  );
  psqlFailure(
    roleScript('omnireach_app', `DELETE FROM content_drafts WHERE id = '${ids.insertedDraft}';`),
    'permission denied for view content_drafts',
    'Compatibility-view DELETE was not denied',
  );
  psqlFailure(
    roleScript(
      'omnireach_app',
      `INSERT INTO content_drafts
         (tenant_id, site_id, base_revision, content, created_by)
       VALUES
         ('${ids.otherTenant}', '${ids.otherSite}', 1, '{}', '${ids.otherUser}');`,
    ),
    'violates row-level security policy',
    'Cross-tenant INSERT through the compatibility view was not denied',
  );
  psqlFailure(
    roleScript(
      'omnireach_app',
      `INSERT INTO content_drafts
         (tenant_id, site_id, base_revision, content, created_by)
       VALUES
         ('${ids.tenant}', '${ids.site}', 1, '{}', '${ids.user}');`,
    ),
    'duplicate key value violates unique constraint "one_active_content_draft_per_site"',
    'The one-active-draft invariant was not enforced through the view',
  );

  const archivedEvidence = psql(
    `SELECT content ->> 'home.heading'
       FROM content_draft_records WHERE id = '${ids.activeDraft}';`,
    'Archived evidence check failed',
  );
  if (archivedEvidence !== 'Newest') {
    throw new Error(`Archived evidence was rewritten: ${JSON.stringify(archivedEvidence)}`);
  }

  process.stdout.write(
    'Verified content-draft migration compatibility, updatable view operations, archive immutability, grants, and forced RLS.\n',
  );
} finally {
  cleanup();
}
