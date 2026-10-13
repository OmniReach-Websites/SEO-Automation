import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

import { withWorkerTransaction, type TenantTransactionPool } from '@omnireach/tenant';

import { finalizeManifest, type LocalArtifactStore } from './artifacts.ts';
import { runSiteBuild } from './build-runner.ts';
import type { PublishRequest } from './publication.ts';
import type { PostgresSnapshotMaterializer } from './postgres-snapshot.ts';
import type { PublicationSnapshot } from './snapshot.ts';

export interface SiteBuildDefinition {
  buildTools: Record<string, string>;
  healthPaths: string[];
  routes: string[];
  workspace: string;
}

export class LocalPublicationBuilder {
  constructor(
    private readonly pool: TenantTransactionPool,
    private readonly snapshots: PostgresSnapshotMaterializer,
    private readonly artifacts: LocalArtifactStore,
    private readonly options: {
      codeSha: string;
      repositoryRoot: string;
      assetStorageRoot?: string;
      sites: ReadonlyMap<string, SiteBuildDefinition>;
    },
  ) {}

  async build(request: PublishRequest): Promise<{ artifactHash: string }> {
    const materialized = await this.snapshots.materializeWithSource(request, this.options.codeSha);
    const definition = this.options.sites.get(materialized.sourcePath);
    if (!definition) throw new Error('Site build definition is unavailable');
    const snapshot = materialized.snapshot;
    const built = await buildSnapshotArtifact({
      artifacts: this.artifacts,
      definition,
      repositoryRoot: this.options.repositoryRoot,
      ...(this.options.assetStorageRoot ? { assetStorageRoot: this.options.assetStorageRoot } : {}),
      siteId: request.siteId,
      snapshot,
    });
    await this.recordVerifiedArtifact(request, snapshot, built.artifactHash, built.manifest);
    return { artifactHash: built.artifactHash };
  }

  private async recordVerifiedArtifact(
    request: PublishRequest,
    snapshot: Awaited<ReturnType<PostgresSnapshotMaterializer['materialize']>>,
    artifactHash: string,
    manifest: unknown,
  ): Promise<void> {
    await withWorkerTransaction(
      this.pool,
      {
        jobId: `publish:${request.idempotencyKey}`,
        siteId: request.siteId,
        tenantId: request.tenantId,
      },
      async (client) => {
        await client.query(
          `INSERT INTO build_artifacts
             (tenant_id, site_id, artifact_hash, snapshot_hash, code_sha, contract_version,
              content_revision, asset_manifest_hash, manifest, status, verified_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'verified', now())
           ON CONFLICT (tenant_id, site_id, artifact_hash) DO NOTHING`,
          [
            request.tenantId,
            request.siteId,
            artifactHash,
            snapshot.hash,
            snapshot.codeSha,
            snapshot.contractVersion,
            snapshot.contentRevision,
            snapshot.assetManifestHash,
            JSON.stringify(manifest),
          ],
        );
      },
    );
  }
}

