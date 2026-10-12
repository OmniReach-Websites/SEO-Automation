#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  createVersionedSecretKeyring,
  encryptMfaSecret,
  PostgresMfaKeyRotator,
} from '../packages/auth/src/index.ts';
import pg from 'pg';

const { Pool } = pg;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsRoot = join(repositoryRoot, 'packages', 'database', 'prisma', 'migrations');
const image =
  'postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297';
const runId = randomUUID().replaceAll('-', '');
const resourcePrefix = 'omnireach-g05-mfa-retirement-';
const containerName = `${resourcePrefix}${runId}`;
const volumeName = `${containerName}-data`;
const ownershipLabel = 'com.omnireach.g05-mfa-retirement-verifier';
const database = 'omnireach_g05_mfa_verify';
const username = 'omnireach_g05_mfa_verify';
const password = 'fictional-local-g05-verifier-only';
const oldKey = 'fictional-g05-old-encryption-key-material-0001';
const activeKey = 'fictional-g05-active-encryption-key-material-0002';
const fixture = Object.freeze({
  factor: '51000000-0000-4000-8000-000000000001',
  racingFactor: '51000000-0000-4000-8000-000000000002',
  recovery: '52000000-0000-4000-8000-000000000001',
  recoveryAfterRetirement: '52000000-0000-4000-8000-000000000002',
  user: '53000000-0000-4000-8000-000000000001',
  racingUser: '53000000-0000-4000-8000-000000000002',
});

let containerCreated = false;
let volumeCreated = false;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
}

