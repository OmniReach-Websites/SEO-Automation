import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const releasePattern = /^[a-f0-9]{40}$/u;
const migrationPattern = /^\d{14}_[a-z0-9_]+$/u;
const execFileAsync = promisify(execFile);
const metadataKeys = [
  'OMNIREACH_RELEASE_METADATA_VERSION',
  'OMNIREACH_RELEASE_ID',
  'OMNIREACH_SOURCE_COMMIT',
  'OMNIREACH_AUTH_CONTRACT',
  'OMNIREACH_SCHEMA_MIN',
  'OMNIREACH_SCHEMA_MAX',
  'OMNIREACH_SCHEMA_TARGET',
  'OMNIREACH_CRYPTO_READ_MIN',
  'OMNIREACH_CRYPTO_READ_MAX',
  'OMNIREACH_CRYPTO_WRITE',
  'OMNIREACH_MIGRATION_HEAD',
  'OMNIREACH_MIGRATION_COUNT',
];

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  if (actual.join('\0') !== [...expected].sort().join('\0')) {
    throw new Error(`${label} has unknown or missing fields`);
  }
}

export function parseReleaseContractManifest(source) {
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch {
    throw new Error('Release contract manifest is not valid JSON');
  }
  exactKeys(manifest, ['manifestVersion', 'authContract', 'schema', 'crypto'], 'Manifest');
  exactKeys(manifest.schema, ['minimum', 'maximum', 'target'], 'Schema contract');
  exactKeys(manifest.crypto, ['readMinimum', 'readMaximum', 'write'], 'Crypto contract');
  if (manifest.manifestVersion !== 1) throw new Error('Unsupported release contract manifest');

  const contract = {
    authContract: positiveInteger(manifest.authContract, 'Authentication contract'),
    cryptoReadMaximum: positiveInteger(manifest.crypto.readMaximum, 'Crypto read maximum'),
    cryptoReadMinimum: positiveInteger(manifest.crypto.readMinimum, 'Crypto read minimum'),
    cryptoWrite: positiveInteger(manifest.crypto.write, 'Crypto write contract'),
    schemaMaximum: positiveInteger(manifest.schema.maximum, 'Schema maximum'),
    schemaMinimum: positiveInteger(manifest.schema.minimum, 'Schema minimum'),
    schemaTarget: positiveInteger(manifest.schema.target, 'Schema target'),
  };
  if (
    contract.schemaMinimum > contract.schemaTarget ||
    contract.schemaTarget > contract.schemaMaximum
  ) {
    throw new Error('Manifest schema target is outside its compatibility range');
  }
  if (
    contract.cryptoReadMinimum > contract.cryptoWrite ||
    contract.cryptoWrite > contract.cryptoReadMaximum
  ) {
    throw new Error('Manifest crypto write contract is outside its read compatibility range');
  }
  return contract;
}

export function assertManifestMatchesSourceCapabilities(contract, authSecretsSource) {
  const hasVersionedKeyring =
    /\binterface\s+VersionedSecretKeyring\b/u.test(authSecretsSource) &&
    /\bcreateVersionedSecretKeyring\b/u.test(authSecretsSource);
  const fullyDeclaresVersionedKeyring =
    contract.cryptoReadMaximum >= 2 && contract.cryptoWrite >= 2;
  const claimsVersionedKeyring = contract.cryptoReadMaximum >= 2 || contract.cryptoWrite >= 2;
  if (hasVersionedKeyring && !fullyDeclaresVersionedKeyring) {
    throw new Error('Versioned keyring source requires crypto contract 2 or newer');
  }
  if (!hasVersionedKeyring && claimsVersionedKeyring) {
    throw new Error('Crypto contract claims versioned keyring support absent from source');
  }
  return true;
}

export function renderReleaseMetadata({ contract, migrationCount, migrationHead, releaseId }) {
  if (!releasePattern.test(releaseId)) throw new Error('Release ID must be a commit SHA');
  if (!migrationPattern.test(migrationHead)) throw new Error('Migration head is invalid');
  if (!Number.isSafeInteger(migrationCount) || migrationCount < 1) {
    throw new Error('Migration count must be a positive integer');
  }

  return [
    'OMNIREACH_RELEASE_METADATA_VERSION=2',
    `OMNIREACH_RELEASE_ID=${releaseId}`,
    `OMNIREACH_SOURCE_COMMIT=${releaseId}`,
    `OMNIREACH_AUTH_CONTRACT=${contract.authContract}`,
    `OMNIREACH_SCHEMA_MIN=${contract.schemaMinimum}`,
    `OMNIREACH_SCHEMA_MAX=${contract.schemaMaximum}`,
    `OMNIREACH_SCHEMA_TARGET=${contract.schemaTarget}`,
    `OMNIREACH_CRYPTO_READ_MIN=${contract.cryptoReadMinimum}`,
    `OMNIREACH_CRYPTO_READ_MAX=${contract.cryptoReadMaximum}`,
    `OMNIREACH_CRYPTO_WRITE=${contract.cryptoWrite}`,
    `OMNIREACH_MIGRATION_HEAD=${migrationHead}`,
    `OMNIREACH_MIGRATION_COUNT=${migrationCount}`,
    '',
  ].join('\n');
}

