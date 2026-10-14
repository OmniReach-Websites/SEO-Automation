#!/usr/bin/env node
import { appendFile, lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createEncryptedBackup,
  envelopeHashForFile,
  listBackupManifests,
  readBackupManifest,
  removeBackup,
  restoreEncryptedBackup,
  runLogicalDump,
  runLogicalRestore,
  selectRetention,
  verifyEncryptedBackup,
} from './backup.mjs';
import { PostgresBackupRecords } from './postgres-records.mjs';
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
  if (command === 'report-failure') return reportScheduledFailure(options);
  throw new Error(`Unknown backup command: ${command}`);
}

async function createBackup(options, environment) {
  const destinationRoot = requiredOption(options, 'destination');
  const key = await readSecretFile(requiredOption(options, 'key-file'));
  const kind = options.kind ?? 'daily';
  if (!['daily', 'weekly'].includes(kind)) throw new Error('Backup kind must be daily or weekly');
  const inputs = arrayOption(options, 'input').map((input) => resolve(input));
  const recorder = await recorderFromOptions(options);
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
      maximumFiles: optionalIntegerEnvironment(environment.BACKUP_MAX_FILES, 100_000),
      maximumSourceBytes: optionalIntegerEnvironment(
        environment.BACKUP_MAX_SOURCE_BYTES,
        512 * 1024 * 1024,
      ),
    });
    const verified = await verifyEncryptedBackup({
      backupPath: backup.backupPath,
      encryptionKeyHex: key,
      ...verificationLimits(environment),
    });
    let offsite;
    if (options.offsite) {
      const store = storeFromEnvironment(environment);
      const archive = await store.upload(backup.backupPath);
      const manifest = await store.upload(`${backup.backupPath}.manifest.json`);
      offsite = { archive, manifest };
    }
    const verifiedAt = new Date();
    if (recorder) {
      await recorder.recordComplete({
        byteSize: backup.byteSize,
        createdAt: new Date(verified.createdAt),
        envelopeHash: backup.envelopeHash,
        keyVersion: optionalIntegerEnvironment(environment.BACKUP_KEY_VERSION, 1),
        kind,
        manifest: {
          fileCount: verified.files.length,
          formatVersion: verified.formatVersion,
          sourceBytes: verified.sourceBytes,
        },
        ...(offsite ? { offServerCopiedAt: verifiedAt, offServerRef: offsite.archive.key } : {}),
        storageRef: backup.backupPath,
        verifiedAt,
      });
      await recorder.resolveFailureAlert();
    }
    return safeResult({
      command: 'backup',
      createdAt: verified.createdAt,
      files: verified.files.length,
      id: backup.id,
      localPath: backup.backupPath,
      offsite,
      sourceBytes: backup.manifest.sourceBytes,
      byteSize: backup.byteSize,
      verified: true,
    });
  } catch (error) {
    await reportBackupFailure(recorder, error, 'backup');
    throw error;
  } finally {
    if (temporary) await rm(temporary, { force: true, recursive: true });
    await recorder?.close();
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
  const recorder = await recorderFromOptions(options);
  let temporary;
  try {
    let backupPath = options.path;
    if (options['offsite-key']) {
      temporary = await mkdtemp(join(tmpdir(), 'omnireach-backup-verify-'));
      backupPath = join(temporary, basename(options['offsite-key']));
      await storeFromEnvironment(environment).download(options['offsite-key'], backupPath);
    }
    if (!backupPath) throw new Error('--path or --offsite-key is required');
    const manifest = await verifyEncryptedBackup({
      backupPath,
      encryptionKeyHex: key,
      ...verificationLimits(environment),
    });
    if (recorder) {
      await recorder.recordVerification(await envelopeHashForFile(backupPath), new Date());
      await recorder.resolveFailureAlert();
    }
    return safeResult({
      command: 'verify',
      createdAt: manifest.createdAt,
      files: manifest.files.length,
      kind: manifest.kind,
      verified: true,
    });
  } catch (error) {
    await reportBackupFailure(recorder, error, 'verify');
    throw error;
  } finally {
    if (temporary) await rm(temporary, { force: true, recursive: true });
    await recorder?.close();
  }
}

async function restoreBackup(options, environment) {
  if (options['confirm-isolated'] !== 'RESTORE') {
    throw new Error('Restore requires --confirm-isolated RESTORE');
  }
  const destinationRoot = resolve(requiredOption(options, 'destination'));
  rejectProductionRestoreTarget(destinationRoot, environment);
  const key = await readSecretFile(requiredOption(options, 'key-file'));
  let databaseUrl;
  if (options['database-url-file']) {
    databaseUrl = await readSecretFile(options['database-url-file']);
    rejectProductionDatabaseTarget(databaseUrl, environment);
  }
  const recorder = await recorderFromOptions(options);
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
      ...verificationLimits(environment),
    });
    let databaseRestored = false;
    if (databaseUrl) {
      const dumpPath = resolve(destinationRoot, 'postgres.dump');
      await runLogicalRestore(databaseUrl, dumpPath);
      databaseRestored = true;
    }
    if (databaseRestored && recorder) {
      await recorder.recordRestoreTest(await envelopeHashForFile(backupPath), new Date());
    }
    if (recorder) {
      await recorder.recordVerification(await envelopeHashForFile(backupPath), new Date());
      await recorder.resolveFailureAlert();
    }
    return safeResult({
      command: 'restore-to-disposable',
      databaseRestored,
      destinationRoot,
      files: manifest.files.length,
      restored: true,
    });
  } catch (error) {
    await reportBackupFailure(recorder, error, 'restore');
    throw error;
  } finally {
    if (temporary) await rm(temporary, { force: true, recursive: true });
    await recorder?.close();
  }
}

