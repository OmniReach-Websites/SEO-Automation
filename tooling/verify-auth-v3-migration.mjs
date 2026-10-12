#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsRoot = join(repositoryRoot, 'packages', 'database', 'prisma', 'migrations');
const postgresImage =
  'postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297';
const databaseName = 'omnireach_g06_verify';
const databaseUser = 'omnireach_g06_verify';
const databasePassword = 'local-g06-verifier-only';
const resourcePrefix = 'omnireach-g06-auth-v3-';
const verifierLabel = 'com.omnireach.g06-auth-v3-verifier';
const authV3MigrationName = '20261011013000_g05_webauthn_credentials';
const authV2MigrationNames = [
  '20261010250000_g05_account_authentication_policy',
  '20261010250500_g05_password_recovery_outbox',
];

const fixture = Object.freeze({
  tenant: '10000000-0000-4000-8000-000000000001',
  otherTenant: '10000000-0000-4000-8000-000000000002',
  site: '20000000-0000-4000-8000-000000000001',
  otherSite: '20000000-0000-4000-8000-000000000002',
  platformTotpUser: '30000000-0000-4000-8000-000000000001',
  platformEmailUser: '30000000-0000-4000-8000-000000000002',
  customerBasicUser: '30000000-0000-4000-8000-000000000003',
  customerTotpUser: '30000000-0000-4000-8000-000000000004',
  platformFactor: '40000000-0000-4000-8000-000000000001',
  customerFactor: '40000000-0000-4000-8000-000000000002',
  revokedFactor: '40000000-0000-4000-8000-000000000003',
  platformUnusedCode: '50000000-0000-4000-8000-000000000001',
  platformUsedCode: '50000000-0000-4000-8000-000000000002',
  revokedFactorCode: '50000000-0000-4000-8000-000000000003',
  platformTotpSession: '60000000-0000-4000-8000-000000000001',
  platformEmailSession: '60000000-0000-4000-8000-000000000002',
  customerBasicSession: '60000000-0000-4000-8000-000000000003',
  customerTotpSession: '60000000-0000-4000-8000-000000000004',
  legacyRecoveryToken: '70000000-0000-4000-8000-000000000001',
  webAuthnScope: '80000000-0000-4000-8000-000000000001',
  webAuthnCredential: '90000000-0000-4000-8000-000000000001',
  webAuthnDeleteGuardUser: '30000000-0000-4000-8000-000000000099',
  webAuthnDeleteGuardScope: '80000000-0000-4000-8000-000000000099',
});

const activeResources = new Set();

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
}

function commandFailure(command, args, result, context) {
  const details = [result.stdout, result.stderr]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join('\n');
  const suffix = details ? `\n${details}` : '';
  return new Error(
    `${context}: ${command} ${args.join(' ')} exited with ${result.status ?? 'no status'}${suffix}`,
  );
}

