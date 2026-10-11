import { createHash } from 'node:crypto';

import {
  assertSiteFeatureEnabled,
  withTenantTransaction,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';

import { LocalArtifactStore } from './artifacts.ts';
import { buildSnapshotArtifact, type SiteBuildDefinition } from './local-builder.ts';
import { createPreviewToken, verifyPreviewToken } from './preview.ts';
import { createPublicationSnapshot, stableStringify } from './snapshot.ts';
import { readArtifactStaticFile } from './static-server.ts';

export interface PreviewContext {
  siteId: string;
  tenantId: string;
  userId: string;
}

export class PostgresPreviewService {
  readonly #artifacts: LocalArtifactStore;

  constructor(
    private readonly pool: TenantTransactionPool,
    private readonly options: {
      artifactsRoot: string;
      codeSha: string;
      repositoryRoot: string;
      signingKey: string;
      definitions: ReadonlyMap<string, SiteBuildDefinition>;
    },
  ) {
    this.#artifacts = new LocalArtifactStore(options.artifactsRoot);
  }

  async create(context: PreviewContext, draftId: string): Promise<{ previewToken: string }> {
    const materialized = await this.materialize(context, draftId);
    const definition = this.options.definitions.get(materialized.sourcePath);
    if (!definition) throw new Error('Site build definition is unavailable');
    const built = await buildSnapshotArtifact({
      artifacts: this.#artifacts,
      definition,
      repositoryRoot: this.options.repositoryRoot,
      siteId: context.siteId,
      snapshot: materialized.snapshot,
    });
    return {
      previewToken: createPreviewToken(
        {
          expiresAt: Date.now() + 15 * 60_000,
          siteId: context.siteId,
          snapshotHash: built.artifactHash,
        },
        this.options.signingKey,
      ),
    };
  }

  async read(
    context: PreviewContext,
    input: { path: string; token: string },
  ): Promise<{ body: Uint8Array; contentType: string }> {
    const claims = verifyPreviewToken(input.token, this.options.signingKey);
    if (claims.siteId !== context.siteId) throw new Error('Preview does not belong to this site');
    return readArtifactStaticFile({
      artifactHash: claims.snapshotHash,
      root: this.options.artifactsRoot,
      siteId: context.siteId,
      urlPath: `/${input.path}`,
    });
  }

  private async materialize(context: PreviewContext, draftId: string) {
    return withTenantTransaction(
      this.pool,
      { siteId: context.siteId, tenantId: context.tenantId, userId: context.userId },
      async (client) => {
        await assertSiteFeatureEnabled(client, context, 'content.edit');
        const site = (
          await query<{ contract_hash: string; contract_version: string; source_path: string }>(
            client,
            `SELECT contract_version, contract_hash, source_path FROM sites
              WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
            [context.tenantId, context.siteId],
          )
        ).rows[0];
        const draft = (
          await query<{ base_revision: number; content: unknown; version: number }>(
            client,
            `SELECT base_revision, version, content FROM content_drafts
              WHERE tenant_id = $1 AND site_id = $2 AND id = $3`,
            [context.tenantId, context.siteId, draftId],
          )
        ).rows[0];
        if (!site || !/^[a-f0-9]{64}$/u.test(site.contract_hash) || !draft) {
          throw new Error('Preview snapshot inputs are unavailable');
        }
        const facts = await query<{ stable_id: string; value: unknown; version: number }>(
          client,
          `SELECT stable_id, value, version FROM business_facts
            WHERE tenant_id = $1 AND site_id = $2 ORDER BY stable_id`,
          [context.tenantId, context.siteId],
        );
        const assets = await query<{ checksum: string; id: string; storage_key: string }>(
          client,
          `SELECT id, storage_key, checksum FROM assets
            WHERE tenant_id = $1 AND site_id = $2
              AND integrity_state = 'validated' AND deleted_at IS NULL
            ORDER BY id`,
          [context.tenantId, context.siteId],
        );
        if (!site.source_path) throw new Error('Site source path is unavailable');
        return {
          sourcePath: site.source_path,
          snapshot: createPublicationSnapshot({
            assetManifestHash: createHash('sha256')
              .update(stableStringify(assets.rows))
              .digest('hex'),
            codeSha: this.options.codeSha,
            content: structuredClone(draft.content),
            contentRevision: draft.base_revision,
            contractHash: site.contract_hash,
            contractVersion: site.contract_version,
            facts: Object.fromEntries(
              facts.rows.map((fact) => [
                fact.stable_id,
                { value: structuredClone(fact.value), version: fact.version },
              ]),
            ),
            siteId: context.siteId,
          }),
        };
      },
    );
  }
}

async function query<T extends Record<string, unknown>>(
  client: TenantTransactionClient,
  text: string,
  values: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}
