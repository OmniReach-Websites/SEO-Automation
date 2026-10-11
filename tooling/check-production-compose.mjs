import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const composePath = resolve(root, 'infrastructure/compose/production.compose.yml');
const scriptsDirectory = resolve(root, 'infrastructure/compose/scripts');
const deployWorkflowPath = resolve(root, '.github/workflows/deploy-artifact.yml');

export function checkProductionCompose() {
  const source = readFileSync(composePath, 'utf8');
  const compose = parse(source, { merge: true });
  const errors = [];
  const requiredServices = ['postgres', 'redis', 'migrate', 'platform-data-init', 'api'];

  if (compose.name !== 'omnireach-production') errors.push('unexpected production project name');
  for (const service of requiredServices) {
    if (!compose.services?.[service]) errors.push(`missing production service ${service}`);
  }

  for (const serviceName of ['postgres', 'redis']) {
    const service = compose.services?.[serviceName];
    if (!service?.image?.includes('@sha256:')) {
      errors.push(`${serviceName} image is not digest-pinned`);
    }
    if ((service?.ports ?? []).length > 0) {
      errors.push(`${serviceName} must not publish a host port`);
    }
    if (!(service?.networks ?? []).includes('backend')) {
      errors.push(`${serviceName} must use the private backend network`);
    }
    if (!service?.healthcheck) errors.push(`${serviceName} is missing a health check`);
    if (service?.restart !== 'unless-stopped') {
      errors.push(`${serviceName} must restart unless stopped`);
    }
    if (!service?.cpus || !service?.mem_limit || !service?.pids_limit) {
      errors.push(`${serviceName} is missing resource limits`);
    }
    if (!(service?.security_opt ?? []).includes('no-new-privileges:true')) {
      errors.push(`${serviceName} does not prohibit privilege escalation`);
    }
  }

  if (compose.networks?.backend?.internal !== true) {
    errors.push('backend network must be internal');
  }
  for (const serviceName of ['postgres', 'redis']) {
    if ((compose.services?.[serviceName]?.networks ?? []).includes('egress')) {
      errors.push(`${serviceName} must not join the egress network`);
    }
  }

  const postgres = compose.services?.postgres;
  if (postgres?.environment?.POSTGRES_USER !== 'omnireach_db_admin') {
    errors.push('PostgreSQL bootstrap user must be the dedicated administrative role');
  }
  if (postgres?.environment?.POSTGRES_PASSWORD_FILE !== '/run/secrets/postgres_admin_password') {
    errors.push('PostgreSQL admin password must use the Docker secret file');
  }
  if (!(postgres?.volumes ?? []).includes('postgres-data:/var/lib/postgresql/data')) {
    errors.push('PostgreSQL data directory is not a named volume');
  }

  const redis = compose.services?.redis;
  if (!(redis?.volumes ?? []).includes('redis-data:/data')) {
    errors.push('Redis data directory is not a named volume');
  }
  if (!(redis?.secrets ?? []).includes('redis_app_password')) {
    errors.push('Redis application password is not a mounted secret');
  }

  const api = compose.services?.api;
  if (!String(api?.ports?.[0] ?? '').startsWith('127.0.0.1:')) {
    errors.push('API must bind to host loopback pending Caddy integration');
  }
  for (const secret of [
    'postgres_app_password',
    'redis_app_password',
    'session_secret',
    'mfa_encryption_key',
    'preview_signing_key',
    'contact_encryption_key',
  ]) {
    if (!(api?.secrets ?? []).includes(secret)) errors.push(`API is missing secret ${secret}`);
  }

  const declaredVolumes = ['platform-data', 'postgres-data', 'redis-data'];
  for (const volume of declaredVolumes) {
    if (!compose.volumes?.[volume]?.name?.includes('OMNIREACH_RESOURCE_PREFIX')) {
      errors.push(`${volume} must have a unique, configurable production name`);
    }
  }

  const runtime = readFileSync(resolve(scriptsDirectory, 'runtime-entrypoint.sh'), 'utf8');
  for (const expected of [
    'postgresql://omnireach_runtime:',
    '@postgres:5432/omnireach',
    'redis://omnireach_runtime:',
    '@redis:6379/0',
  ]) {
    if (!runtime.includes(expected)) errors.push(`runtime entrypoint is missing ${expected}`);
  }

  const migration = readFileSync(resolve(scriptsDirectory, 'migrate-entrypoint.sh'), 'utf8');
  for (const expected of [
    'NOSUPERUSER',
    'NOCREATEDB',
    'NOCREATEROLE',
    'NOINHERIT',
    'NOBYPASSRLS',
    'GRANT omnireach_app, omnireach_auth, omnireach_platform, omnireach_worker',
  ]) {
    if (!migration.includes(expected)) errors.push(`migration entrypoint is missing ${expected}`);
  }

  const redisEntrypoint = readFileSync(resolve(scriptsDirectory, 'redis-entrypoint.sh'), 'utf8');
  for (const expected of ['user default off', 'user omnireach_runtime on', '--aclfile']) {
    if (!redisEntrypoint.includes(expected)) {
      errors.push(`Redis entrypoint is missing ${expected}`);
    }
  }

  const bootstrap = readFileSync(resolve(scriptsDirectory, 'bootstrap-secrets.sh'), 'utf8');
  if (!bootstrap.includes('openssl rand -hex 32')) errors.push('bootstrap lacks strong generation');
  if (!bootstrap.includes('if [ -e "$target" ]')) errors.push('bootstrap is not idempotent');
  if (/set\s+-x/u.test(bootstrap)) errors.push('bootstrap may echo secret-bearing commands');

  const indexedModes = execFileSync(
    'git',
    [
      'ls-files',
      '--stage',
      'infrastructure/compose/scripts/bootstrap-secrets.sh',
      'infrastructure/compose/scripts/migrate-entrypoint.sh',
      'infrastructure/compose/scripts/redis-entrypoint.sh',
      'infrastructure/compose/scripts/runtime-entrypoint.sh',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  for (const script of [
    'bootstrap-secrets.sh',
    'migrate-entrypoint.sh',
    'redis-entrypoint.sh',
    'runtime-entrypoint.sh',
  ]) {
    const line = indexedModes.split(/\r?\n/u).find((entry) => entry.endsWith(`/scripts/${script}`));
    if (!line?.startsWith('100755 ')) errors.push(`${script} must be executable in Git`);
  }

  if (/POSTGRES_PASSWORD:\s*(?!FILE)/u.test(source)) {
    errors.push('production Compose contains a literal PostgreSQL password setting');
  }
  if (/requirepass/u.test(source)) {
    errors.push('production Compose exposes Redis password configuration in command metadata');
  }

  const deployWorkflow = readFileSync(deployWorkflowPath, 'utf8');
  for (const expected of [
    '--target runtime',
    '--target migrator',
    'omnireach-images.tar.gz',
    'omnireach-images.tar.gz.sha256',
  ]) {
    if (!deployWorkflow.includes(expected)) {
      errors.push(`deployment artifact is missing ${expected}`);
    }
  }

  return { errors, ok: errors.length === 0 };
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = checkProductionCompose();
  console.log(JSON.stringify({ check: 'production-compose', ...result }));
  process.exitCode = result.ok ? 0 : 1;
}