function runChecked(command, args, context, options = {}) {
  const result = run(command, args, options);
  if (result.error) {
    throw new Error(`${context}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw commandFailure(command, args, result, context);
  }
  return result;
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function assertDockerAvailable() {
  const result = run('docker', ['version', '--format', '{{.Server.Version}}']).status;
  if (result !== 0) {
    throw new Error(
      'Docker with a reachable daemon is required; no database or existing Docker resource was changed.',
    );
  }
}

function discoverMigrations() {
  const migrations = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: join(migrationsRoot, entry.name, 'migration.sql'),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  if (migrations.length === 0) {
    throw new Error('No database migrations were discovered.');
  }
  for (const migration of migrations) {
    if (!/^\d{14}_[a-z0-9_]+$/.test(migration.name)) {
      throw new Error(`Unexpected migration directory name: ${migration.name}`);
    }
    readFileSync(migration.path, 'utf8');
  }
  for (const requiredName of authV2MigrationNames) {
    if (!migrations.some((migration) => migration.name === requiredName)) {
      throw new Error(`Required Auth Contract v2 migration is missing: ${requiredName}`);
    }
  }
  if (!migrations.some((migration) => migration.name === authV3MigrationName)) {
    throw new Error(`Required Auth Contract v3 migration is missing: ${authV3MigrationName}`);
  }
  const firstV2Index = migrations.findIndex(
    (migration) => migration.name === authV2MigrationNames[0],
  );
  const secondV2Index = migrations.findIndex(
    (migration) => migration.name === authV2MigrationNames[1],
  );
  if (secondV2Index <= firstV2Index) {
    throw new Error('Auth Contract v2 migration ordering is invalid.');
  }
  const v3Index = migrations.findIndex((migration) => migration.name === authV3MigrationName);
  const priorHeadIndex = migrations.findIndex(
    (migration) => migration.name === '20261011012000_content_draft_lifecycle',
  );
  if (v3Index <= priorHeadIndex || priorHeadIndex < 0) {
    throw new Error('Auth Contract v3 migration must follow 20261011012000.');
  }

  return {
    all: migrations,
    preV2: migrations.slice(0, firstV2Index),
    authV2: authV2MigrationNames.map((name) =>
      migrations.find((migration) => migration.name === name),
    ),
    postV2: migrations.filter(
      (migration, index) => index > firstV2Index && !authV2MigrationNames.includes(migration.name),
    ),
  };
}

function dockerObjectExists(kind, name) {
  const noun = kind === 'container' ? 'container' : 'volume';
  return run('docker', [noun, 'inspect', name]).status === 0;
}

function allocateResource(label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const runId = randomUUID().replaceAll('-', '');
    const containerName = `${resourcePrefix}${label}-${runId}`;
    const volumeName = `${containerName}-data`;
    if (
      !dockerObjectExists('container', containerName) &&
      !dockerObjectExists('volume', volumeName)
    ) {
      return {
        label,
        runId,
        containerName,
        volumeName,
        containerCreated: false,
        volumeCreated: false,
        cleaned: false,
      };
    }
  }
  throw new Error(`Could not allocate unique Docker names for ${label}.`);
}

function validateOwnedName(resource, name) {
  const expectedPrefix = `${resourcePrefix}${resource.label}-${resource.runId}`;
  if (
    !name.startsWith(expectedPrefix) ||
    !/^omnireach-g06-auth-v3-[a-z]+-[a-f0-9]{32}(?:-data)?$/.test(name)
  ) {
    throw new Error(`Refusing cleanup for unexpected Docker resource name: ${name}`);
  }
}

function inspectLabel(kind, name) {
  const format =
    kind === 'container'
      ? `{{ index .Config.Labels "${verifierLabel}" }}`
      : `{{ index .Labels "${verifierLabel}" }}`;
  const noun = kind === 'container' ? 'container' : 'volume';
  const result = run('docker', [noun, 'inspect', '--format', format, name]);
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function cleanupResource(resource) {
  if (resource.cleaned) return [];
  const errors = [];

  if (resource.containerCreated) {
    try {
      validateOwnedName(resource, resource.containerName);
      const label = inspectLabel('container', resource.containerName);
      if (label === resource.runId) {
        const result = run('docker', [
          'container',
          'rm',
          '--force',
          '--volumes',
          resource.containerName,
        ]);
        if (result.status !== 0) {
          errors.push(
            commandFailure(
              'docker',
              ['container', 'rm', '--force', '--volumes', resource.containerName],
              result,
              'Container cleanup failed',
            ).message,
          );
        }
      } else if (label !== null) {
        errors.push(
          `Refused to remove container with a foreign verifier label: ${resource.containerName}`,
        );
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (resource.volumeCreated) {
    try {
      validateOwnedName(resource, resource.volumeName);
      const label = inspectLabel('volume', resource.volumeName);
      if (label === resource.runId) {
        const result = run('docker', ['volume', 'rm', resource.volumeName]);
        if (result.status !== 0) {
          errors.push(
            commandFailure(
              'docker',
              ['volume', 'rm', resource.volumeName],
              result,
              'Volume cleanup failed',
            ).message,
          );
        }
      } else if (label !== null) {
        errors.push(
          `Refused to remove volume with a foreign verifier label: ${resource.volumeName}`,
        );
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  resource.cleaned = errors.length === 0;
  if (resource.cleaned) activeResources.delete(resource);
  return errors;
}

function startPostgres(resource) {
  validateOwnedName(resource, resource.containerName);
  validateOwnedName(resource, resource.volumeName);

  runChecked(
    'docker',
    ['volume', 'create', '--label', `${verifierLabel}=${resource.runId}`, resource.volumeName],
    'Could not create verifier volume',
  );
  resource.volumeCreated = true;
  activeResources.add(resource);

  runChecked(
    'docker',
    [
      'run',
      '--detach',
      '--name',
      resource.containerName,
      '--label',
      `${verifierLabel}=${resource.runId}`,
      '--network',
      'none',
      '--mount',
      `type=volume,source=${resource.volumeName},target=/var/lib/postgresql/data`,
      '--env',
      `POSTGRES_DB=${databaseName}`,
      '--env',
      `POSTGRES_USER=${databaseUser}`,
      '--env',
      `POSTGRES_PASSWORD=${databasePassword}`,
      postgresImage,
    ],
    'Could not start verifier PostgreSQL',
  );
  resource.containerCreated = true;

  let readyStreak = 0;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const ready = run('docker', [
      'exec',
      resource.containerName,
      'pg_isready',
      '--username',
      databaseUser,
      '--dbname',
      databaseName,
    ]);
    readyStreak = ready.status === 0 ? readyStreak + 1 : 0;
    // The official image briefly accepts connections on its initialization server,
    // stops it, and then starts the durable server. Requiring a stable streak avoids
    // sending the first migration into that intentional shutdown window.
    if (readyStreak >= 10) return;
    sleep(500);
  }

  const logs = run('docker', ['logs', resource.containerName]);
  throw new Error(
    `Verifier PostgreSQL did not become ready.\n${logs.stdout ?? ''}\n${logs.stderr ?? ''}`,
  );
}

function psql(resource, sql, context, { expectFailure = false } = {}) {
  const args = [
    'exec',
    '--interactive',
    resource.containerName,
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
    databaseName,
  ];
  const result = run('docker', args, { input: sql });
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  if (expectFailure) {
    if (result.status === 0) {
      throw new Error(`${context}: the statement unexpectedly succeeded.`);
    }
    return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  }
  if (result.status !== 0) {
    throw commandFailure('docker', args, result, context);
  }
  return result.stdout.trim();
}

function applyMigrations(resource, migrations) {
  for (const migration of migrations) {
    process.stderr.write(`[g06-auth-v3] ${resource.label}: applying ${migration.name}\n`);
    psql(resource, readFileSync(migration.path, 'utf8'), `Migration failed: ${migration.name}`);
  }
}

function expectSqlFailure(resource, sql, expectedPattern, context) {
  const output = psql(resource, sql, context, { expectFailure: true });
  if (!expectedPattern.test(output)) {
    throw new Error(`${context}: failed for an unexpected reason.\n${output.trim()}`);
  }
}

function assertScalar(resource, sql, expected, context) {
  const actual = psql(resource, sql, context);
  if (actual !== String(expected)) {
    throw new Error(
      `${context}: expected ${JSON.stringify(String(expected))}, got ${JSON.stringify(actual)}.`,
    );
  }
}

function seedLegacyFixtures(resource) {
  psql(
    resource,
    `
INSERT INTO tenants (id, name) VALUES
  ('${fixture.tenant}', 'Fictional Customer Tenant'),
  ('${fixture.otherTenant}', 'Fictional Neighbor Tenant');

INSERT INTO sites (id, tenant_id, name) VALUES
  ('${fixture.site}', '${fixture.tenant}', 'Fictional Customer Site'),
  ('${fixture.otherSite}', '${fixture.otherTenant}', 'Fictional Neighbor Site');

INSERT INTO domains
  (id, tenant_id, site_id, hostname, kind, verification_status, active, onboarding_state)
VALUES
  ('21000000-0000-4000-8000-000000000001', '${fixture.tenant}', '${fixture.site}',
   'admin.customer.example', 'admin', 'verified', true, 'active'),
  ('21000000-0000-4000-8000-000000000002', '${fixture.otherTenant}', '${fixture.otherSite}',
   'admin.neighbor.example', 'admin', 'verified', true, 'active');

INSERT INTO users (id, normalized_email, display_name) VALUES
  ('${fixture.platformTotpUser}', 'platform.totp@example.invalid', 'Fictional Platform TOTP'),
  ('${fixture.platformEmailUser}', 'platform.email@example.invalid', 'Fictional Platform Email'),
  ('${fixture.customerBasicUser}', 'customer.basic@example.invalid', 'Fictional Customer Basic'),
  ('${fixture.customerTotpUser}', 'customer.totp@example.invalid', 'Fictional Customer TOTP');

INSERT INTO credentials (user_id, password_hash) VALUES
  ('${fixture.platformTotpUser}', 'fictional-hash-platform-totp'),
  ('${fixture.platformEmailUser}', 'fictional-hash-platform-email'),
  ('${fixture.customerBasicUser}', 'fictional-hash-customer-basic'),
  ('${fixture.customerTotpUser}', 'fictional-hash-customer-totp');

INSERT INTO platform_memberships (user_id, role, active) VALUES
  ('${fixture.platformTotpUser}', 'platform_owner', true),
  ('${fixture.platformEmailUser}', 'platform_admin', true);

INSERT INTO memberships (tenant_id, site_id, user_id, role, active) VALUES
  ('${fixture.tenant}', '${fixture.site}', '${fixture.customerBasicUser}', 'customer_owner', true),
  ('${fixture.tenant}', '${fixture.site}', '${fixture.customerTotpUser}', 'customer_editor', true);

INSERT INTO mfa_factors
  (id, user_id, kind, encrypted_secret, key_version, verified_at, revoked_at)
VALUES
  ('${fixture.platformFactor}', '${fixture.platformTotpUser}', 'totp', decode(repeat('11', 32), 'hex'), 1,
   now() - interval '30 days', NULL),
  ('${fixture.customerFactor}', '${fixture.customerTotpUser}', 'totp', decode(repeat('22', 32), 'hex'), 1,
   now() - interval '20 days', NULL),
  ('${fixture.revokedFactor}', '${fixture.customerBasicUser}', 'totp', decode(repeat('33', 32), 'hex'), 1,
   now() - interval '10 days', now() - interval '5 days');

INSERT INTO mfa_recovery_codes (id, factor_id, code_hash, used_at) VALUES
  ('${fixture.platformUnusedCode}', '${fixture.platformFactor}', repeat('a', 64), NULL),
  ('${fixture.platformUsedCode}', '${fixture.platformFactor}', repeat('b', 64), now() - interval '2 days'),
  ('${fixture.revokedFactorCode}', '${fixture.revokedFactor}', repeat('c', 64), NULL);

INSERT INTO sessions
  (id, user_id, tenant_id, site_id, host, token_hash, expires_at, last_seen_at)
VALUES
  ('${fixture.platformTotpSession}', '${fixture.platformTotpUser}', NULL, NULL,
   'orap.example', repeat('1', 64), now() + interval '1 day', now() - interval '5 minutes'),
  ('${fixture.platformEmailSession}', '${fixture.platformEmailUser}', NULL, NULL,
   'orap.example', repeat('2', 64), now() + interval '1 day', now() - interval '5 minutes'),
  ('${fixture.customerBasicSession}', '${fixture.customerBasicUser}', '${fixture.tenant}', '${fixture.site}',
   'admin.customer.example', repeat('3', 64), now() + interval '1 day', now() - interval '5 minutes'),
  ('${fixture.customerTotpSession}', '${fixture.customerTotpUser}', '${fixture.tenant}', '${fixture.site}',
   'admin.customer.example', repeat('4', 64), now() + interval '1 day', now() - interval '5 minutes');

INSERT INTO password_recovery_tokens
  (id, user_id, token_hash, expires_at, requested_ip_hash)
VALUES
  ('${fixture.legacyRecoveryToken}', '${fixture.customerBasicUser}', repeat('d', 64),
   now() + interval '1 day', repeat('e', 64));
`,
    'Could not seed fictional pre-v2 fixtures',
  );
}

function assertUpgradeBackfill(resource) {
  psql(
    resource,
    `
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM account_authentication_policies
     WHERE user_id = '${fixture.platformTotpUser}'
       AND second_step_requirement = 'required'
       AND NOT email_code_enabled
       AND preferred_method = 'totp'
  ) THEN RAISE EXCEPTION 'platform TOTP policy was not conservatively backfilled'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM account_authentication_policies
     WHERE user_id = '${fixture.platformEmailUser}'
       AND second_step_requirement = 'required'
       AND email_code_enabled
       AND preferred_method = 'email_code'
  ) THEN RAISE EXCEPTION 'platform email policy was not conservatively backfilled'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM account_authentication_policies
     WHERE user_id = '${fixture.customerBasicUser}'
       AND second_step_requirement = 'optional'
       AND NOT email_code_enabled
       AND preferred_method IS NULL
  ) THEN RAISE EXCEPTION 'customer basic policy was not conservatively backfilled'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM account_authentication_policies
     WHERE user_id = '${fixture.customerTotpUser}'
       AND second_step_requirement = 'required'
       AND NOT email_code_enabled
       AND preferred_method = 'totp'
  ) THEN RAISE EXCEPTION 'customer TOTP policy was not preserved'; END IF;

  IF (SELECT count(*) FROM sessions
       WHERE authentication_method = 'password'
         AND authentication_assurance = 'basic'
         AND verified_at IS NULL
         AND NOT recovery_restricted) <> 4
  THEN RAISE EXCEPTION 'legacy sessions were not conservatively marked basic'; END IF;

  IF (SELECT count(*) FROM sessions
       WHERE id IN ('${fixture.platformTotpSession}', '${fixture.platformEmailSession}', '${fixture.customerTotpSession}')
         AND revoked_at IS NOT NULL
         AND revoke_reason = 'authentication-policy-upgrade') <> 3
  THEN RAISE EXCEPTION 'required-account legacy sessions were not revoked'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM sessions
     WHERE id = '${fixture.customerBasicSession}' AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'optional customer legacy session was unexpectedly revoked'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM password_recovery_tokens
     WHERE id = '${fixture.legacyRecoveryToken}' AND host IS NULL AND used_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'legacy unbound recovery token was not invalidated'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM account_recovery_codes
     WHERE id = '${fixture.platformUnusedCode}'
       AND user_id = '${fixture.platformTotpUser}'
       AND source_factor_id = '${fixture.platformFactor}'
       AND used_at IS NULL AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'unused legacy recovery code was not preserved'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM account_recovery_codes
     WHERE id = '${fixture.platformUsedCode}' AND used_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'used legacy recovery code was resurrected'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM account_recovery_codes
     WHERE id = '${fixture.revokedFactorCode}' AND revoked_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'revoked-factor recovery code remained active'; END IF;
