import { createHash } from 'node:crypto';
import { open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const releasePattern = /^[a-f0-9]{40,64}$/u;

export function assertDeployRoot(root) {
  const absolute = resolve(root);
  if (absolute === resolve(sep) || absolute === dirname(absolute)) {
    throw new Error('Refusing broad deploy root');
  }
  return absolute;
}

export async function verifyArtifact(archivePath, checksumPath) {
  const [archive, checksumSource] = await Promise.all([
    readFile(archivePath),
    readFile(checksumPath, 'utf8'),
  ]);
  const expected = checksumSource.trim().split(/\s+/u)[0];
  const actual = createHash('sha256').update(archive).digest('hex');
  if (!expected || expected !== actual) throw new Error('Artifact checksum mismatch');
  return actual;
}

export function verifyMigrationCompatibility(requiredVersion, supportedRange) {
  if (
    !Number.isInteger(requiredVersion) ||
    requiredVersion < supportedRange.minimum ||
    requiredVersion > supportedRange.maximum
  ) {
    throw new Error('Release migration compatibility gate failed');
  }
  if (supportedRange.destructive === true) throw new Error('Destructive migrations are forbidden');
  return true;
}

export async function withReleaseLock(root, operation) {
  const deployRoot = assertDeployRoot(root);
  const lockPath = join(deployRoot, '.release.lock');
  let handle;
  try {
    handle = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      throw new Error('Another release operation is active', { cause: error });
    }
    throw error;
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

export async function stageRelease({ archivePath, checksumPath, releaseId, root }) {
  if (!releasePattern.test(releaseId))
    throw new Error('Release ID must be an immutable commit or artifact hash');
  const deployRoot = assertDeployRoot(root);
  const hash = await verifyArtifact(archivePath, checksumPath);
  const sourceStat = await stat(archivePath);
  const record = {
    artifactHash: hash,
    bytes: sourceStat.size,
    releaseId,
    stagedAt: new Date().toISOString(),
    status: 'staged',
  };
  const target = join(deployRoot, 'releases', `${releaseId}.json`);
  await writeFile(target, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 });
  return record;
}

export async function activateRelease({ healthCheck, releaseId, root }) {
  if (!releasePattern.test(releaseId)) throw new Error('Invalid release ID');
  const deployRoot = assertDeployRoot(root);
  const stagedPath = join(deployRoot, 'releases', `${releaseId}.json`);
  await stat(stagedPath);
  return withReleaseLock(deployRoot, async () => {
    const currentPath = join(deployRoot, 'current.json');
    const previousPath = join(deployRoot, 'previous.json');
    let previous;
    try {
      previous = await readFile(currentPath, 'utf8');
      await writeFile(previousPath, previous, { mode: 0o600 });
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
        throw error;
    }
    const candidatePath = join(deployRoot, '.current.candidate');
    const candidate = await readFile(stagedPath, 'utf8');
    await writeFile(candidatePath, candidate, { mode: 0o600 });
    await rename(candidatePath, currentPath);
    const healthy = await healthCheck(JSON.parse(candidate));
    if (!healthy) {
      if (previous === undefined) await rm(currentPath, { force: true });
      else {
        await writeFile(candidatePath, previous, { mode: 0o600 });
        await rename(candidatePath, currentPath);
      }
      throw new Error('Health check failed; prior release restored');
    }
    return JSON.parse(candidate);
  });
}

export async function rollbackRelease(root) {
  const deployRoot = assertDeployRoot(root);
  return withReleaseLock(deployRoot, async () => {
    const previous = await readFile(join(deployRoot, 'previous.json'), 'utf8');
    const candidate = join(deployRoot, '.current.candidate');
    await writeFile(candidate, previous, { mode: 0o600 });
    await rename(candidate, join(deployRoot, 'current.json'));
    return JSON.parse(previous);
  });
}