async function pruneBackups(options, environment) {
  const daily = integerOption(options.daily ?? '3', 'daily');
  const weekly = integerOption(options.weekly ?? '1', 'weekly');
  const apply = options.apply === true;
  const automated = options['automated-retention'] === true;
  if (automated && (daily !== 3 || weekly !== 1)) {
    throw new Error('Automated retention must use the approved 3-daily/1-weekly policy');
  }
  if (apply && !automated && !options['authorization-ref']) {
    throw new Error('Manual pruning requires --authorization-ref');
  }
  if (apply && !options['audit-log']) {
    throw new Error('Applied pruning requires --audit-log');
  }
  if (environment.OMNIREACH_ENV === 'production' && (daily < 3 || weekly < 1)) {
    throw new Error('Production pruning cannot reduce the approved 3-daily/1-weekly floor');
  }
  const recorder = apply ? await recorderFromOptions(options) : undefined;
  try {
    if (options.offsite) {
      return await pruneOffsite(options, environment, { apply, daily, weekly }, recorder);
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
        await recordDeletion(options, record, 'local', automated, 'requested');
        await removeBackup(root, record.path.replace(/\.manifest\.json$/u, ''));
        await removeBackup(root, record.path);
        await recorder?.recordPruned(record.envelopeHash, 'local');
        await recordDeletion(options, record, 'local', automated, 'completed');
      }
    }
    return safeResult({
      applied: apply,
      authorizationRef: options['authorization-ref'],
      mode: automated ? 'automatic' : 'manual',
      command: 'prune',
      ...retention,
    });
  } finally {
    await recorder?.close();
  }
}

async function reportScheduledFailure(options) {
  const recorder = await recorderFromOptions(options);
  if (!recorder) throw new Error('--record-database-url-file is required');
  try {
    await recorder.reportFailure('backup_failed');
    return safeResult({ command: 'report-failure', recorded: true });
  } finally {
    await recorder.close();
  }
}

async function pruneOffsite(options, environment, policy, recorder) {
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
        await recordDeletion(
          options,
          record,
          'offsite',
          options['automated-retention'] === true,
          'requested',
        );
        await store.remove(record.key.replace(/\.manifest\.json$/u, ''));
        await store.remove(record.key);
        await recorder?.recordPruned(record.envelopeHash, 'offsite');
        await recordDeletion(
          options,
          record,
          'offsite',
          options['automated-retention'] === true,
          'completed',
        );
      }
    }
    return safeResult({
      applied: policy.apply,
      authorizationRef: options['authorization-ref'],
      command: 'prune',
      mode: options['automated-retention'] === true ? 'automatic' : 'manual',
      source: 'offsite',
      ...retention,
    });
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
}

async function recorderFromOptions(options) {
  if (!options['record-database-url-file']) return undefined;
  return new PostgresBackupRecords({
    databaseUrl: await readSecretFile(options['record-database-url-file']),
  });
}

async function reportBackupFailure(recorder, error, phase) {
  if (!recorder) return;
  const errorCode = backupErrorCode(error, phase);
  try {
    await recorder.reportFailure(errorCode);
  } catch (alertError) {
    throw new AggregateError(
      [error, alertError],
      'Backup operation failed and its ORAP alert could not be recorded',
      { cause: alertError },
    );
  }
}

export function backupErrorCode(error, phase) {
  const message = error instanceof Error ? error.message : '';
  if (/limit|budget|exceeds/iu.test(message)) return 'backup_resource_limit';
  if (/off-site|\bR2\b/iu.test(message)) return 'offsite_transfer_failed';
  if (phase === 'backup' && /pg_dump/iu.test(message)) return 'database_dump_failed';
  if (
    phase !== 'backup' &&
    /authentication|checksum|archive|encrypted backup|source-byte/iu.test(message)
  ) {
    return 'integrity_verification_failed';
  }
  return 'backup_failed';
}