END
$verify$;
`,
    'Auth Contract v2 backfill assertions failed',
  );

  expectSqlFailure(
    resource,
    `INSERT INTO sessions (user_id, host, token_hash, expires_at)
     VALUES ('${fixture.platformTotpUser}', 'orap.example', repeat('9', 64), now() + interval '1 hour');`,
    /required account policy cannot create a basic session/i,
    'Required-account basic-session guard failed',
  );
  expectSqlFailure(
    resource,
    `UPDATE account_authentication_policies
        SET second_step_requirement = 'optional', email_code_enabled = false, preferred_method = NULL
      WHERE user_id = '${fixture.platformEmailUser}';`,
    /active platform membership requires an account-level second-step policy/i,
    'Platform-policy relaxation guard failed',
  );
}

function roleScopedScalar(resource, role, settings, expression, context) {
  const setStatements = Object.entries(settings)
    .map(
      ([name, value]) =>
        `SELECT set_config('${name.replaceAll("'", "''")}', '${value.replaceAll("'", "''")}', true);`,
    )
    .join('\n');
  const output = psql(
    resource,
    `BEGIN;
SET LOCAL ROLE ${role};
${setStatements}
SELECT ${expression};
ROLLBACK;`,
    context,
  )
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return output.at(-1) ?? '';
}

function assertCommonFinalState(resource, expectedSessionCount) {
  psql(
    resource,
    `
