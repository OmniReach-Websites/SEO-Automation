import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const composeFile = resolve(root, 'infrastructure/compose/production.compose.yml');
const environmentExample = resolve(root, 'infrastructure/compose/production.env.example');
const bootstrapScript = '/workspace/infrastructure/compose/scripts/bootstrap-secrets.sh';
const runId = randomBytes(6).toString('hex');
const project = `omnireach-production-test-${runId}`;
const resourcePrefix = `omnireach-test-${runId}`;
const proxyNetwork = `${resourcePrefix}-proxy`;
const releaseSha = randomBytes(20).toString('hex');
const apiPort = String(45_000 + (process.pid % 1_000));
const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'omnireach-production-compose-'));
const secretsDirectory = resolve(temporaryRoot, 'secrets');
const environmentFile = resolve(temporaryRoot, 'production.env');
const hostUid = typeof process.getuid === 'function' ? process.getuid() : 0;
const hostGid = typeof process.getgid === 'function' ? process.getgid() : 0;
const environment = {
  ...process.env,
  OMNIREACH_API_PORT: apiPort,
  OMNIREACH_ENV_FILE: environmentFile,
  OMNIREACH_RELEASE_SHA: releaseSha,
  OMNIREACH_RESOURCE_PREFIX: resourcePrefix,
  OMNIREACH_PROXY_NETWORK: proxyNetwork,
  OMNIREACH_SECRETS_DIR: secretsDirectory,
};
const compose = [
  'compose',
  '--project-name',
  project,
  '--file',
  composeFile,
  '--profile',
  'application',
];

