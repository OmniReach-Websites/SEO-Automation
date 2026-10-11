import {
  LocalAssetStorage,
  eligibleForGarbageCollection,
  readLimitedUpload,
  validateImageUpload,
} from '@omnireach/content';
import { describe, expect, it } from 'vitest';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('asset isolation and validation', () => {
  it('streams uploads with a hard byte limit before image decoding', async () => {
    async function* chunks() {
      yield new Uint8Array([1, 2]);
      yield new Uint8Array([3]);
    }
    await expect(readLimitedUpload(chunks(), 3)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(readLimitedUpload(chunks(), 2)).rejects.toThrow('size');
  });
  it('validates image signatures, dimensions, checksums, and normalized filenames', async () => {
    const image = await validateImageUpload(onePixelPng, '../../ Café portrait.PNG');
    expect(image).toMatchObject({ extension: 'png', height: 1, mime: 'image/png', width: 1 });
    expect(image.normalizedFilename).toBe('Caf-portrait.png');
    expect(image.checksum).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rejects executable, SVG, oversize, and signature-spoofed input', async () => {
    await expect(
      validateImageUpload(Buffer.from('<svg><script>bad()</script></svg>'), 'bad.svg'),
    ).rejects.toThrow('not allowed');
    await expect(validateImageUpload(Buffer.from('MZ executable'), 'image.png')).rejects.toThrow(
      'not allowed',
    );
    await expect(
      validateImageUpload(onePixelPng, 'tiny.png', {
        maxBytes: 10,
        maxDimension: 100,
        maxPixels: 100,
      }),
    ).rejects.toThrow('size');
  });

  it('rejects traversal and cross-site keys before filesystem access', () => {
    const storage = new LocalAssetStorage('runtime-data/assets');
    expect(() => storage.resolveKey('site-a', 'site-b/aa/object/original.png')).toThrow(
      'does not belong',
    );
    expect(() => storage.resolveKey('site-a', 'site-a/../../outside')).toThrow(
      'escapes storage root',
    );
  });

  it('never collects an asset referenced by either draft or live content', () => {
    const old = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-02-01T00:00:00Z');
    expect(
      eligibleForGarbageCollection({
        draftReferences: 0,
        liveReferences: 1,
        now,
        unreferencedAt: old,
        waitMilliseconds: 1,
      }),
    ).toBe(false);
    expect(
      eligibleForGarbageCollection({
        draftReferences: 0,
        liveReferences: 0,
        now,
        unreferencedAt: old,
        waitMilliseconds: 1,
      }),
    ).toBe(true);
  });
});
