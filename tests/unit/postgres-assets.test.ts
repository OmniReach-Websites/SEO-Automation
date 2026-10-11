import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalAssetStorage, PostgresAssetRepository } from '@omnireach/content';
import type { TenantTransactionPool } from '@omnireach/tenant';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })),
  );
});

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const context = {
  role: 'customer_owner',
  siteId: '20000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000001',
  traceId: 'trace-asset-1',
  userId: '40000000-0000-4000-8000-000000000001',
};

describe('PostgreSQL asset repository', () => {
  it('validates and stores a site-isolated asset before committing audited metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnireach-assets-'));
    roots.push(root);
    let storedKey = '';
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      if (text.includes('WITH latest_feature')) {
        return {
          rows: [
            {
              editing_frozen: false,
              feature_enabled: true,
              grace_ends_at: null,
              subscription_status: 'active',
            },
          ],
        };
      }
      if (text.includes('INSERT INTO assets')) {
        storedKey = String(values?.[2]);
        return {
          rows: [
            {
              byte_size: String(onePixelPng.byteLength),
              checksum: String(values?.[6]),
              height: 1,
              id: '90000000-0000-4000-8000-000000000001',
              mime: 'image/png',
              original_filename: 'portrait.png',
              storage_key: storedKey,
              width: 1,
            },
          ],
        };
      }
      if (text.includes('FROM assets')) {
        return {
          rows: [
            {
              mime: 'image/png',
              original_filename: 'portrait.png',
              storage_key: storedKey,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    const pool: TenantTransactionPool = { connect: vi.fn(async () => client) };
    const repository = new PostgresAssetRepository(pool, new LocalAssetStorage(root));
    async function* upload() {
      yield onePixelPng;
    }

    const stored = await repository.upload(context, { filename: 'portrait.png', stream: upload() });
    expect(stored.storageKey).toMatch(
      /^20000000-0000-4000-8000-000000000001\/[a-f0-9]{2}\/[a-f0-9]{64}\/original\.png$/u,
    );
    expect(query.mock.calls.some(([text]) => text.includes('INSERT INTO audit_events'))).toBe(true);
    const downloaded = await repository.download(context, stored.id);
    expect(downloaded.contentType).toBe('image/png');
    expect(downloaded.bytes).toEqual(new Uint8Array(onePixelPng));
  });
});
