import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const execFileAsync = promisify(execFile);
export async function runLogicalDump(databaseUrl, targetPath) {
  const { databaseName, parsed } = parsePostgresUrl(databaseUrl, 'backup');
  await execFileAsync(
    'pg_dump',
    [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--file',
      targetPath,
      '--host',
      parsed.hostname,
      '--port',
      parsed.port || '5432',
      '--username',
      decodeURIComponent(parsed.username),
      '--dbname',
      databaseName,
    ],
    {
      env: { ...process.env, PGPASSWORD: decodeURIComponent(parsed.password) },
      timeout: 300_000,
      windowsHide: true,
    },
  );
}

export async function runLogicalRestore(databaseUrl, dumpPath) {
  const { databaseName, parsed } = parsePostgresUrl(databaseUrl, 'restore');
  const connectionArguments = [
    '--host',
    parsed.hostname,
    '--port',
    parsed.port || '5432',
    '--username',
    decodeURIComponent(parsed.username),
    '--dbname',
    databaseName,
  ];
  const processOptions = {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(parsed.password) },
    timeout: 600_000,
    windowsHide: true,
  };
  const { stdout } = await execFileAsync(
    'psql',
    [
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      ...connectionArguments,
      '--command',
      "SELECT count(*) FROM pg_catalog.pg_class WHERE relnamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace) AND relkind IN ('r','p','v','m','S','f')",
    ],
    processOptions,
  );
  if (stdout.trim() !== '0') {
    throw new Error('Restore database must be empty');
  }
  await execFileAsync(
    'pg_restore',
    ['--exit-on-error', '--no-owner', '--no-privileges', ...connectionArguments, dumpPath],
    processOptions,
  );
}
export async function createEncryptedBackup(options) {
  if (!['daily', 'weekly'].includes(options.kind)) {
    throw new Error('Backup kind must be daily or weekly');
  }
  if (!(options.createdAt instanceof Date) || Number.isNaN(options.createdAt.getTime())) {
    throw new Error('Backup creation time is invalid');
  }
  const files = [];
  const maximumFiles = validatePositiveLimit(options.maximumFiles ?? 100_000, 'file count');
  const maximumSourceBytes = validatePositiveLimit(
    options.maximumSourceBytes ?? 512 * 1024 * 1024,
    'source byte',
  );
  let sourceBytes = 0;
  for (const inputPath of [...options.inputPaths].sort()) {
    const absolute = resolve(inputPath);
    const sourceStat = await lstat(absolute);
    if (sourceStat.isSymbolicLink()) throw new Error('Backup input cannot be a symbolic link');
    const members = sourceStat.isDirectory()
      ? await walkFiles(absolute)
      : sourceStat.isFile()
        ? [absolute]
        : [];
    for (const member of members) {
      if (files.length >= maximumFiles) throw new Error('Backup exceeds the configured file limit');
      const name = sourceStat.isDirectory()
        ? join(basename(absolute), relative(absolute, member)).replaceAll('\\', '/')
        : basename(absolute);
      assertSafeMemberName(name);
      if (files.some((entry) => entry.name === name)) {
        throw new Error(`Duplicate backup member: ${name}`);
      }
      const memberStat = await lstat(member);
      if (!memberStat.isFile() || memberStat.isSymbolicLink()) {
        throw new Error('Backup member must be a regular non-symbolic file');
      }
      const data = await readFile(member);
      sourceBytes += data.byteLength;
      if (!Number.isSafeInteger(sourceBytes) || sourceBytes > maximumSourceBytes) {
        throw new Error('Backup exceeds the configured source-byte limit');
      }
      files.push({
        data: data.toString('base64'),
        name,
        sha256: createHash('sha256').update(data).digest('hex'),
      });
    }
  }
  if (files.length === 0) throw new Error('Backup input set has no files');
  const manifest = {
    createdAt: options.createdAt.toISOString(),
    files: files.map((entry) => ({ name: entry.name, sha256: entry.sha256 })),
    formatVersion: 1,
    kind: options.kind,
    sourceBytes,
  };
  const key = parseKey(options.encryptionKeyHex);
  try {
    const archive = await gzipAsync(Buffer.from(JSON.stringify({ files, manifest })));
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(archive), cipher.final()]);
    const envelope = Buffer.concat([Buffer.from('ORBK1'), iv, cipher.getAuthTag(), encrypted]);
    await mkdir(options.destinationRoot, { recursive: true });
    const id = `${options.createdAt.toISOString().replace(/[:.]/gu, '-')}-${options.kind}`;
    const backupPath = join(resolve(options.destinationRoot), `${id}.orbk`);
    await writeFile(backupPath, envelope, { flag: 'wx', mode: 0o600 });
    const envelopeHash = createHash('sha256').update(envelope).digest('hex');
    await writeFile(
      `${backupPath}.manifest.json`,
      `${JSON.stringify({ ...manifest, byteSize: envelope.byteLength, envelopeHash, id })}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    return { backupPath, byteSize: envelope.byteLength, envelopeHash, id, manifest };
  } finally {
    key.fill(0);
  }
}
export async function restoreEncryptedBackup(options) {
  const destination = resolve(options.destinationRoot);
  if (destination === resolve(sep)) throw new Error('Refusing broad restore target');
  const parsed = await readAndVerifyEncryptedBackup(options);
  let destinationState;
  try {
    destinationState = await stat(destination);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (destinationState && !destinationState.isDirectory()) {
    throw new Error('Restore target must be a directory');
  }
  if (destinationState && (await readdir(destination)).length !== 0) {
    throw new Error('Restore target must be new or empty');
  }
  await mkdir(destination, { recursive: true });
  for (const file of parsed.files) {
    const target = resolve(destination, file.name);
    if (!target.startsWith(`${destination}${sep}`)) throw new Error('Unsafe backup path rejected');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.data, { flag: 'wx', mode: 0o600 });
  }
  return parsed.manifest;
}

export async function verifyEncryptedBackup(options) {
  const parsed = await readAndVerifyEncryptedBackup(options);
  return parsed.manifest;
}

export async function envelopeHashForFile(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function readAndVerifyEncryptedBackup(options) {
  const envelope = await readFile(options.backupPath);
  const maximumEncryptedBytes = validatePositiveLimit(
    options.maximumEncryptedBytes ?? 768 * 1024 * 1024,
    'encrypted byte',
  );
  if (envelope.byteLength > maximumEncryptedBytes) {
    throw new Error('Encrypted backup exceeds the configured verification limit');
  }
  const maximumArchiveBytes = validatePositiveLimit(
    options.maximumArchiveBytes ?? 768 * 1024 * 1024,
    'decompressed archive byte',
  );
  const maximumFiles = validatePositiveLimit(options.maximumFiles ?? 100_000, 'file count');
  const maximumSourceBytes = validatePositiveLimit(
    options.maximumSourceBytes ?? 512 * 1024 * 1024,
    'source byte',
  );
  if (envelope.subarray(0, 5).toString() !== 'ORBK1')
    throw new Error('Unknown or corrupt backup format');
  const key = parseKey(options.encryptionKeyHex);
  const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(5, 17));
  decipher.setAuthTag(envelope.subarray(17, 33));
  let archive;
  try {
    archive = Buffer.concat([decipher.update(envelope.subarray(33)), decipher.final()]);
  } catch (error) {
    throw new Error('Backup authentication failed', { cause: error });
  } finally {
    key.fill(0);
  }
  let parsed;
  try {
    parsed = JSON.parse(
      (await gunzipAsync(archive, { maxOutputLength: maximumArchiveBytes })).toString('utf8'),
    );
  } catch (error) {
    throw new Error('Backup archive is not valid compressed JSON', { cause: error });
  }
  if (
    parsed?.manifest?.formatVersion !== 1 ||
    !Array.isArray(parsed.manifest.files) ||
    !Array.isArray(parsed.files) ||
    parsed.manifest.files.length > maximumFiles ||
    parsed.files.length > maximumFiles ||
    !Number.isSafeInteger(parsed.manifest.sourceBytes) ||
    parsed.manifest.sourceBytes < 0 ||
    parsed.manifest.sourceBytes > maximumSourceBytes
  ) {
    throw new Error('Unsupported or incomplete backup archive');
  }
  const expected = new Map(parsed.manifest.files.map((file) => [file.name, file.sha256]));
  if (expected.size !== parsed.files.length) throw new Error('Backup manifest member mismatch');
  const verifiedFiles = [];
  let sourceBytes = 0;
  for (const file of parsed.files) {
    assertSafeMemberName(file.name);
    if (
      typeof file.data !== 'string' ||
      !isCanonicalBase64(file.data) ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      expected.get(file.name) !== file.sha256
    )
      throw new Error('Backup manifest checksum mismatch');
    const data = Buffer.from(file.data, 'base64');
    sourceBytes += data.byteLength;
    if (!Number.isSafeInteger(sourceBytes) || sourceBytes > maximumSourceBytes) {
      throw new Error('Backup exceeds the configured source-byte limit');
    }
    if (createHash('sha256').update(data).digest('hex') !== file.sha256)
      throw new Error('Backup member checksum mismatch');
    verifiedFiles.push({ data, name: file.name });
  }
  if (sourceBytes !== parsed.manifest.sourceBytes) {
    throw new Error('Backup source-byte total mismatch');
  }
  return { files: verifiedFiles, manifest: parsed.manifest };
}
export async function copyOffServer(backupPath, offServerRoot) {
  await mkdir(offServerRoot, { recursive: true });
  const target = join(resolve(offServerRoot), basename(backupPath));
  await copyFile(backupPath, target);
  const [source, copied] = await Promise.all([readFile(backupPath), readFile(target)]);
  if (
    createHash('sha256').update(source).digest('hex') !==
    createHash('sha256').update(copied).digest('hex')
  ) {
    await rm(target, { force: true });
    throw new Error('Off-server copy checksum mismatch');
  }
  return target;
}
export function selectRetention(manifests, now, policy = {}) {
  void now;
  const daily = validateRetentionCount(policy.daily ?? 3, 'daily');
  const weekly = validateRetentionCount(policy.weekly ?? 1, 'weekly');
  const sorted = [...manifests]
    .filter((item) => item.complete)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const keep = new Set();
  for (const item of sorted.filter((entry) => entry.hold || entry.active)) keep.add(item.id);
  for (const item of sorted.filter((entry) => entry.kind === 'daily').slice(0, daily))
    keep.add(item.id);
  for (const item of sorted.filter((entry) => entry.kind === 'weekly').slice(0, weekly))
    keep.add(item.id);
  return {
    keep: [...keep],
    prune: sorted
      .filter((item) => !keep.has(item.id) && !item.hold && !item.active)
      .map((item) => item.id),
  };
}
export async function listBackupManifests(root) {
  let entries;
  try {
    entries = await readdir(root);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries.filter((name) => name.endsWith('.manifest.json')).map((name) => join(root, name));
}
export async function removeBackup(root, path) {
  const absoluteRoot = resolve(root);
  const absolute = resolve(path);
  if (!absolute.startsWith(`${absoluteRoot}${sep}`)) throw new Error('Backup prune escaped root');
  await rm(absolute);
}

export async function readBackupManifest(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (
    parsed?.formatVersion !== 1 ||
    typeof parsed.id !== 'string' ||
    !/^[A-Za-z0-9._-]{1,180}$/u.test(parsed.id) ||
    typeof parsed.createdAt !== 'string' ||
    Number.isNaN(Date.parse(parsed.createdAt)) ||
    !['daily', 'weekly'].includes(parsed.kind) ||
    typeof parsed.envelopeHash !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(parsed.envelopeHash) ||
    !Number.isSafeInteger(parsed.byteSize) ||
    parsed.byteSize < 0 ||
    !Number.isSafeInteger(parsed.sourceBytes) ||
    parsed.sourceBytes < 0 ||
    !Array.isArray(parsed.files) ||
    parsed.files.length > 100_000 ||
    parsed.files.some(
      (file) =>
        !file ||
        typeof file !== 'object' ||
        typeof file.name !== 'string' ||
        typeof file.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(file.sha256),
    )
  ) {
    throw new Error('Invalid backup manifest');
  }
  for (const file of parsed.files) assertSafeMemberName(file.name);
  return parsed;
}
function parseKey(value) {
  if (!/^[a-f0-9]{64}$/iu.test(value)) throw new Error('Backup key must be exactly 32 bytes');
  return Buffer.from(value, 'hex');
}

function isCanonicalBase64(value) {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    return false;
  }
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function validateRetentionCount(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 366) {
    throw new Error(`Invalid ${label} retention count`);
  }
  return value;
}

function validatePositiveLimit(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid backup ${label} limit`);
  return value;
}

function parsePostgresUrl(databaseUrl, purpose) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(`Invalid PostgreSQL ${purpose} connection URL`);
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    !parsed.username ||
    !parsed.pathname
  ) {
    throw new Error(`Invalid PostgreSQL ${purpose} connection URL`);
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!databaseName || databaseName.includes('/')) {
    throw new Error('Invalid PostgreSQL database name');
  }
  return { databaseName, parsed };
}

async function walkFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Backup input contains a symbolic link: ${entry.name}`);
    if (entry.isDirectory()) result.push(...(await walkFiles(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}

function assertSafeMemberName(name) {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.startsWith('/') ||
    name.startsWith('\\') ||
    /^[A-Za-z]:/u.test(name) ||
    name.split(/[\\/]/u).some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error('Unsafe backup path rejected');
  }
}