function run(executable, arguments_, options = {}) {
  const result = spawnSync(executable, arguments_, {
    cwd: root,
    encoding: 'utf8',
    env: environment,
    maxBuffer: 20 * 1024 * 1024,
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${executable} ${arguments_.join(' ')} failed (${result.status ?? 'signal'}):\n${result.stderr ?? ''}`,
    );
  }
  return result;
}

function dockerCompose(arguments_, options) {
  return run('docker', [...compose, ...arguments_], options);
}

async function secretValues() {
  return Promise.all(
    [
      'postgres_admin_password',
      'postgres_app_password',
      'redis_app_password',
      'session_secret',
      'mfa_encryption_key',
      'preview_signing_key',
      'contact_encryption_key',
    ].map(async (name) => (await readFile(resolve(secretsDirectory, name), 'utf8')).trim()),
  );
}

let stackCreated = false;
let proxyNetworkCreated = false;
try {
  run('docker', ['network', 'create', proxyNetwork]);
  proxyNetworkCreated = true;
  run('docker', [
    'run',
    '--rm',
    '--volume',
    `${root}:/workspace:ro`,
    '--volume',
    `${temporaryRoot}:/output`,
    'alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8',
    'sh',
    '-ceu',
    `apk add --no-cache openssl >/dev/null && mkdir -p /output/secrets && sh ${bootstrapScript} --secrets-dir /output/secrets && chown -R ${hostUid}:${hostGid} /output/secrets`,
  ]);
  const before = await secretValues();
  const beforeKeyring = (
    await readFile(resolve(secretsDirectory, 'mfa_encryption_keyring'), 'utf8')
  ).trim();
  assert.equal(new Set(before).size, before.length, 'generated secrets must be independent');
  for (const value of before) assert.match(value, /^[a-f0-9]{64}$/u);
  assert.deepEqual(JSON.parse(beforeKeyring), {
    activeVersion: 1,
    keys: { 1: before[4] },
  });

  run('docker', [
    'run',
    '--rm',
    '--volume',
    `${root}:/workspace:ro`,
    '--volume',
    `${temporaryRoot}:/output`,
    'alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8',
    'sh',
    '-ceu',
    `apk add --no-cache openssl >/dev/null && sh ${bootstrapScript} --secrets-dir /output/secrets && chown -R ${hostUid}:${hostGid} /output/secrets`,
  ]);
  assert.deepEqual(
    await secretValues(),
    before,
    'idempotent bootstrap must not rotate credentials',
  );
  assert.equal(
    (await readFile(resolve(secretsDirectory, 'mfa_encryption_keyring'), 'utf8')).trim(),
    beforeKeyring,
    'idempotent bootstrap must not rotate the MFA keyring',
  );

  await cp(environmentExample, environmentFile);
  const fixtureEnvironment = (await readFile(environmentFile, 'utf8')).replace(
    /^TRUSTED_PROXY_CIDRS=.*$/mu,
    'TRUSTED_PROXY_CIDRS=127.0.0.1/32',
  );
  await writeFile(environmentFile, fixtureEnvironment, { encoding: 'utf8', mode: 0o600 });
  const rendered = dockerCompose(['config', '--format', 'json'], { capture: true });
  const configuration = JSON.parse(rendered.stdout);
  assert.equal(configuration.networks.backend.internal, true);
  assert.deepEqual(configuration.services.postgres.ports ?? [], []);
  assert.deepEqual(configuration.services.redis.ports ?? [], []);
  assert.match(configuration.services.api.ports[0].host_ip, /^127\.0\.0\.1$/u);
  assert.deepEqual(configuration.services.api.networks.proxy.aliases, ['omnireach-api']);
  assert.equal(configuration.networks.proxy.external, true);
  for (const serviceName of ['postgres', 'redis']) {
    assert.ok(configuration.services[serviceName].volumes.length > 0);
    assert.deepEqual(configuration.services[serviceName].networks, { backend: null });
  }
  for (const secret of before) assert.ok(!rendered.stdout.includes(secret));
  assert.ok(!rendered.stdout.includes(beforeKeyring));

  stackCreated = true;
  try {
    dockerCompose(['up', '--detach', '--build', '--wait']);
  } catch (error) {
    dockerCompose(['ps'], { allowFailure: true });
    dockerCompose(['logs', '--no-color', '--tail', '100', 'redis'], { allowFailure: true });
    throw error;
  }

  const unauthenticatedRedis = dockerCompose(['exec', '--no-TTY', 'redis', 'redis-cli', 'ping'], {
    allowFailure: true,
    capture: true,
  });
  assert.match(
    `${unauthenticatedRedis.stdout}${unauthenticatedRedis.stderr}`,
    /NOAUTH|Authentication required/iu,
  );
  const authenticatedRedis = dockerCompose(
    [
      'exec',
      '--no-TTY',
      'redis',
      'sh',
      '-ceu',
      'REDISCLI_AUTH="$(cat /run/secrets/redis_app_password)" redis-cli --user omnireach_runtime ping',
    ],
    { capture: true },
  );
  assert.equal(authenticatedRedis.stdout.trim(), 'PONG');

  const deniedRedis = dockerCompose(
    [
      'exec',
      '--no-TTY',
      'redis',
      'sh',
      '-ceu',
      'REDISCLI_AUTH="$(cat /run/secrets/redis_app_password)" redis-cli --user omnireach_runtime CONFIG GET "*"',
    ],
    { allowFailure: true, capture: true },
  );
  assert.match(`${deniedRedis.stdout}${deniedRedis.stderr}`, /NOPERM/iu);

  const postgresRole = dockerCompose(
    [
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      'sh',
      'migrate',
      '-ceu',
      'PGPASSWORD="$(cat /run/secrets/postgres_app_password)" psql -h postgres -U omnireach_runtime -d omnireach -Atc "SELECT current_user, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user"',
    ],
    { capture: true },
  );
  assert.equal(postgresRole.stdout.trim(), 'omnireach_runtime|f|f|f|f');

  const wrongPostgresPassword = dockerCompose(
    [
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      'sh',
      'migrate',
      '-ceu',
      'PGPASSWORD=incorrect psql -h postgres -U omnireach_runtime -d omnireach -c "SELECT 1"',
    ],
    { allowFailure: true, capture: true },
  );
  assert.notEqual(wrongPostgresPassword.status, 0);

  dockerCompose([
    'exec',
    '--no-TTY',
    'postgres',
    'sh',
    '-ceu',
    'PGPASSWORD="$(cat /run/secrets/postgres_admin_password)" psql -U omnireach_db_admin -d omnireach -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS production_compose_persistence_probe (id integer PRIMARY KEY); INSERT INTO production_compose_persistence_probe VALUES (1) ON CONFLICT DO NOTHING" >/dev/null',
  ]);
  dockerCompose([
    'exec',
    '--no-TTY',
    'redis',
    'sh',
    '-ceu',
    'REDISCLI_AUTH="$(cat /run/secrets/redis_app_password)" redis-cli --user omnireach_runtime SET omnireach:test:persistence retained >/dev/null',
  ]);
  dockerCompose(['restart', 'postgres', 'redis']);
  dockerCompose(['up', '--detach', '--wait', 'postgres', 'redis']);

  const postgresPersistence = dockerCompose(
    [
      'exec',
      '--no-TTY',
      'postgres',
      'sh',
      '-ceu',
      'PGPASSWORD="$(cat /run/secrets/postgres_admin_password)" psql -U omnireach_db_admin -d omnireach -Atc "SELECT count(*) FROM production_compose_persistence_probe"',
    ],
    { capture: true },
  );
  assert.equal(postgresPersistence.stdout.trim(), '1');
  const redisPersistence = dockerCompose(
    [
      'exec',
      '--no-TTY',
      'redis',
      'sh',
      '-ceu',
      'REDISCLI_AUTH="$(cat /run/secrets/redis_app_password)" redis-cli --user omnireach_runtime GET omnireach:test:persistence',
    ],
    { capture: true },
  );
  assert.equal(redisPersistence.stdout.trim(), 'retained');

  for (const [service, expected] of [
    ['coops-mobile-detailing', "Coop's Mobile Detailing"],
    ['omnireach-public-site', 'Websites, managed well'],
  ]) {
    const staticResponse = dockerCompose(
      [
        'exec',
        '--no-TTY',
        service,
        'node',
        '-e',
        `fetch('http://127.0.0.1:8080/').then(async r=>{const b=await r.text();if(!r.ok||!b.includes(${JSON.stringify(expected)}))process.exit(1)}).catch(()=>process.exit(1))`,
      ],
      { capture: true },
    );
    assert.equal(staticResponse.status, 0);
  }

  const workerHeartbeats = dockerCompose(
    [
      'exec',
      '--no-TTY',
      'postgres',
      'sh',
      '-ceu',
      `PGPASSWORD="$(cat /run/secrets/postgres_admin_password)" psql -U omnireach_db_admin -d omnireach -Atc "SELECT count(DISTINCT worker_kind) FROM worker_heartbeats WHERE state = 'healthy' AND last_seen_at > now() - interval '2 minutes'"`,
    ],
    { capture: true },
  );
  assert.equal(workerHeartbeats.stdout.trim(), '6');

  dockerCompose([
    'exec',
    '--no-TTY',
    'postgres',
    'sh',
    '-ceu',
    `PGPASSWORD="$(cat /run/secrets/postgres_admin_password)" psql -U omnireach_db_admin -d omnireach -v ON_ERROR_STOP=1 -c "INSERT INTO tenants (id, name) VALUES ('10000000-0000-4000-8000-000000000099', 'Analytics verifier') ON CONFLICT (id) DO NOTHING; INSERT INTO sites (id, tenant_id, name) VALUES ('20000000-0000-4000-8000-000000000099', '10000000-0000-4000-8000-000000000099', 'Analytics verifier') ON CONFLICT (id) DO NOTHING" >/dev/null`,
  ]);
  const analyticsQuery = dockerCompose(
    [
      'exec',
      '--no-TTY',
      'api',
      '/opt/omnireach/infrastructure/compose/scripts/runtime-entrypoint.sh',
      'node',
      '--experimental-transform-types',
      '--input-type=module',
      '--eval',
      `import pg from 'pg';
       import { PostgresOrapService } from './apps/api/src/postgres-orap.ts';
       const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
       const service = new PostgresOrapService(pool, { send: async () => undefined }, async () => undefined);
       const model = await service.siteAnalytics(
         { id: '40000000-0000-4000-8000-000000000099', role: 'platform_owner', traceId: 'compose-analytics-verifier' },
         {
           endDate: '2026-10-12', limit: 25, pageSort: 'clicks', preset: '7',
           previousEndDate: '2026-10-05', previousStartDate: '2026-09-29',
           querySort: 'clicks', siteId: '20000000-0000-4000-8000-000000000099',
           startDate: '2026-10-06', tenantId: '10000000-0000-4000-8000-000000000099'
         }
       );
       if (model.site.id !== '20000000-0000-4000-8000-000000000099' || model.series.length !== 7) process.exitCode = 1;
       await pool.end();`,
    ],
    { capture: true },
  );
  assert.equal(
    analyticsQuery.status,
    0,
    'analytics queries must execute against migrated PostgreSQL',
  );

  const backupStatusQuery = dockerCompose(
    [
      'exec',
      '--no-TTY',
      'api',
      '/opt/omnireach/infrastructure/compose/scripts/runtime-entrypoint.sh',
      'node',
      '--input-type=module',
      '--eval',
      `import pg from 'pg';
       import { PostgresBackupRecords } from './infrastructure/backups/postgres-records.mjs';
       const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
       const records = new PostgresBackupRecords({ pool });
       const envelopeHash = 'ab'.repeat(32);
       await records.recordComplete({
         byteSize: 1024, createdAt: new Date('2026-10-14T00:00:00Z'), envelopeHash,
         keyVersion: 1, kind: 'daily', manifest: { fileCount: 1, formatVersion: 1, sourceBytes: 20 },
         offServerCopiedAt: new Date('2026-10-14T00:05:00Z'),
         offServerRef: 'omnireach/fixture.orbk', storageRef: '/fixture/backup.orbk',
         verifiedAt: new Date('2026-10-14T00:02:00Z')
       });
       await records.reportFailure('integrity_verification_failed');
       const client = await pool.connect();
       const read = async () => {
         await client.query('BEGIN');
         await client.query('SET LOCAL ROLE omnireach_platform');
         const backup = await client.query('SELECT state, local_pruned_at, off_server_pruned_at FROM backup_records WHERE envelope_hash = $1', [envelopeHash]);
         const alert = await client.query("SELECT state FROM alerts WHERE tenant_id IS NULL AND source = 'backup.production'");
         await client.query('COMMIT');
         return { backup: backup.rows[0], alert: alert.rows[0] };
       };
       let state = await read();
       if (state.alert?.state !== 'open') process.exitCode = 1;
       await records.resolveFailureAlert();
       await records.recordPruned(envelopeHash, 'local');
       state = await read();
       if (state.backup?.state !== 'complete' || !state.backup.local_pruned_at) process.exitCode = 1;
       await records.recordPruned(envelopeHash, 'offsite');
       state = await read();
       if (state.backup?.state !== 'pruned' || !state.backup.off_server_pruned_at || state.alert?.state !== 'resolved') process.exitCode = 1;
       client.release();
       await pool.end();`,
    ],
    { capture: true },
  );
  assert.equal(
    backupStatusQuery.status,
    0,
    'restricted backup status, copy lifecycle, and platform alerts must execute against migrated PostgreSQL',
  );

  let readiness;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      readiness = await fetch(`http://127.0.0.1:${apiPort}/health/ready`);
      if (readiness.ok) break;
    } catch {
      // A dependency restart may briefly race the API client's reconnect loop.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  assert.ok(readiness, 'API readiness endpoint did not respond');
  assert.equal(readiness.status, 200);
  assert.deepEqual(await readiness.json(), {
    authContract: 3,
    dependencies: ['postgres', 'redis'],
    status: 'ready',
  });

  const containerIds = dockerCompose(['ps', '--quiet'], { capture: true })
    .stdout.trim()
    .split(/\s+/u)
    .filter(Boolean);
  const inspection = run('docker', ['inspect', ...containerIds], { capture: true }).stdout;
  for (const secret of before) assert.ok(!inspection.includes(secret));

  dockerCompose(['run', '--rm', 'migrate']);

  console.log(
    JSON.stringify({
      apiReadiness: 'verified',
      analyticsQuery: 'verified against migrated PostgreSQL',
      authentication: 'verified',
      backupStatus: 'restricted recording, copy lifecycle, and alert transition verified',
      check: 'production-compose-runtime',
      credentialLeakage: 'not detected in rendered config or container metadata',
      isolation: 'verified',
      ok: true,
      persistence: 'verified after restart',
      staticAvailability: 'verified during control-plane restart',
      workers: 'six kinds healthy',
      project: basename(project),
    }),
  );
} catch (error) {
  if (stackCreated) {
    dockerCompose(['logs', '--no-color', 'migrate', 'postgres'], { allowFailure: true });
  }
  throw error;
} finally {
  if (stackCreated) {
    dockerCompose(['down', '--volumes', '--remove-orphans'], { allowFailure: true });
  }
  if (proxyNetworkCreated) {
    run('docker', ['network', 'rm', proxyNetwork], { allowFailure: true });
  }
  if (basename(temporaryRoot).startsWith('omnireach-production-compose-')) {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}