DO $verify$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['omnireach_app','omnireach_worker','omnireach_platform','omnireach_auth']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_roles
       WHERE rolname = role_name
         AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb
         AND NOT rolcreaterole AND NOT rolinherit AND NOT rolbypassrls
    ) THEN RAISE EXCEPTION 'role is absent or over-privileged: %', role_name; END IF;
  END LOOP;

  IF NOT has_table_privilege('omnireach_auth', 'account_authentication_policies', 'SELECT,INSERT,UPDATE')
     OR NOT has_table_privilege('omnireach_auth', 'account_recovery_codes', 'SELECT,INSERT,UPDATE')
     OR NOT has_table_privilege('omnireach_auth', 'password_recovery_delivery_outbox', 'SELECT,INSERT,UPDATE')
     OR NOT has_table_privilege('omnireach_auth', 'webauthn_scopes', 'SELECT,INSERT')
     OR NOT has_table_privilege('omnireach_auth', 'webauthn_credentials', 'SELECT,INSERT')
     OR NOT has_column_privilege('omnireach_auth', 'webauthn_credentials', 'sign_count', 'UPDATE')
     OR NOT has_column_privilege('omnireach_auth', 'webauthn_credentials', 'revoked_at', 'UPDATE')
     OR has_column_privilege('omnireach_auth', 'webauthn_credentials', 'public_key', 'UPDATE')
  THEN RAISE EXCEPTION 'authentication role lacks required Auth v3 grants'; END IF;

  IF has_table_privilege('omnireach_app', 'sessions', 'SELECT')
     OR has_table_privilege('omnireach_worker', 'sessions', 'SELECT')
     OR has_table_privilege('omnireach_platform', 'credentials', 'SELECT')
     OR has_table_privilege('omnireach_platform', 'password_recovery_tokens', 'SELECT')
     OR has_table_privilege('omnireach_platform', 'mfa_factors', 'SELECT')
     OR has_table_privilege('omnireach_platform', 'account_recovery_codes', 'SELECT')
     OR has_table_privilege('omnireach_platform', 'webauthn_scopes', 'SELECT')
     OR has_table_privilege('omnireach_app', 'webauthn_credentials', 'SELECT')
     OR has_table_privilege('omnireach_worker', 'webauthn_credentials', 'SELECT')
     OR has_table_privilege('omnireach_auth', 'webauthn_scopes', 'DELETE')
     OR has_table_privilege('omnireach_auth', 'webauthn_credentials', 'DELETE')
  THEN RAISE EXCEPTION 'sensitive table grant leaked to a non-authentication role'; END IF;

  IF NOT has_table_privilege('omnireach_platform', 'sessions', 'SELECT')
     OR NOT has_column_privilege('omnireach_platform', 'sessions', 'revoked_at', 'UPDATE')
     OR NOT has_column_privilege('omnireach_platform', 'sessions', 'revoke_reason', 'UPDATE')
     OR has_column_privilege('omnireach_platform', 'sessions', 'authentication_assurance', 'UPDATE')
  THEN RAISE EXCEPTION 'platform session revocation grant is not column-scoped'; END IF;

  IF (SELECT count(*) FROM pg_class
       WHERE relnamespace = 'public'::regnamespace
         AND relname IN (
           'sessions', 'password_recovery_tokens', 'account_authentication_policies',
           'account_recovery_codes', 'password_recovery_delivery_outbox',
           'webauthn_scopes', 'webauthn_credentials'
         )
         AND relrowsecurity AND relforcerowsecurity) <> 7
  THEN RAISE EXCEPTION 'Auth v3 tables do not all force row-level security'; END IF;