function checked(command, args, context, options = {}) {
  const result = run(command, args, options);
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();
    throw new Error(`${context}${detail ? `\n${detail}` : ''}`);
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function ownedResource(kind, name) {
  assert(name.startsWith(resourcePrefix), `Refusing cleanup for unexpected ${kind} name`);
  const noun = kind === 'container' ? 'container' : 'volume';
  const labelPath =
    kind === 'container'
      ? `{{ index .Config.Labels "${ownershipLabel}" }}`
      : `{{ index .Labels "${ownershipLabel}" }}`;
  const inspected = run('docker', [noun, 'inspect', '--format', labelPath, name]);
  return inspected.status === 0 && inspected.stdout.trim() === runId;
}

function cleanup() {
  const errors = [];
  if (containerCreated && ownedResource('container', containerName)) {
    const removed = run('docker', ['container', 'rm', '--force', '--volumes', containerName]);
    if (removed.status !== 0) errors.push('container cleanup failed');
    else containerCreated = false;
  }
  if (volumeCreated && ownedResource('volume', volumeName)) {
    const removed = run('docker', ['volume', 'rm', volumeName]);
    if (removed.status !== 0) errors.push('volume cleanup failed');
    else volumeCreated = false;
  }
  return errors;
}

function applyMigrations() {
  const migrations = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  for (const migration of migrations) {
    const sql = readFileSync(join(migrationsRoot, migration, 'migration.sql'), 'utf8');
    checked(
      'docker',
      [
        'exec',
        '--interactive',
        '--env',
        `PGPASSWORD=${password}`,
        containerName,
        'psql',
        '--set',
        'ON_ERROR_STOP=1',
        '--username',
        username,
        '--dbname',
        database,
      ],
      `Migration failed: ${migration}`,
      { input: sql },
    );
  }
}

async function expectDatabaseError(operation, message) {
  let rejected = false;
  try {
    await operation();
  } catch {
    rejected = true;
  }
  assert(rejected, message);
}

async function withAuthRole(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE omnireach_auth');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function verify(pool) {
  await pool.query(
    `INSERT INTO users (id, normalized_email, display_name) VALUES
       ($1, 'mfa-key-owner@example.test', 'Fictional MFA Key Owner'),
       ($2, 'mfa-key-racer@example.test', 'Fictional MFA Key Racer')`,
    [fixture.user, fixture.racingUser],
  );
  await pool.query(
    `UPDATE account_authentication_policies
        SET second_step_requirement = 'required'
      WHERE user_id IN ($1, $2)`,
    [fixture.user, fixture.racingUser],
  );
  await pool.query(
    `INSERT INTO mfa_factors
       (id, user_id, kind, encrypted_secret, key_version, verified_at)
     VALUES ($1, $2, 'totp', $3, 1, now())`,
    [fixture.factor, fixture.user, Buffer.from(encryptMfaSecret('JBSWY3DPEHPK3PXP', oldKey))],
  );
  await pool.query(
    `INSERT INTO password_recovery_tokens
       (id, user_id, host, token_hash, expires_at)
     VALUES ($1, $2, 'admin.omnireach.test', repeat('a', 64), now() + interval '1 hour')`,
    [fixture.recovery, fixture.user],
  );
  await pool.query(
    `INSERT INTO password_recovery_delivery_outbox
       (recovery_token_id, encrypted_token, encryption_key_version)
     VALUES ($1, decode('010203', 'hex'), 1)`,
    [fixture.recovery],
  );

  const grants = await pool.query(
    `SELECT
       has_table_privilege('omnireach_auth', 'mfa_encryption_key_retirements', 'SELECT') AS auth_select,
       has_table_privilege('omnireach_auth', 'mfa_encryption_key_retirements', 'INSERT') AS auth_insert,
       has_table_privilege('omnireach_platform', 'mfa_encryption_key_retirements', 'SELECT') AS platform_select,
       has_function_privilege(
         'omnireach_auth',
         'retire_mfa_encryption_key(integer,integer,text)',
         'EXECUTE'
       ) AS auth_execute,
       has_function_privilege(
         'omnireach_app',
         'retire_mfa_encryption_key(integer,integer,text)',
         'EXECUTE'
       ) AS app_execute`,
  );
  assert(grants.rows[0]?.auth_select === true, 'Authentication role cannot read retirement state');
  assert(grants.rows[0]?.auth_insert === false, 'Authentication role can bypass atomic retirement');
  assert(grants.rows[0]?.platform_select === false, 'Platform role can read auth-only state');
  assert(grants.rows[0]?.auth_execute === true, 'Authentication role cannot execute retirement');
  assert(grants.rows[0]?.app_execute === false, 'Application role can execute key retirement');

  const keyring = createVersionedSecretKeyring({
    activeVersion: 2,
    keys: { 1: oldKey, 2: activeKey },
  });
  const rotator = new PostgresMfaKeyRotator(pool, keyring);
  const blocked = await rotator.retirementReport(1);
  assert(!blocked.canRetire && blocked.mfaFactorReferences === 1, 'Referenced key was retireable');

  const authStateBefore = await pool.query(
    'SELECT auth_state_version::text AS version FROM account_authentication_policies WHERE user_id = $1',
    [fixture.user],
  );
  const rotation = await rotator.rotateBatch('VERIFY-G05-ROTATION', 10);
  assert(rotation.rotated === 1 && rotation.remaining === 0, 'MFA factor rotation did not finish');
  const authStateAfter = await pool.query(
    'SELECT auth_state_version::text AS version FROM account_authentication_policies WHERE user_id = $1',
    [fixture.user],
  );
  assert(
    BigInt(authStateAfter.rows[0]?.version ?? '0') >
      BigInt(authStateBefore.rows[0]?.version ?? '0'),
    'MFA factor rotation did not advance authentication state',
  );
  const batchAudit = await pool.query(
    `SELECT metadata FROM audit_events
      WHERE action = 'auth.mfa_encryption_key.rotation_batch'
        AND reason = 'VERIFY-G05-ROTATION'`,
  );
  assert(batchAudit.rows.length === 1, 'Rotation batch audit evidence is missing');
  assert(batchAudit.rows[0]?.metadata?.rotated === 1, 'Rotation batch audit count is incorrect');

  await withAuthRole(pool, (client) =>
    client.query(
      `UPDATE password_recovery_delivery_outbox
          SET status = 'failed', encrypted_token = NULL, last_error_code = 'verification_cleanup'
        WHERE recovery_token_id = $1`,
      [fixture.recovery],
    ),
  );
  const retirement = await rotator.retireKey(1, 'VERIFY-G05-RETIREMENT');
  assert(retirement.retired && !retirement.canRetire, 'Key retirement was not recorded');

  const durableEvidence = await pool.query(
    `SELECT retirement.change_id, audit.metadata
       FROM mfa_encryption_key_retirements retirement
       JOIN audit_events audit
         ON audit.action = 'auth.mfa_encryption_key.retired'
        AND audit.reason = retirement.change_id
      WHERE retirement.key_version = 1`,
  );
  assert(durableEvidence.rows.length === 1, 'Retirement audit evidence is missing');
  assert(
    durableEvidence.rows[0]?.metadata?.retiredVersion === 1,
    'Retirement audit evidence names the wrong version',
  );

  await expectDatabaseError(
    () =>
      withAuthRole(pool, (client) =>
        client.query(
          `INSERT INTO mfa_encryption_key_retirements (key_version, change_id)
           VALUES (4, 'VERIFY-BYPASS')`,
        ),
      ),
    'Authentication role bypassed the atomic retirement function',
  );
  await expectDatabaseError(
    () => pool.query('DELETE FROM mfa_encryption_key_retirements WHERE key_version = 1'),
    'Retirement record could be deleted',
  );
  await expectDatabaseError(
    () =>
      withAuthRole(pool, (client) =>
        client.query(
          `INSERT INTO mfa_factors
             (user_id, kind, encrypted_secret, key_version, verified_at)
           VALUES ($1, 'totp', decode('010203', 'hex'), 1, now())`,
          [fixture.racingUser],
        ),
      ),
    'A stale process wrote an MFA factor under a retired key',
  );
  await pool.query(
    `INSERT INTO password_recovery_tokens
       (id, user_id, host, token_hash, expires_at)
     VALUES ($1, $2, 'admin.omnireach.test', repeat('b', 64), now() + interval '1 hour')`,
    [fixture.recoveryAfterRetirement, fixture.racingUser],
  );
  await expectDatabaseError(
    () =>
      withAuthRole(pool, (client) =>
        client.query(
          `INSERT INTO password_recovery_delivery_outbox
             (recovery_token_id, encrypted_token, encryption_key_version)
           VALUES ($1, decode('010203', 'hex'), 1)`,
          [fixture.recoveryAfterRetirement],
        ),
      ),
    'A stale process queued recovery ciphertext under a retired key',
  );
  await expectDatabaseError(
    () =>
      withAuthRole(pool, (client) =>
        client.query(
          `UPDATE password_recovery_delivery_outbox
              SET status = 'queued', encrypted_token = decode('010203', 'hex')
            WHERE recovery_token_id = $1`,
          [fixture.recovery],
        ),
      ),
    'A stale process restored recovery ciphertext without changing its retired version',
  );
  await withAuthRole(pool, (client) =>
    client.query(
      `UPDATE password_recovery_delivery_outbox
          SET encrypted_token = NULL
        WHERE recovery_token_id = $1`,
      [fixture.recovery],
    ),
  );

  const ciphertextTriggers = await pool.query(
    `SELECT tgname, pg_get_triggerdef(oid) AS definition
       FROM pg_trigger
      WHERE tgname IN (
        'mfa_factors_reject_retired_encryption_key',
        'password_recovery_outbox_reject_retired_encryption_key'
      )
      ORDER BY tgname`,
  );
  assert(ciphertextTriggers.rows.length === 2, 'Ciphertext retirement triggers are missing');
  assert(
    ciphertextTriggers.rows.some(
      (row) =>
        row.tgname === 'mfa_factors_reject_retired_encryption_key' &&
        row.definition.includes('encrypted_secret'),
    ),
    'MFA ciphertext-only updates are not guarded',
  );
  assert(
    ciphertextTriggers.rows.some(
      (row) =>
        row.tgname === 'password_recovery_outbox_reject_retired_encryption_key' &&
        row.definition.includes('encrypted_token'),
    ),
    'Recovery ciphertext-only updates are not guarded',
  );

  const writer = await pool.connect();
  const retiree = await pool.connect();
  try {
    await writer.query('BEGIN');
    await writer.query('SET LOCAL ROLE omnireach_auth');
    await writer.query(
      `INSERT INTO mfa_factors
         (id, user_id, kind, encrypted_secret, key_version, verified_at)
       VALUES ($1, $2, 'totp', decode('010203', 'hex'), 3, now())`,
      [fixture.racingFactor, fixture.racingUser],
    );

    await retiree.query('BEGIN');
    await retiree.query('SET LOCAL ROLE omnireach_auth');
    let retirementSettled = false;
    const concurrentRetirement = retiree
      .query(`SELECT retire_mfa_encryption_key(3, 2, 'VERIFY-G05-RACE') AS retired`)
      .then((result) => {
        retirementSettled = true;
        return result;
      });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    assert(!retirementSettled, 'Retirement did not wait for a concurrent ciphertext writer');
    await writer.query('COMMIT');
    const raceResult = await concurrentRetirement;
    assert(raceResult.rows[0]?.retired === false, 'Retirement missed the concurrent reference');
    await retiree.query('COMMIT');
  } catch (error) {
    await writer.query('ROLLBACK').catch(() => undefined);
    await retiree.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    writer.release();
    retiree.release();
  }
}

let pool;
let verificationError;
try {
  checked('docker', ['version', '--format', '{{.Server.Version}}'], 'Docker is unavailable');
  checked(
    'docker',
    ['volume', 'create', '--label', `${ownershipLabel}=${runId}`, volumeName],
    'Verifier volume creation failed',
  );
  volumeCreated = true;
  checked(
    'docker',
    [
      'run',
      '--detach',
      '--name',
      containerName,
      '--label',
      `${ownershipLabel}=${runId}`,
      '--publish',
      '127.0.0.1::5432',
      '--env',
      `POSTGRES_DB=${database}`,
      '--env',
      `POSTGRES_USER=${username}`,
      '--env',
      `POSTGRES_PASSWORD=${password}`,
      '--volume',
      `${volumeName}:/var/lib/postgresql/data`,
      image,
    ],
    'Verifier container creation failed',
  );
  containerCreated = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (
      run('docker', [
        'exec',
        containerName,
        'pg_isready',
        '--host',
        '127.0.0.1',
        '--username',
        username,
        '--dbname',
        database,
      ]).status === 0
    ) {
      ready = true;
      break;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  assert(ready, 'Disposable PostgreSQL did not become ready');
  applyMigrations();
  const port = checked(
    'docker',
    ['port', containerName, '5432/tcp'],
    'Could not discover verifier port',
  )
    .stdout.trim()
    .split(':')
    .at(-1);
  assert(/^\d+$/u.test(port ?? ''), 'Verifier returned an invalid PostgreSQL port');
  pool = new Pool({
    connectionString: `postgresql://${username}:${password}@127.0.0.1:${port}/${database}`,
    max: 5,
  });
  await verify(pool);
  process.stdout.write(
    `${JSON.stringify({
      check: 'mfa-key-retirement',
      concurrentWriterGuard: 'verified',
      grantsAndRls: 'verified',
      immutableRetirement: 'verified',
      ok: true,
      resourceIsolation: 'unique-labeled-disposable',
    })}\n`,
  );
} catch (error) {
  verificationError = error;
} finally {
  if (pool) await pool.end().catch(() => undefined);
  const cleanupErrors = cleanup();
  if (cleanupErrors.length > 0) {
    verificationError = new Error(
      [verificationError instanceof Error ? verificationError.message : '', ...cleanupErrors]
        .filter(Boolean)
        .join('; '),
    );
  }
}
if (verificationError) throw verificationError;