export async function buildSnapshotArtifact(input: {
  assetStorageRoot?: string;
  artifacts: LocalArtifactStore;
  definition: SiteBuildDefinition;
  repositoryRoot: string;
  siteId: string;
  snapshot: PublicationSnapshot;
}): Promise<{ artifactHash: string; manifest: unknown }> {
  const temporary = await mkdtemp(join(tmpdir(), `omnireach-build-${input.siteId}-`));
  try {
    const snapshotPath = join(temporary, 'snapshot.json');
    const output = join(temporary, 'output');
    await writeFile(snapshotPath, `${JSON.stringify(input.snapshot)}\n`, { flag: 'wx' });
    await runSiteBuild({
      contentSnapshotPath: snapshotPath,
      outputDirectory: output,
      repositoryRoot: input.repositoryRoot,
      workspace: input.definition.workspace,
    });
    const files = await collectFiles(output);
    await includeManagedAssets(files, input.snapshot, input.assetStorageRoot);
    validateExpectedRoutes(files, input.definition.routes, input.definition.healthPaths);
    const finalized = finalizeManifest({
      assetManifestHash: input.snapshot.assetManifestHash,
      buildTools: input.definition.buildTools,
      codeSha: input.snapshot.codeSha,
      contentRevision: input.snapshot.contentRevision,
      contractVersion: input.snapshot.contractVersion,
      files: [...files.entries()].map(([path, bytes]) => ({
        bytes: bytes.byteLength,
        path,
        sha256: sha256(bytes),
      })),
      healthPaths: input.definition.healthPaths,
      routes: input.definition.routes,
      snapshotHash: input.snapshot.hash,
    });
    await input.artifacts.stage(input.siteId, finalized.hash, files);
    return { artifactHash: finalized.hash, manifest: finalized.manifest };
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
}

async function includeManagedAssets(
  files: Map<string, Uint8Array>,
  snapshot: PublicationSnapshot,
  storageRoot: string | undefined,
): Promise<void> {
  const referenced = managedAssetReferences(snapshot.content);
  managedAssetReferences(snapshot.facts, referenced);
  if (referenced.size === 0) return;
  if (!snapshot.assets?.length) throw new Error('Referenced managed asset is unavailable');
  if (!storageRoot) throw new Error('Asset storage root is required for managed media');
  const root = resolve(storageRoot);
  const available = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  let totalBytes = 0;
  for (const assetId of referenced) {
    const asset = available.get(assetId);
    if (!asset) throw new Error('Referenced managed asset is unavailable');
    if (!/^[0-9a-f-]{36}$/iu.test(asset.id) || !/^[a-f0-9]{64}$/u.test(asset.checksum)) {
      throw new Error('Managed asset identity is invalid');
    }
    if (!asset.storageKey.startsWith(`${snapshot.siteId}/`) || asset.storageKey.includes('..')) {
      throw new Error('Managed asset storage key is invalid');
    }
    const source = resolve(root, ...asset.storageKey.split('/'));
    if (!source.startsWith(`${root}${sep}`)) throw new Error('Managed asset escapes storage');
    const bytes = new Uint8Array(await readFile(source));
    if (sha256(bytes) !== asset.checksum) throw new Error('Managed asset checksum mismatch');
    totalBytes += bytes.byteLength;
    if (totalBytes > 50 * 1024 * 1024) throw new Error('Managed assets exceed size limit');
    const extension = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    }[asset.mime];
    if (!extension) throw new Error('Managed asset media type is invalid');
    files.set(`managed-assets/${asset.id}.${extension}`, bytes);
  }
}

function managedAssetReferences(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    const match =
      /^asset:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu.exec(
        value,
      );
    if (match?.[1]) found.add(match[1]);
  } else if (Array.isArray(value)) {
    for (const entry of value) managedAssetReferences(entry, found);
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) managedAssetReferences(entry, found);
  }
  if (found.size > 100) throw new Error('Managed asset reference count exceeds limit');
  return found;
}

async function collectFiles(root: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  let totalBytes = 0;
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Artifact output cannot contain symbolic links');
      const path = resolve(directory, entry.name);
      if (!path.startsWith(`${resolve(root)}${sep}`))
        throw new Error('Artifact output escapes root');
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        const bytes = new Uint8Array(await readFile(path));
        totalBytes += bytes.byteLength;
        if (totalBytes > 100 * 1024 * 1024) throw new Error('Artifact output exceeds size limit');
        const key = relative(root, path).split(sep).join('/');
        files.set(key, bytes);
      }
    }
  }
  await walk(root);
  if (files.size === 0) throw new Error('Artifact output is empty');
  return files;
}

function validateExpectedRoutes(
  files: ReadonlyMap<string, Uint8Array>,
  routes: readonly string[],
  healthPaths: readonly string[],
): void {
  for (const route of new Set([...routes, ...healthPaths])) {
    if (!route.startsWith('/') || route.includes('..') || route.includes('\\')) {
      throw new Error('Artifact route is unsafe');
    }
    const expected = route.endsWith('/')
      ? `${route.replace(/^\//u, '')}index.html`
      : route.replace(/^\//u, '');
    if (!files.has(expected || 'index.html'))
      throw new Error(`Artifact route is missing: ${route}`);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
