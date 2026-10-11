import { createHash } from 'node:crypto';

import {
  withWorkerTransaction,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';

import type { PublishRequest } from './publication.ts';
import {
  createPublicationSnapshot,
  stableStringify,
  type PublicationSnapshot,
} from './snapshot.ts';

export class PostgresSnapshotMaterializer {
  constructor(private readonly pool: TenantTransactionPool) {}

  async materialize(request: PublishRequest, codeSha: string): Promise<PublicationSnapshot> {
    return (await this.materializeWithSource(request, codeSha)).snapshot;
  }

  async materializeWithSource(
    request: PublishRequest,
    codeSha: string,
  ): Promise<{ snapshot: PublicationSnapshot; sourcePath: string }> {
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(codeSha)) throw new Error('Invalid code SHA');
    return withWorkerTransaction(
      this.pool,
      {
        jobId: `publish:${request.idempotencyKey}`,
        siteId: request.siteId,
        tenantId: request.tenantId,
      },
      async (client) => {
        const siteResult = await query<{
          contract_hash: string;
          contract_version: string;
          source_path: string;
        }>(
          client,
          `SELECT contract_version, contract_hash, source_path
             FROM sites
            WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
          [request.tenantId, request.siteId],
        );
        const site = siteResult.rows[0];
        if (
          !site?.contract_version ||
          !/^[a-f0-9]{64}$/u.test(site.contract_hash) ||
          !site.source_path
        ) {
          throw new Error('Site contract identity is unavailable');
        }
        const revisionResult = await query<{ content: unknown; revision: number }>(
          client,
          `SELECT revision, content
             FROM content_revisions
            WHERE tenant_id = $1 AND site_id = $2 AND revision = $3`,
          [request.tenantId, request.siteId, request.contentRevision],
        );
        const revision = revisionResult.rows[0];
        if (!revision) throw new Error('Content revision is unavailable');
        const factsResult = await query<{ stable_id: string; value: unknown; version: number }>(
          client,
          `SELECT stable_id, value, version
             FROM business_facts
            WHERE tenant_id = $1 AND site_id = $2
            ORDER BY stable_id`,
          [request.tenantId, request.siteId],
        );
        const assetsResult = await query<{
          checksum: string;
          id: string;
          mime: string;
          storage_key: string;
        }>(
          client,
          `SELECT id, storage_key, checksum, mime
             FROM assets
            WHERE tenant_id = $1 AND site_id = $2
              AND integrity_state = 'validated' AND deleted_at IS NULL
            ORDER BY id`,
          [request.tenantId, request.siteId],
        );
        const facts = Object.fromEntries(
          factsResult.rows.map((fact) => [
            fact.stable_id,
            { value: structuredClone(fact.value), version: fact.version },
          ]),
        );
        const assetManifest = assetsResult.rows.map((asset) => ({
          checksum: asset.checksum,
          id: asset.id,
          mime: asset.mime,
          storageKey: asset.storage_key,
        }));
        return {
          snapshot: createPublicationSnapshot({
            assetManifestHash: createHash('sha256')
              .update(stableStringify(assetManifest))
              .digest('hex'),
            codeSha,
            content: structuredClone(revision.content),
            contentRevision: revision.revision,
            contractHash: site.contract_hash,
            contractVersion: site.contract_version,
            facts,
            siteId: request.siteId,
          }),
          sourcePath: site.source_path,
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
