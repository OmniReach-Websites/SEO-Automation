import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalArtifactStore, readActiveStaticFile } from '@omnireach/worker-publisher';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map(async (directory) => rm(directory, { force: true, recursive: true })),
  ),
);

describe('immutable static artifacts', () => {
  it('stages an immutable version and atomically activates it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnireach-artifacts-'));
    directories.push(root);
    const store = new LocalArtifactStore(root);
    const hash = 'a'.repeat(64);
    await store.stage('site-a', hash, new Map([['index.html', Buffer.from('<h1>Version A</h1>')]]));
    await store.activate('site-a', hash);
    const response = await readActiveStaticFile({ root, siteId: 'site-a', urlPath: '/' });
    expect(Buffer.from(response.body).toString('utf8')).toContain('Version A');
    expect(response.contentType).toBe('text/html; charset=utf-8');
    await expect(store.stage('site-a', hash, new Map())).rejects.toThrow();
  });

  it('rejects traversal without reading outside the artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnireach-artifacts-'));
    directories.push(root);
    const store = new LocalArtifactStore(root);
    const hash = 'b'.repeat(64);
    await store.stage('site-a', hash, new Map([['index.html', Buffer.from('safe')]]));
    await store.activate('site-a', hash);
    await expect(
      readActiveStaticFile({ root, siteId: 'site-a', urlPath: '/../outside' }),
    ).rejects.toThrow('Unsafe');
  });

  it('restores the prior active pointer and cleans failed staging directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnireach-artifacts-'));
    directories.push(root);
    const store = new LocalArtifactStore(root);
    const first = 'c'.repeat(64);
    const second = 'd'.repeat(64);
    await store.stage('site-a', first, new Map([['index.html', Buffer.from('first')]]));
    await store.stage('site-a', second, new Map([['index.html', Buffer.from('second')]]));
    await store.activate('site-a', first);
    await store.activate('site-a', second);
    await store.restoreActive('site-a', first);
    expect(await store.activeHash('site-a')).toBe(first);

    await expect(
      store.stage('site-a', 'e'.repeat(64), new Map([['../unsafe', Buffer.from('bad')]])),
    ).rejects.toThrow('unsafe');
    await store.stage('site-a', 'e'.repeat(64), new Map([['index.html', Buffer.from('safe')]]));
  });

  it('fails closed when the active pointer is corrupt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnireach-artifacts-'));
    directories.push(root);
    await mkdir(join(root, 'site-a'), { recursive: true });
    await writeFile(join(root, 'site-a', 'active.json'), '{"artifactHash":"not-a-hash"}\n');
    await expect(new LocalArtifactStore(root).activeHash('site-a')).rejects.toThrow(
      'pointer is invalid',
    );
  });
});