function storeFromEnvironment(environment) {
  return new S3CompatibleBackupStore({
    accessKeyId: environment.R2_ACCESS_KEY_ID,
    bucket: environment.R2_BUCKET,
    endpoint: environment.R2_ENDPOINT,
    maximumListObjects: optionalIntegerEnvironment(environment.BACKUP_R2_MAX_LIST_OBJECTS, 1_000),
    maximumListPages: optionalIntegerEnvironment(environment.BACKUP_R2_MAX_LIST_PAGES, 20),
    maximumListResponseBytes: optionalIntegerEnvironment(
      environment.BACKUP_R2_MAX_LIST_RESPONSE_BYTES,
      4 * 1024 * 1024,
    ),
    maximumObjectBytes: optionalIntegerEnvironment(
      environment.BACKUP_MAX_ENCRYPTED_BYTES,
      768 * 1024 * 1024,
    ),
    maximumTotalBytes: optionalIntegerEnvironment(
      environment.BACKUP_R2_MAX_TOTAL_BYTES,
      8 * 1024 * 1024 * 1024,
    ),
    maximumRequests: optionalIntegerEnvironment(environment.BACKUP_R2_MAX_REQUESTS, 100),
    prefix: environment.R2_BACKUP_PREFIX ?? 'omnireach',
    region: environment.R2_REGION ?? 'auto',
    secretAccessKey: environment.R2_SECRET_ACCESS_KEY,
  });
}

function rejectProductionRestoreTarget(target, environment) {
  const forbidden = (environment.OMNIREACH_PRODUCTION_ROOTS ?? '')
    .split(environment.OS === 'Windows_NT' || process.platform === 'win32' ? ';' : ':')
    .filter(Boolean)
    .map((value) => resolve(value));
  if (environment.OMNIREACH_ENV === 'production' && forbidden.length === 0) {
    throw new Error('Production restore roots must be configured before a restore');
  }
  if (forbidden.some((root) => pathsOverlap(target, root))) {
    throw new Error('Restore target overlaps a configured production root');
  }
}

function rejectProductionDatabaseTarget(databaseUrl, environment) {
  const target = postgresTarget(databaseUrl);
  const forbidden = (environment.OMNIREACH_PRODUCTION_DATABASE_TARGETS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (environment.OMNIREACH_ENV === 'production' && forbidden.length === 0) {
    throw new Error('Production database targets must be configured before a restore');
  }
  if (forbidden.includes(target)) {
    throw new Error('Restore database overlaps a configured production database');
  }
}

async function readSecretFile(path) {
  const absolute = resolve(path);
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Secret path must be a regular non-symbolic file');
  }
  if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
    throw new Error('Secret file permissions are too broad');
  }
  if (metadata.size > 16 * 1024) throw new Error('Secret file is unexpectedly large');
  const value = (await readFile(absolute, 'utf8')).trim();
  if (!value) throw new Error('Secret file is empty');
  return value;
}

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token?.startsWith('--')) throw new Error(`Unexpected argument: ${token ?? ''}`);
    const name = token.slice(2);
    if (['apply', 'automated-retention', 'help', 'offsite'].includes(name)) {
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

async function recordDeletion(options, record, source, automated, phase) {
  const auditPath = resolve(requiredOption(options, 'audit-log'));
  await mkdir(dirname(auditPath), { recursive: true });
  const entry = {
    authorizationRef: automated
      ? 'approved-automatic-3-daily-1-weekly'
      : options['authorization-ref'],
    backupId: record.id,
    envelopeHash: record.envelopeHash,
    event: 'backup.deletion',
    mode: automated ? 'automatic' : 'manual',
    phase,
    source,
    storageRef: record.path ?? record.key,
    timestamp: new Date().toISOString(),
  };
  await appendFile(auditPath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function pathsOverlap(left, right) {
  const normalize = (value) =>
    (process.platform === 'win32' ? value.toLowerCase() : value).replace(/[\\/]+$/u, '');
  const a = normalize(resolve(left));
  const b = normalize(resolve(right));
  return (
    a === b ||
    a.startsWith(`${b}/`) ||
    a.startsWith(`${b}\\`) ||
    b.startsWith(`${a}/`) ||
    b.startsWith(`${a}\\`)
  );
}

function postgresTarget(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('Invalid PostgreSQL restore connection URL');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    !parsed.username ||
    !database
  ) {
    throw new Error('Invalid PostgreSQL restore connection URL');
  }
  return `${parsed.hostname.toLowerCase()}:${parsed.port || '5432'}/${database.toLowerCase()}`;
}

function optionalIntegerEnvironment(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('Backup resource limit must be a positive integer');
  }
  return parsed;
}

function verificationLimits(environment) {
  return {
    maximumArchiveBytes: optionalIntegerEnvironment(
      environment.BACKUP_MAX_ARCHIVE_BYTES,
      768 * 1024 * 1024,
    ),
    maximumEncryptedBytes: optionalIntegerEnvironment(
      environment.BACKUP_MAX_ENCRYPTED_BYTES,
      768 * 1024 * 1024,
    ),
    maximumFiles: optionalIntegerEnvironment(environment.BACKUP_MAX_FILES, 100_000),
    maximumSourceBytes: optionalIntegerEnvironment(
      environment.BACKUP_MAX_SOURCE_BYTES,
      512 * 1024 * 1024,
    ),
  };
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
    commands: ['backup', 'list', 'verify', 'restore-to-disposable', 'prune', 'report-failure'],
    note: 'Secrets are read from files or the environment; prune is a dry run unless --apply is supplied.',
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runBackupCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Backup command failed'}\n`);
    process.exitCode = 1;
  });
}
