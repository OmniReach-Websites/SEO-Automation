#!/usr/bin/env node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createEncryptedBackup,
  listBackupManifests,
  readBackupManifest,
  removeBackup,
  restoreEncryptedBackup,
  runLogicalDump,
  selectRetention,
  verifyEncryptedBackup,
} from './backup.mjs';
import { S3CompatibleBackupStore } from './s3-compatible.mjs';

export async function runBackupCli(argv, environment = process.env) {
  const [command, ...rest] = argv;
  const options = parseArguments(rest);
  if (!command || options.help) return usage();
  if (command === 'backup') return createBackup(options, environment);
  if (command === 'list') return listBackups(options, environment);
  if (command === 'verify') return verifyBackup(options, environment);
  if (command === 'restore-to-disposable') return restoreBackup(options, environment);
  if (command === 'prune') return pruneBackups(options, environment);
  throw new Error(`Unknown backup command: ${command}`);
}

async function createBackup(options, environment) {
  const destinationRoot = requiredOption(options, 'destination');
  const key = await readSecretFile(requiredOption(options, 'key-file'));
  const kind = options.kind ?? 'daily';
  if (!['daily', 'weekly'].includes(kind)) throw new Error('Backup kind must be daily or weekly');
  const inputs = arrayOption(options, 'input').map(resolve);
  let temporary;
  try {
    if (options['database-url-file']) {
      temporary = await mkdtemp(join(tmpdir(), 'omnireach-pg-backup-'));
      const dump = join(temporary, 'postgres.dump');
      await runLogicalDump(await readSecretFile(options['database-url-file']), dump);
      inputs.unshift(dump);
    }
    if (inputs.length === 0)
      throw new Error('At least one --input or --database-url-file is required');
    const backup = await createEncryptedBackup({
      createdAt: new Date(),
      destinationRoot,
      encryptionKeyHex: key,
      inputPaths: inputs,
      kind,
    });
    const verified = await verifyEncryptedBackup({
      backupPath: backup.backupPath,
      encryptionKeyHex: key,
    });
    let offsite;
    if (options.offsite) {
      const store = storeFromEnvironment(environment);
      const archive = await store.upload(backup.backupPath);
      const manifest = await store.upload(`${backup.backupPath}.manifest.json`);
      offsite = { archive, manifest };
    }
    return safeResult({
      command: 'backup',
      createdAt: verified.createdAt,
      files: verified.files.length,
      id: backup.id,
      localPath: backup.backupPath,
      offsite,
      verified: true,
    });
  } finally {
    if (temporary) await rm(temporary, { force: true, recursive: true });
  }
}

async function listBackups(options, environment) {
  if (options.offsite) {
    const objects = await storeFromEnvironment(environment).list();
    return safeResult({ command: 'list', objects, source: 'offsite' });
  }
  const root = requiredOption(options, 'root');
  const manifests = await Promise.all(
    (await listBackupManifests(root)).map(async (path) => ({
      ...(await readBackupManifest(path)),
      path,
    })),
  );
  return safeResult({ command: 'list', manifests, source: 'local' });
}

async function verifyBackup(options, environment) {
  const key = await readSecretFile(requiredOption(options, 'key-file'));
  let temporary;
  try {
    let backupPath = options.path;
    if (options['offsite-key']) {
      temporary = await mkdtemp(join(tmpdir(), 'omnireach-backup-verify-'));
      backupPath = join(temporary, basename(options['offsite-key']));
      await storeFromEnvironment(environment).download(options['offsite-key'], backupPath);
    }
    if (!backupPath) throw new Error('--path or --offsite-key is required');
    const manifest = await verifyEncryptedBackup({ backupPath, encryptionKeyHex: key });
    return safeResult({
      command: 'verify',
      createdAt: manifest.createdAt,
      files: manifest.files.length,
      kind: manifest.kind,
      verified: true,
    });
  } finally {
    if (temporary) await rm(temporary, { force: true, recursive: true });
  }
}

async function restoreBackup(options, environment) {
  if (options['confirm-isolated'] !== 'RESTORE') {
    throw new Error('Restore requires --confirm-isolated RESTORE');
  }
  const destinationRoot = resolve(requiredOption(options, 'destination'));
  rejectProductionRestoreTarget(destinationRoot, environment);
  const key = await readSecretFile(requiredOption(options, 'key-file'));
  let temporary;
  try {
    let backupPath = options.path;
    if (options['offsite-key']) {
      temporary = await mkdtemp(join(tmpdir(), 'omnireach-backup-restore-'));
      backupPath = join(temporary, basename(options['offsite-key']));
      await storeFromEnvironment(environment).download(options['offsite-key'], backupPath);
    }
    if (!backupPath) throw new Error('--path or --offsite-key is required');
    const manifest = await restoreEncryptedBackup({
      backupPath,
      destinationRoot,
      encryptionKeyHex: key,
    });
    return safeResult({
      command: 'restore-to-disposable',
      destinationRoot,
      files: manifest.files.length,
      restored: true,
    });
  } finally {
    if (temporary) await rm(temporary, { force: true, recursive: true });
  }
}