END
$verify$;
`,
    'Final Auth v3 role/RLS assertions failed',
  );

  const hiddenSessions = roleScopedScalar(
    resource,
    'omnireach_auth',
    {},
    'count(*) FROM sessions',
    'Auth role fail-closed session query failed',
  );
  if (hiddenSessions !== '0') {
    throw new Error(
      `Auth role saw ${hiddenSessions} sessions without selecting contract version 3.`,
    );
  }

  const visibleSessions = roleScopedScalar(
    resource,
    'omnireach_auth',
    { 'app.authentication_contract_version': '3' },
    'count(*) FROM sessions',
    'Auth role contract-v3 session query failed',
  );
  if (visibleSessions !== String(expectedSessionCount)) {
    throw new Error(
      `Auth role expected ${expectedSessionCount} contract-v3 sessions, saw ${visibleSessions}.`,
    );
  }

  const tenantSiteCount = roleScopedScalar(
    resource,
    'omnireach_app',
    { 'app.tenant_id': fixture.tenant, 'app.site_id': fixture.site },
    'count(*) FROM sites',
    'Tenant-scoped site query failed',
  );
  if (tenantSiteCount !== '1') {
    throw new Error(`Tenant role expected one in-scope site, saw ${tenantSiteCount}.`);
  }

  const crossTenantSiteCount = roleScopedScalar(
    resource,
    'omnireach_app',
    { 'app.tenant_id': fixture.tenant, 'app.site_id': fixture.otherSite },
    'count(*) FROM sites',
    'Cross-tenant site query failed',
  );
  if (crossTenantSiteCount !== '0') {
    throw new Error(`Tenant role saw ${crossTenantSiteCount} cross-tenant sites.`);
  }

  expectSqlFailure(
    resource,
    `BEGIN; SET LOCAL ROLE omnireach_app; SELECT count(*) FROM sessions; ROLLBACK;`,
    /permission denied for table sessions/i,
    'Application role session isolation failed',
  );
  expectSqlFailure(
    resource,
    `BEGIN; SET LOCAL ROLE omnireach_platform; SELECT count(*) FROM credentials; ROLLBACK;`,
    /permission denied for table credentials/i,
    'Platform credential isolation failed',
  );
}

function assertUpgradeExactHost(resource) {
  const settings = { 'app.authentication_contract_version': '3' };
  const exactSession = roleScopedScalar(
    resource,
    'omnireach_auth',
    settings,
    `count(*)
       FROM sessions session
       JOIN domains domain
         ON domain.tenant_id = session.tenant_id AND domain.site_id = session.site_id
        AND domain.hostname = session.host
      WHERE session.token_hash = repeat('3', 64)
        AND session.host = 'admin.customer.example'
        AND domain.hostname = 'admin.customer.example'
        AND domain.kind = 'admin' AND domain.verification_status = 'verified' AND domain.active
        AND session.revoked_at IS NULL AND session.expires_at > now()`,
    'Exact-host session lookup failed',
  );
  if (exactSession !== '1') throw new Error(`Exact-host session lookup returned ${exactSession}.`);

  const wrongHostSession = roleScopedScalar(
    resource,
    'omnireach_auth',
    settings,
    `count(*)
       FROM sessions session
      WHERE session.token_hash = repeat('3', 64)
        AND session.host = 'admin.neighbor.example'
        AND session.revoked_at IS NULL`,
    'Wrong-host session lookup failed',
  );
  if (wrongHostSession !== '0') {
    throw new Error(`A session was accepted for a different exact host (${wrongHostSession}).`);
  }

  expectSqlFailure(
    resource,
    `INSERT INTO sessions
       (user_id, tenant_id, site_id, host, token_hash, expires_at)
     VALUES
       ('${fixture.customerBasicUser}', '${fixture.tenant}', '${fixture.site}',
        'Admin.Customer.Example:443', repeat('8', 64), now() + interval '1 hour');`,
    /sessions_host_check/i,
    'Session host normalization constraint failed',
  );
  expectSqlFailure(
    resource,
    `INSERT INTO password_recovery_tokens
       (user_id, token_hash, expires_at, host)
     VALUES
       ('${fixture.customerBasicUser}', repeat('7', 64), now() + interval '1 hour',
        'admin.customer.example:443');`,
    /password_recovery_tokens_host_check/i,
    'Recovery host normalization constraint failed',
  );
}

function assertWebAuthnFoundation(resource) {
  const stateBefore = Number(
    psql(
      resource,
      `SELECT auth_state_version FROM account_authentication_policies
        WHERE user_id = '${fixture.customerBasicUser}';`,
      'Could not read pre-WebAuthn authentication state',
    ),
  );

  expectSqlFailure(
    resource,
    `BEGIN;
     SET LOCAL ROLE omnireach_auth;
     SELECT set_config('app.authentication_contract_version', '2', true);
     INSERT INTO webauthn_scopes
       (id, user_id, tenant_id, site_id, rp_id, user_handle)
     VALUES
       ('${fixture.webAuthnScope}', '${fixture.customerBasicUser}', '${fixture.tenant}',
        '${fixture.site}', 'admin.customer.example', decode(repeat('ab', 64), 'hex'));
     COMMIT;`,
    /row-level security policy|violates row-level security/i,
    'Auth Contract v2 WebAuthn write did not fail closed',
  );

  psql(
    resource,
    `BEGIN;
     SET LOCAL ROLE omnireach_auth;
     SELECT set_config('app.authentication_contract_version', '3', true);
     INSERT INTO webauthn_scopes
       (id, user_id, tenant_id, site_id, rp_id, user_handle)
     VALUES
       ('${fixture.webAuthnScope}', '${fixture.customerBasicUser}', '${fixture.tenant}',
        '${fixture.site}', 'admin.customer.example', decode(repeat('ab', 64), 'hex'));
     INSERT INTO webauthn_credentials
       (id, scope_id, credential_id, public_key, sign_count, transports, device_type,
        backup_eligible, backed_up, name, verified_at)
     VALUES
       ('${fixture.webAuthnCredential}', '${fixture.webAuthnScope}', decode('01020304', 'hex'),
        decode('a5010203262001215820', 'hex'), 0, ARRAY['internal'], 'singleDevice',
        false, false, 'Windows Hello', now());
     COMMIT;`,
    'Auth Contract v3 could not create fictional WebAuthn fixtures',
  );

  assertScalar(
    resource,
    `SELECT auth_state_version FROM account_authentication_policies
      WHERE user_id = '${fixture.customerBasicUser}'`,
    stateBefore + 1,
    'WebAuthn enrollment did not bump authentication state exactly once',
  );

  psql(
    resource,
    `BEGIN;
     SET LOCAL ROLE omnireach_auth;
     SELECT set_config('app.authentication_contract_version', '3', true);
     UPDATE webauthn_credentials
        SET sign_count = 1, last_used_at = now(), updated_at = now()
      WHERE id = '${fixture.webAuthnCredential}';
     COMMIT;`,
    'WebAuthn usage-state update failed',
  );
  assertScalar(
    resource,
    `SELECT auth_state_version FROM account_authentication_policies
      WHERE user_id = '${fixture.customerBasicUser}'`,
    stateBefore + 1,
    'WebAuthn usage state incorrectly invalidated authentication state',
  );

  expectSqlFailure(
    resource,
    `UPDATE webauthn_credentials SET public_key = decode('01', 'hex')
      WHERE id = '${fixture.webAuthnCredential}';`,
    /WebAuthn credential identity is immutable/i,
    'WebAuthn credential identity mutation was accepted',
  );
  expectSqlFailure(
    resource,
    `UPDATE webauthn_scopes SET rp_id = 'other.customer.example'
      WHERE id = '${fixture.webAuthnScope}';`,
    /WebAuthn scope identity is immutable/i,
    'WebAuthn scope identity mutation was accepted',
  );

  psql(
    resource,
    `BEGIN;
     SET LOCAL ROLE omnireach_auth;
     SELECT set_config('app.authentication_contract_version', '3', true);
     UPDATE webauthn_credentials
        SET revoked_at = now(), revoke_reason = 'fictional verification', updated_at = now()
      WHERE id = '${fixture.webAuthnCredential}';
     COMMIT;`,
    'WebAuthn revocation update failed',
  );
  assertScalar(
    resource,
    `SELECT auth_state_version FROM account_authentication_policies
      WHERE user_id = '${fixture.customerBasicUser}'`,
    stateBefore + 2,
    'WebAuthn revocation did not bump authentication state exactly once',
  );
  expectSqlFailure(
    resource,
    `UPDATE webauthn_credentials SET revoked_at = NULL, revoke_reason = NULL
      WHERE id = '${fixture.webAuthnCredential}';`,
    /WebAuthn credential revocation evidence is immutable/i,
    'WebAuthn credential revocation was reversed',
  );
  expectSqlFailure(
    resource,
    `UPDATE webauthn_credentials SET revoked_at = revoked_at + interval '1 second',
                                      revoke_reason = 'rewritten evidence'
      WHERE id = '${fixture.webAuthnCredential}';`,
    /WebAuthn credential revocation evidence is immutable/i,
    'WebAuthn credential revocation evidence was rewritten',
  );
  expectSqlFailure(
    resource,
    `UPDATE webauthn_credentials SET revoke_reason = 'rewritten reason only'
      WHERE id = '${fixture.webAuthnCredential}';`,
    /WebAuthn credential revocation evidence is immutable/i,
    'WebAuthn credential revocation reason was rewritten',
  );
  expectSqlFailure(
    resource,
    `BEGIN;
     SET LOCAL ROLE omnireach_auth;
     SELECT set_config('app.authentication_contract_version', '3', true);
     DELETE FROM webauthn_credentials WHERE id = '${fixture.webAuthnCredential}';
     COMMIT;`,
    /permission denied for table webauthn_credentials/i,
    'Authentication role could delete WebAuthn evidence',
  );

  const v2Visible = roleScopedScalar(
    resource,
    'omnireach_auth',
    { 'app.authentication_contract_version': '2' },
    'count(*) FROM webauthn_credentials',
    'Auth Contract v2 WebAuthn read check failed',
  );
  if (v2Visible !== '0') throw new Error(`Auth Contract v2 saw ${v2Visible} WebAuthn rows.`);
  const v3Visible = roleScopedScalar(
    resource,
    'omnireach_auth',
    { 'app.authentication_contract_version': '3' },
    'count(*) FROM webauthn_credentials',
    'Auth Contract v3 WebAuthn read check failed',
  );
  if (v3Visible !== '1') throw new Error(`Auth Contract v3 saw ${v3Visible} WebAuthn rows.`);

  psql(
    resource,
    `INSERT INTO users (id, normalized_email, display_name)
     VALUES ('${fixture.webAuthnDeleteGuardUser}', 'deletion.guard@example.invalid', 'Deletion Guard');
     INSERT INTO webauthn_scopes (id, user_id, rp_id, user_handle)
     VALUES ('${fixture.webAuthnDeleteGuardScope}', '${fixture.webAuthnDeleteGuardUser}',
             'orap.example', decode(repeat('cd', 64), 'hex'));`,
    'Could not seed WebAuthn user deletion guard',
  );
  expectSqlFailure(
    resource,
    `DELETE FROM users WHERE id = '${fixture.webAuthnDeleteGuardUser}';`,
    /webauthn_scopes.*user_id|foreign key constraint/i,
    'User deletion removed durable WebAuthn scope evidence',
  );
}

function seedAndAssertFreshDatabase(resource) {
  psql(
    resource,
    `
