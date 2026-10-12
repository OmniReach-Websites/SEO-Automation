import { readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const releasePattern = /^[a-f0-9]{40}$/u;
const migrationPattern = /^\d{14}_[a-z0-9_]+$/u;
const metadataKeys = [
  'OMNIREACH_RELEASE_METADATA_VERSION',
  'OMNIREACH_RELEASE_ID',
  'OMNIREACH_SOURCE_COMMIT',
  'OMNIREACH_AUTH_CONTRACT',
  'OMNIREACH_SCHEMA_MIN',
  'OMNIREACH_SCHEMA_MAX',
  'OMNIREACH_SCHEMA_TARGET',
  'OMNIREACH_MIGRATION_HEAD',
  'OMNIREACH_MIGRATION_COUNT',
];

export function renderReleaseMetadata({ migrationCount, migrationHead, releaseId }) {
  if (!releasePattern.test(releaseId)) throw new Error('Release ID must be a commit SHA');
  if (!migrationPattern.test(migrationHead)) throw new Error('Migration head is invalid');
  if (!Number.isSafeInteger(migrationCount) || migrationCount < 1) {
    throw new Error('Migration count must be a positive integer');
  }

  return [
    'OMNIREACH_RELEASE_METADATA_VERSION=1',
    `OMNIREACH_RELEASE_ID=${releaseId}`,
    `OMNIREACH_SOURCE_COMMIT=${releaseId}`,
    'OMNIREACH_AUTH_CONTRACT=2',
    'OMNIREACH_SCHEMA_MIN=2',
    'OMNIREACH_SCHEMA_MAX=2',
    'OMNIREACH_SCHEMA_TARGET=2',
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
  if (entries.get('OMNIREACH_RELEASE_METADATA_VERSION') !== '1') {
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
  return metadata;
}

export function assertReleaseMetadataSupports(metadata, { authContract, schemaContract }) {
  if (metadata.authContract !== authContract) {
    throw new Error('Release authentication contract is incompatible');
  }
  if (schemaContract < metadata.schemaMinimum || schemaContract > metadata.schemaMaximum) {
    throw new Error('Release schema contract is incompatible');
  }
  return true;
}

export async function createReleaseMetadata({ migrationsRoot, outputPath, releaseId }) {
  const migrationNames = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && migrationPattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const migrationHead = migrationNames.at(-1);
  if (!migrationHead) throw new Error('No versioned database migrations were found');
  const source = renderReleaseMetadata({
    migrationCount: migrationNames.length,
    migrationHead,
    releaseId,
  });
  parseReleaseMetadata(source, releaseId);
  await writeFile(outputPath, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

async function main() {
  const [releaseId, output = 'omnireach-release.meta'] = process.argv.slice(2);
  if (!releaseId) throw new Error('Usage: create-release-metadata.mjs RELEASE_ID [OUTPUT]');
  const root = resolve(import.meta.dirname, '../..');
  await createReleaseMetadata({
    migrationsRoot: resolve(root, 'packages/database/prisma/migrations'),
    outputPath: resolve(process.cwd(), output),
    releaseId,
  });
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`create-release-metadata: ${error.message}\n`);
    process.exitCode = 1;
  });
}