async function pruneBackups(options, environment) {
  const daily = integerOption(options.daily ?? '7', 'daily');
  const weekly = integerOption(options.weekly ?? '4', 'weekly');
  const apply = options.apply === true;
  if (apply && !options['authorization-ref']) {
    throw new Error('Applied pruning requires --authorization-ref');
  }
  if (environment.OMNIREACH_ENV === 'production' && (daily < 7 || weekly < 4)) {
    throw new Error('Production pruning cannot reduce the approved 7-daily/4-weekly floor');
  }
  if (options.offsite) {
    return pruneOffsite(options, environment, { apply, daily, weekly });
  }
  const root = resolve(requiredOption(options, 'root'));
  const paths = await listBackupManifests(root);
  const records = await Promise.all(
    paths.map(async (path) => ({
      ...(await readBackupManifest(path)),
      active: false,
      complete: true,
      hold: false,
      path,
    })),
  );
  const retention = selectRetention(records, new Date(), { daily, weekly });
  if (apply) {
    for (const id of retention.prune) {
      const record = records.find((item) => item.id === id);
      if (!record) continue;
      await removeBackup(root, record.path);
      await removeBackup(root, record.path.replace(/\.manifest\.json$/u, '.orbk'));
    }
  }
  return safeResult({
    applied: apply,
    authorizationRef: options['authorization-ref'],
    command: 'prune',
    ...retention,
  });
}

async function pruneOffsite(options, environment, policy) {
  const store = storeFromEnvironment(environment);
  const objects = await store.list();
  const manifestObjects = objects.filter((item) => item.key.endsWith('.manifest.json'));
  const records = [];
  const temporary = await mkdtemp(join(tmpdir(), 'omnireach-backup-prune-'));
  try {
    for (const object of manifestObjects) {
      const path = join(temporary, basename(object.key));
      await store.download(object.key, path);
      records.push({
        ...(await readBackupManifest(path)),
        active: false,
        complete: true,
        hold: false,
        key: object.key,
      });
    }
    const retention = selectRetention(records, new Date(), policy);
    if (policy.apply) {
      for (const id of retention.prune) {
        const record = records.find((item) => item.id === id);
        if (!record) continue;
        await store.remove(record.key);
        await store.remove(record.key.replace(/\.manifest\.json$/u, '.orbk'));
      }
    }
    return safeResult({
      applied: policy.apply,
      authorizationRef: options['authorization-ref'],
      command: 'prune',
      source: 'offsite',
      ...retention,
    });
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
}

function storeFromEnvironment(environment) {
  return new S3CompatibleBackupStore({
    accessKeyId: environment.R2_ACCESS_KEY_ID,
    bucket: environment.R2_BUCKET,
    endpoint: environment.R2_ENDPOINT,
    prefix: environment.R2_BACKUP_PREFIX ?? 'omnireach',
    region: environment.R2_REGION ?? 'auto',
    secretAccessKey: environment.R2_SECRET_ACCESS_KEY,
  });
}

function rejectProductionRestoreTarget(target, environment) {
  const forbidden = (environment.OMNIREACH_PRODUCTION_ROOTS ?? '')
    .split(environment.OS === 'Windows_NT' ? ';' : ':')
    .filter(Boolean)
    .map(resolve);
  if (
    forbidden.some(
      (root) => target === root || target.startsWith(`${root}/`) || target.startsWith(`${root}\\`),
    )
  ) {
    throw new Error('Restore target overlaps a configured production root');
  }
}

async function readSecretFile(path) {
  const value = (await readFile(resolve(path), 'utf8')).trim();
  if (!value) throw new Error('Secret file is empty');
  return value;
}

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token?.startsWith('--')) throw new Error(`Unexpected argument: ${token ?? ''}`);
    const name = token.slice(2);
    if (['apply', 'help', 'offsite'].includes(name)) {
      parsed[name] = true;
      continue;
    }
    const value = values[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`);
    index += 1;
    parsed[name] = name === 'input' ? [...(parsed[name] ?? []), value] : value;
  }
  return parsed;
}

function arrayOption(options, name) {
  const value = options[name];
  return Array.isArray(value) ? value : value ? [value] : [];
}

function integerOption(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 366) {
    throw new Error(`--${name} must be an integer between 0 and 366`);
  }
  return parsed;
}

function requiredOption(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || !value) throw new Error(`--${name} is required`);
  return value;
}

function safeResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

function usage() {
  return safeResult({
    commands: ['backup', 'list', 'verify', 'restore-to-disposable', 'prune'],
    note: 'Secrets are read from files or the environment; prune is a dry run unless --apply is supplied.',
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runBackupCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Backup command failed'}\n`);
    process.exitCode = 1;
  });
}