DO $verify$
BEGIN
  IF (SELECT count(*) FROM users) <> 0
     OR (SELECT count(*) FROM sessions) <> 0
     OR (SELECT count(*) FROM account_authentication_policies) <> 0
  THEN RAISE EXCEPTION 'fresh all-migrations database was not empty'; END IF;
END
$verify$;

INSERT INTO tenants (id, name) VALUES
  ('${fixture.tenant}', 'Fresh Fictional Tenant'),
  ('${fixture.otherTenant}', 'Fresh Neighbor Tenant');
INSERT INTO sites (id, tenant_id, name) VALUES
  ('${fixture.site}', '${fixture.tenant}', 'Fresh Fictional Site'),
  ('${fixture.otherSite}', '${fixture.otherTenant}', 'Fresh Neighbor Site');
INSERT INTO domains
  (id, tenant_id, site_id, hostname, kind, verification_status, active, onboarding_state)
VALUES
  ('21000000-0000-4000-8000-000000000001', '${fixture.tenant}', '${fixture.site}',
   'admin.customer.example', 'admin', 'verified', true, 'active'),
  ('21000000-0000-4000-8000-000000000002', '${fixture.otherTenant}', '${fixture.otherSite}',
   'admin.neighbor.example', 'admin', 'verified', true, 'active');