export function parseReleaseMetadata(source, expectedReleaseId) {
  if (!releasePattern.test(expectedReleaseId)) throw new Error('Expected release ID is invalid');
  const entries = new Map();
  for (const line of source.split(/\r?\n/u)) {
    if (!line) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('Release metadata line is malformed');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!metadataKeys.includes(key)) throw new Error(`Unknown release metadata key: ${key}`);
    if (entries.has(key)) throw new Error(`Duplicate release metadata key: ${key}`);
    entries.set(key, value);
  }
  if (entries.size !== metadataKeys.length) throw new Error('Release metadata is incomplete');

  const releaseId = entries.get('OMNIREACH_RELEASE_ID');
  const sourceCommit = entries.get('OMNIREACH_SOURCE_COMMIT');
  const migrationHead = entries.get('OMNIREACH_MIGRATION_HEAD');
  const integer = (key) => {
    const value = entries.get(key) ?? '';
    if (!/^[1-9]\d*$/u.test(value)) throw new Error(`${key} must be a positive integer`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${key} must be a safe integer`);
    return parsed;
  };
  if (entries.get('OMNIREACH_RELEASE_METADATA_VERSION') !== '2') {
    throw new Error('Unsupported release metadata version');
  }
  if (releaseId !== expectedReleaseId || sourceCommit !== expectedReleaseId) {
    throw new Error('Release metadata identity mismatch');
  }
  if (!migrationHead || !migrationPattern.test(migrationHead)) {
    throw new Error('Release metadata migration head is invalid');
  }
  const metadata = {
    authContract: integer('OMNIREACH_AUTH_CONTRACT'),
    cryptoReadMaximum: integer('OMNIREACH_CRYPTO_READ_MAX'),
    cryptoReadMinimum: integer('OMNIREACH_CRYPTO_READ_MIN'),
    cryptoWrite: integer('OMNIREACH_CRYPTO_WRITE'),
    migrationCount: integer('OMNIREACH_MIGRATION_COUNT'),
    migrationHead,
    releaseId,
    schemaMaximum: integer('OMNIREACH_SCHEMA_MAX'),
    schemaMinimum: integer('OMNIREACH_SCHEMA_MIN'),
    schemaTarget: integer('OMNIREACH_SCHEMA_TARGET'),
  };
  if (
    metadata.schemaMinimum > metadata.schemaTarget ||
    metadata.schemaTarget > metadata.schemaMaximum
  ) {
    throw new Error('Release schema target is outside its compatibility range');
  }
  if (
    metadata.cryptoReadMinimum > metadata.cryptoWrite ||
    metadata.cryptoWrite > metadata.cryptoReadMaximum
  ) {
    throw new Error('Release crypto write contract is outside its read compatibility range');
  }
  return metadata;
}

export function assertReleaseMetadataSupports(
  metadata,
  { authContract, cryptoContract, schemaContract },
) {
  if (metadata.authContract !== authContract) {
    throw new Error('Release authentication contract is incompatible');
  }
  if (schemaContract < metadata.schemaMinimum || schemaContract > metadata.schemaMaximum) {
    throw new Error('Release schema contract is incompatible');
  }
  if (cryptoContract < metadata.cryptoReadMinimum || cryptoContract > metadata.cryptoReadMaximum) {
    throw new Error('Release crypto/keyring contract is incompatible');
  }
  return true;
}

export async function verifyReleaseContract({ authSecretsPath, manifestPath }) {
  const [authSecretsSource, contractSource] = await Promise.all([
    readFile(authSecretsPath, 'utf8'),
    readFile(manifestPath, 'utf8'),
  ]);
  const contract = parseReleaseContractManifest(contractSource);
  assertManifestMatchesSourceCapabilities(contract, authSecretsSource);
  return contract;
}

export async function createReleaseMetadata({
  authSecretsPath,
  manifestPath,
  migrationsRoot,
  outputPath,
  releaseId,
  sourceCommit,
}) {
  if (sourceCommit !== releaseId) throw new Error('Release ID does not match checked-out source');
  const [contract, migrations] = await Promise.all([
    verifyReleaseContract({ authSecretsPath, manifestPath }),
    readdir(migrationsRoot, { withFileTypes: true }),
  ]);
  const migrationNames = migrations
    .filter((entry) => entry.isDirectory() && migrationPattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const migrationHead = migrationNames.at(-1);
  if (!migrationHead) throw new Error('No versioned database migrations were found');
  const source = renderReleaseMetadata({
    contract,
    migrationCount: migrationNames.length,
    migrationHead,
    releaseId,
  });
  parseReleaseMetadata(source, releaseId);
  await writeFile(outputPath, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

async function main() {
  const [releaseId, output = 'omnireach-release.meta'] = process.argv.slice(2);
  const root = resolve(import.meta.dirname, '../..');
  const contractPaths = {
    authSecretsPath: resolve(root, 'packages/auth/src/secrets.ts'),
    manifestPath: resolve(root, 'infrastructure/deploy/release-contract.json'),
  };
  if (releaseId === '--check-contract') {
    await verifyReleaseContract(contractPaths);
    return;
  }
  if (!releaseId) {
    throw new Error('Usage: create-release-metadata.mjs --check-contract | RELEASE_ID [OUTPUT]');
  }
  const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
    cwd: root,
    encoding: 'utf8',
  });
  await createReleaseMetadata({
    ...contractPaths,
    migrationsRoot: resolve(root, 'packages/database/prisma/migrations'),
    outputPath: resolve(process.cwd(), output),
    releaseId,
    sourceCommit: stdout.trim(),
  });
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`create-release-metadata: ${error.message}\n`);
    process.exitCode = 1;
  });
}
