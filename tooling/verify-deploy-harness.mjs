import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  activateRelease,
  rollbackRelease,
  stageRelease,
  verifyArtifact,
  verifyMigrationCompatibility,
  withReleaseLock,
} from '../infrastructure/deploy/release.mjs';
import {
  assertReleaseMetadataSupports,
  parseReleaseMetadata,
  renderReleaseMetadata,
} from '../infrastructure/deploy/create-release-metadata.mjs';

const root = await mkdtemp(join(tmpdir(), 'omnireach-deploy-fixture-'));
try {
  await mkdir(join(root, 'releases'));
  const archivePath = join(root, 'artifact.tgz');
  const checksumPath = `${archivePath}.sha256`;
  await writeFile(archivePath, 'synthetic fictional immutable artifact');
  const checksum = createHash('sha256')
    .update(await readFile(archivePath))
    .digest('hex');
  await writeFile(checksumPath, `${checksum}  artifact.tgz\n`);
  const first = 'a'.repeat(40);
  const second = 'b'.repeat(40);
  const metadata = parseReleaseMetadata(
    renderReleaseMetadata({
      migrationCount: 1,
      migrationHead: '20261010250000_g05_account_authentication_policy',
      releaseId: first,
    }),
    first,
  );
  assertReleaseMetadataSupports(metadata, { authContract: 2, schemaContract: 2 });
  let incompatibleRollbackRejected = false;
  try {
    assertReleaseMetadataSupports(metadata, { authContract: 2, schemaContract: 3 });
  } catch {
    incompatibleRollbackRejected = true;
  }
  let metadataIdentityRejected = false;
  try {
    parseReleaseMetadata(
      renderReleaseMetadata({
        migrationCount: 1,
        migrationHead: '20261010250000_g05_account_authentication_policy',
        releaseId: first,
      }),
      second,
    );
  } catch {
    metadataIdentityRejected = true;
  }
  await stageRelease({ archivePath, checksumPath, releaseId: first, root });
  await activateRelease({ healthCheck: async () => true, releaseId: first, root });
  await stageRelease({ archivePath, checksumPath, releaseId: second, root });
  let restored = false;
  try {
    await activateRelease({ healthCheck: async () => false, releaseId: second, root });
  } catch (error) {
    restored = error instanceof Error && error.message.includes('prior release restored');
  }
  const current = JSON.parse(await readFile(join(root, 'current.json'), 'utf8'));
  const rolledBack = await rollbackRelease(root);
  await writeFile(checksumPath, `${'0'.repeat(64)}  artifact.tgz\n`);
  let badChecksumRejected = false;
  try {
    await verifyArtifact(archivePath, checksumPath);
  } catch {
    badChecksumRejected = true;
  }
  let migrationRejected = false;
  try {
    verifyMigrationCompatibility(5, { destructive: false, maximum: 4, minimum: 1 });
  } catch {
    migrationRejected = true;
  }
  let releaseLockRejected = false;
  await withReleaseLock(root, async () => {
    try {
      await withReleaseLock(root, async () => undefined);
    } catch {
      releaseLockRejected = true;
    }
  });
  if (
    !restored ||
    !badChecksumRejected ||
    !migrationRejected ||
    !incompatibleRollbackRejected ||
    !metadataIdentityRejected ||
    !releaseLockRejected ||
    current.releaseId !== first ||
    rolledBack.releaseId !== first
  ) {
    throw new Error('Release failure did not preserve the prior pointer');
  }
  console.log(
    JSON.stringify({
      badChecksumRejected,
      check: 'deploy-harness',
      incompatibleRollbackRejected,
      metadataIdentityRejected,
      migrationRejected,
      ok: true,
      releaseId: current.releaseId,
      releaseLockRejected,
      restored,
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