INSERT INTO users (id, normalized_email, display_name)
VALUES ('${fixture.customerBasicUser}', 'fresh.customer@example.invalid', 'Fresh Fictional Customer');
INSERT INTO memberships (tenant_id, site_id, user_id, role, active)
VALUES ('${fixture.tenant}', '${fixture.site}', '${fixture.customerBasicUser}', 'customer_owner', true);
INSERT INTO sessions
  (id, user_id, tenant_id, site_id, host, token_hash, expires_at)
VALUES
  ('${fixture.customerBasicSession}', '${fixture.customerBasicUser}', '${fixture.tenant}', '${fixture.site}',
   'admin.customer.example', repeat('3', 64), now() + interval '1 day');
INSERT INTO password_recovery_tokens
  (id, user_id, token_hash, expires_at, host)
VALUES
  ('${fixture.legacyRecoveryToken}', '${fixture.customerBasicUser}', repeat('d', 64),
   now() + interval '1 day', 'admin.customer.example');

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM account_authentication_policies
     WHERE user_id = '${fixture.customerBasicUser}'
       AND second_step_requirement = 'optional'
       AND NOT email_code_enabled
       AND preferred_method IS NULL
  ) THEN RAISE EXCEPTION 'fresh user did not receive the conservative default policy'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM password_recovery_tokens
     WHERE id = '${fixture.legacyRecoveryToken}'
       AND host = 'admin.customer.example' AND used_at IS NULL
  ) THEN RAISE EXCEPTION 'fresh exact-host recovery token was not retained'; END IF;
