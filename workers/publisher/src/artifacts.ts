import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { stableStringify } from './snapshot.ts';

export interface ArtifactManifest {
  assetManifestHash: string;
  buildTools: Record<string, string>;
  codeSha: string;
  contentRevision: number;
  contractVersion: string;
  files: { bytes: number; path: string; sha256: string }[];
  healthPaths: string[];
  routes: string[];
  snapshotHash: string;
}

export function finalizeManifest(
  input: Omit<ArtifactManifest, 'files'> & { files: ArtifactManifest['files'] },
): {
  hash: string;
  manifest: ArtifactManifest;
} {
  const manifest = structuredClone(input);
  manifest.files.sort((left, right) => left.path.localeCompare(right.path));
  const hash = createHash('sha256').update(stableStringify(manifest)).digest('hex');
  return { hash, manifest };
}

export class LocalArtifactStore {
  readonly #root: string;
  constructor(root: string) {
    this.#root = resolve(root);
  }

  async activate(siteId: string, artifactHash: string): Promise<void> {
    const directory = this.artifactPath(siteId, artifactHash);
    if (!(await stat(directory)).isDirectory()) throw new Error('Artifact does not exist');
    const pointerDirectory = resolve(this.#root, siteId);
    await mkdir(pointerDirectory, { recursive: true });
    const temporary = resolve(pointerDirectory, `.active-${randomUUID()}.json`);
    try {
      await writeFile(temporary, `${JSON.stringify({ artifactHash })}\n`, { flag: 'wx' });
      await rename(temporary, resolve(pointerDirectory, 'active.json'));
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async stage(
    siteId: string,
    artifactHash: string,
    files: ReadonlyMap<string, Uint8Array>,
  ): Promise<string> {
    const directory = this.artifactPath(siteId, artifactHash);
    try {
      if ((await stat(directory)).isDirectory()) {
        await verifyExistingArtifact(directory, files);
        return directory;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const versions = resolve(directory, '..');
    const staging = resolve(versions, `.${artifactHash}.staging-${randomUUID()}`);
    await mkdir(versions, { recursive: true });
    await mkdir(staging, { recursive: false });
    try {
      for (const [relativePath, bytes] of files) {
        if (
          relativePath.startsWith('/') ||
          relativePath.includes('..') ||
          relativePath.includes('\\')
        ) {
          throw new Error('Artifact file path is unsafe');
        }
        const destination = resolve(staging, ...relativePath.split('/'));
        if (!destination.startsWith(`${staging}${sep}`))
          throw new Error('Artifact file path escapes version');
        await mkdir(resolve(destination, '..'), { recursive: true });
        await writeFile(destination, bytes, { flag: 'wx' });
      }
      await rename(staging, directory);
    } catch (error) {
      await rm(staging, { force: true, recursive: true });
      throw error;
    }
    return directory;
  }

  async restoreActive(siteId: string, previousArtifact: string | undefined): Promise<void> {
    if (previousArtifact) {
      await this.activate(siteId, previousArtifact);
      return;
    }
    const pointer = resolve(this.#root, siteId, 'active.json');
    try {
      await unlink(pointer);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  artifactPath(siteId: string, artifactHash: string): string {
    if (!/^[a-zA-Z0-9_-]{3,100}$/u.test(siteId) || !/^[a-f0-9]{64}$/u.test(artifactHash)) {
      throw new Error('Invalid artifact identity');
    }
    const path = resolve(this.#root, siteId, 'versions', artifactHash);
    if (!path.startsWith(`${this.#root}${sep}`)) throw new Error('Artifact path escapes root');
    return path;
  }

  async activeHash(siteId: string): Promise<string | undefined> {
    try {
      const pointer = JSON.parse(
        await readFile(resolve(this.#root, siteId, 'active.json'), 'utf8'),
      ) as { artifactHash?: unknown } | undefined;
      if (
        !pointer ||
        typeof pointer.artifactHash !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(pointer.artifactHash)
      ) {
        throw new Error('Active artifact pointer is invalid');
      }
      return pointer.artifactHash;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
}

async function verifyExistingArtifact(
  directory: string,
  expected: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  const actualPaths: string[] = [];
  async function walk(current: string, prefix = ''): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Existing artifact contains a symbolic link');
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await walk(path, relativePath);
      else if (entry.isFile()) actualPaths.push(relativePath);
    }
  }
  await walk(directory);
  if (actualPaths.length !== expected.size || actualPaths.some((path) => !expected.has(path))) {
    throw new Error('Existing immutable artifact does not match staged file set');
  }
  for (const [path, bytes] of expected) {
    const existing = await readFile(resolve(directory, ...path.split('/')));
    if (!existing.equals(Buffer.from(bytes))) {
      throw new Error('Existing immutable artifact content does not match');
    }
  }
}
