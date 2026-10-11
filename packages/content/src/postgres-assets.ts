import {
  assertSiteFeatureEnabled,
  withTenantTransaction,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';

import { readLimitedUpload, validateImageUpload, type LocalAssetStorage } from './assets.ts';
import type { ContentActorContext } from './postgres.ts';

export interface StoredAsset {
  bytes: number;
  checksum: string;
  filename: string;
  height: number;
  id: string;
  mime: string;
  storageKey: string;
  width: number;
}

export class PostgresAssetRepository {
  constructor(
    private readonly pool: TenantTransactionPool,
    private readonly storage: LocalAssetStorage,
  ) {}

  async upload(
    context: ContentActorContext,
    input: { filename: string; stream: AsyncIterable<Uint8Array> },
  ): Promise<StoredAsset> {
    const data = await readLimitedUpload(input.stream);
    const image = await validateImageUpload(data, input.filename);
    const storageKey = await this.storage.put(context.siteId, data, image);
    return withTenantTransaction(
      this.pool,
      { siteId: context.siteId, tenantId: context.tenantId, userId: context.userId },
      async (client) => {
        await assertSiteFeatureEnabled(client, context, 'content.edit');
        const result = await query<{
          byte_size: string;
          checksum: string;
          height: number;
          id: string;
          mime: string;
          original_filename: string;
          storage_key: string;
          width: number;
        }>(
          client,
          `INSERT INTO assets
             (tenant_id, site_id, storage_key, original_filename, mime, byte_size, checksum,
              width, height, integrity_state, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'validated', $10)
           ON CONFLICT (tenant_id, site_id, checksum) DO UPDATE
             SET checksum = EXCLUDED.checksum
           RETURNING id, storage_key, original_filename, mime, byte_size::text,
                     checksum, width, height`,
          [
            context.tenantId,
            context.siteId,
            storageKey,
            image.normalizedFilename,
            image.mime,
            image.bytes,
            image.checksum,
            image.width,
            image.height,
            context.userId,
          ],
        );
        const asset = result.rows[0];
        if (!asset) throw new Error('Asset metadata creation failed');
        await client.query(
          `INSERT INTO audit_events
             (tenant_id, site_id, actor_id, action, trace_id, target_type, target_id, metadata)
           VALUES ($1, $2, $3, 'asset.uploaded', $4, 'asset', $5, $6::jsonb)`,
          [
            context.tenantId,
            context.siteId,
            context.userId,
            context.traceId,
            asset.id,
            JSON.stringify({ bytes: Number(asset.byte_size), mime: asset.mime }),
          ],
        );
        return mapAsset(asset);
      },
    );
  }

  async download(
    context: ContentActorContext,
    assetId: string,
  ): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> {
    const asset = await withTenantTransaction(
      this.pool,
      { siteId: context.siteId, tenantId: context.tenantId, userId: context.userId },
      async (client) => {
        const result = await query<{
          mime: string;
          original_filename: string;
          storage_key: string;
        }>(
          client,
          `SELECT storage_key, original_filename, mime
             FROM assets
            WHERE tenant_id = $1 AND site_id = $2 AND id = $3
              AND integrity_state = 'validated' AND deleted_at IS NULL`,
          [context.tenantId, context.siteId, assetId],
        );
        if (result.rows.length !== 1 || !result.rows[0]) throw new Error('Asset was not found');
        return result.rows[0];
      },
    );
    return {
      bytes: await this.storage.get(context.siteId, asset.storage_key),
      contentType: asset.mime,
      filename: asset.original_filename,
    };
  }
}

async function query<T extends Record<string, unknown>>(
  client: TenantTransactionClient,
  text: string,
  values: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}

function mapAsset(input: {
  byte_size: string;
  checksum: string;
  height: number;
  id: string;
  mime: string;
  original_filename: string;
  storage_key: string;
  width: number;
}): StoredAsset {
  return {
    bytes: Number(input.byte_size),
    checksum: input.checksum,
    filename: input.original_filename,
    height: input.height,
    id: input.id,
    mime: input.mime,
    storageKey: input.storage_key,
    width: input.width,
  };
}
