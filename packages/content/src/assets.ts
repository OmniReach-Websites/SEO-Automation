import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

const allowedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export async function readLimitedUpload(
  source: AsyncIterable<Uint8Array>,
  maxBytes = 10 * 1024 * 1024,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of source) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error('Upload size is not allowed');
    chunks.push(chunk);
  }
  if (total === 0) throw new Error('Upload size is not allowed');
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export interface ValidatedImage {
  bytes: number;
  checksum: string;
  extension: string;
  height: number;
  mime: string;
  normalizedFilename: string;
  width: number;
}

export async function validateImageUpload(
  data: Uint8Array,
  filename: string,
  limits: { maxBytes: number; maxDimension: number; maxPixels: number } = {
    maxBytes: 10 * 1024 * 1024,
    maxDimension: 8_000,
    maxPixels: 40_000_000,
  },
): Promise<ValidatedImage> {
  if (data.byteLength === 0 || data.byteLength > limits.maxBytes)
    throw new Error('Upload size is not allowed');
  const detected = await fileTypeFromBuffer(data);
  const extension = detected ? allowedTypes.get(detected.mime) : undefined;
  if (!detected || !extension) throw new Error('Upload type is not allowed');
  const metadata = await sharp(data, {
    failOn: 'warning',
    limitInputPixels: limits.maxPixels,
  }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Image dimensions are unavailable');
  if (metadata.width > limits.maxDimension || metadata.height > limits.maxDimension) {
    throw new Error('Image dimensions exceed the limit');
  }
  return {
    bytes: data.byteLength,
    checksum: createHash('sha256').update(data).digest('hex'),
    extension,
    height: metadata.height,
    mime: detected.mime,
    normalizedFilename: normalizeFilename(filename, extension),
    width: metadata.width,
  };
}

function normalizeFilename(filename: string, extension: string): string {
  const withoutExtension = filename.slice(
    0,
    Math.max(0, filename.length - extname(filename).length),
  );
  const base = withoutExtension
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/^[._-]+|[._-]+$/gu, '')
    .slice(0, 100);
  return `${base || 'image'}.${extension}`;
}

export class LocalAssetStorage {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async put(siteId: string, data: Uint8Array, image: ValidatedImage): Promise<string> {
    assertSiteId(siteId);
    const key = `${siteId}/${image.checksum.slice(0, 2)}/${image.checksum}/original.${image.extension}`;
    const destination = this.resolveKey(siteId, key);
    await mkdir(resolve(destination, '..'), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.partial`;
    await writeFile(temporary, data, { flag: 'wx' });
    await rename(temporary, destination);
    return key;
  }

  async get(siteId: string, key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolveKey(siteId, key)));
  }

  resolveKey(siteId: string, key: string): string {
    assertSiteId(siteId);
    if (!key.startsWith(`${siteId}/`)) throw new Error('Asset does not belong to this site');
    const resolved = resolve(this.#root, ...key.split('/'));
    if (!resolved.startsWith(`${this.#root}${sep}`))
      throw new Error('Asset key escapes storage root');
    return resolved;
  }
}

function assertSiteId(siteId: string): void {
  if (!/^[a-zA-Z0-9_-]{3,100}$/u.test(siteId)) throw new Error('Invalid site identifier');
}

export function eligibleForGarbageCollection(input: {
  draftReferences: number;
  liveReferences: number;
  now: Date;
  unreferencedAt?: Date;
  waitMilliseconds: number;
}): boolean {
  return (
    input.draftReferences === 0 &&
    input.liveReferences === 0 &&
    Boolean(input.unreferencedAt) &&
    input.now.getTime() - (input.unreferencedAt?.getTime() ?? input.now.getTime()) >=
      input.waitMilliseconds
  );
}