END
$verify$;
`,
    'Fresh all-migrations database assertions failed',
  );
}

function assertFreshExactHost(resource) {
  const exactRecovery = roleScopedScalar(
    resource,
    'omnireach_auth',
    { 'app.authentication_contract_version': '3' },
    `count(*) FROM password_recovery_tokens
      WHERE token_hash = repeat('d', 64)
        AND host = 'admin.customer.example' AND used_at IS NULL`,
    'Fresh exact-host recovery lookup failed',
  );
  if (exactRecovery !== '1') {
    throw new Error(`Fresh exact-host recovery lookup returned ${exactRecovery}.`);
  }

  const wrongRecovery = roleScopedScalar(
    resource,
    'omnireach_auth',
    { 'app.authentication_contract_version': '3' },
    `count(*) FROM password_recovery_tokens
      WHERE token_hash = repeat('d', 64)
        AND host = 'admin.neighbor.example' AND used_at IS NULL`,
    'Fresh wrong-host recovery lookup failed',
  );
  if (wrongRecovery !== '0') {
    throw new Error(`Recovery token was accepted for a different exact host (${wrongRecovery}).`);
  }
}

function withEphemeralPostgres(label, operation) {
  const resource = allocateResource(label);
  let result;
  let operationError;
  try {
    startPostgres(resource);
    result = operation(resource);
  } catch (error) {
    operationError = error;
  } finally {
    const cleanupErrors = cleanupResource(resource);
    if (cleanupErrors.length > 0) {
      const cleanupError = new Error(cleanupErrors.join('\n'));
      operationError = operationError
        ? new AggregateError([operationError, cleanupError], 'Verification and cleanup both failed')
        : cleanupError;
    }
  }
  if (operationError) throw operationError;
  return result;
}

function cleanupForSignal(exitCode) {
  const cleanupErrors = [...activeResources].flatMap((resource) => cleanupResource(resource));
  for (const error of cleanupErrors) process.stderr.write(`[g06-auth-v3] ${error}\n`);
  process.exit(exitCode);
}

process.once('SIGINT', () => cleanupForSignal(130));
process.once('SIGTERM', () => cleanupForSignal(143));

try {
  assertDockerAvailable();
  const migrations = discoverMigrations();

  const upgrade = withEphemeralPostgres('upgrade', (resource) => {
    applyMigrations(resource, migrations.preV2);
    seedLegacyFixtures(resource);
    applyMigrations(resource, migrations.authV2);
    assertUpgradeBackfill(resource);
    applyMigrations(resource, migrations.postV2);
    assertCommonFinalState(resource, 4);
    assertUpgradeExactHost(resource);
    assertWebAuthnFoundation(resource);
    return {
      preV2Migrations: migrations.preV2.length,
      authV2Migrations: migrations.authV2.map((migration) => migration.name),
      laterMigrations: migrations.postV2.length,
      fictionalLegacyFixtures: 4,
      conservativeBackfill: true,
      requiredSessionsRevoked: 3,
      tenantIsolation: true,
      exactHost: true,
      webAuthnFoundation: true,
    };
  });

  const fresh = withEphemeralPostgres('fresh', (resource) => {
    applyMigrations(resource, migrations.all);
    seedAndAssertFreshDatabase(resource);
    assertCommonFinalState(resource, 1);
    assertUpgradeExactHost(resource);
    assertFreshExactHost(resource);
    assertWebAuthnFoundation(resource);
    return {
      allMigrations: migrations.all.length,
      startedEmpty: true,
      defaultPolicy: true,
      tenantIsolation: true,
      exactHost: true,
      webAuthnFoundation: true,
    };
  });

  process.stdout.write(
    `${JSON.stringify({
      check: 'auth-v3-disposable-migration-and-isolation',
      ok: true,
      postgresImage,
      upgrade,
      fresh,
      dockerResourcesCleaned: true,
    })}\n`,
  );
} catch (error) {
  const nested =
    error instanceof AggregateError ? error.errors.map((item) => item.message) : undefined;
  process.stderr.write(
    `${JSON.stringify({
      check: 'auth-v3-disposable-migration-and-isolation',
      ok: false,
      error: error.message,
      ...(nested ? { causes: nested } : {}),
    })}\n`,
  );
  process.exitCode = 1;
}
