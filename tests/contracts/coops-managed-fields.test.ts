import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { contractHash, validateSiteContract } from '@omnireach/contracts';
import {
  defaultCoopContent,
  defaultCoopFacts,
} from '../../sites/coops-mobile-detailing/src/data/site.ts';
import {
  buildSnapshotArtifact,
  createPublicationSnapshot,
  LocalArtifactStore,
} from '@omnireach/worker-publisher';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe('Coop managed contract', () => {
  it('renders every declared field from one immutable snapshot', async () => {
    const manifest = validateSiteContract(
      JSON.parse(
        await readFile(
          resolve(repositoryRoot, 'sites/coops-mobile-detailing/site.manifest.json'),
          'utf8',
        ),
      ),
    );
    expect(manifest.fields).toHaveLength(20);
    const assetId = '22222222-2222-4222-8222-222222222222';
    const siteId = '11111111-1111-4111-8111-111111111111';
    const managedBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const managedChecksum = createHash('sha256').update(managedBytes).digest('hex');
    const storageKey = `${siteId}/${managedChecksum.slice(0, 2)}/${managedChecksum}/original.png`;
    const content = structuredClone(defaultCoopContent);
    Object.assign(content, {
      'home.heading': 'MANAGED_HEADING',
      'home.intro': '<p>MANAGED_INTRO</p>',
      'home.hero-image': {
        alt: 'MANAGED_HERO_ALT',
        src: `asset:${assetId}`,
      },
      'home.primary-cta-label': 'MANAGED_CTA',
      'home.highlights.items': [
        { description: 'MANAGED_HIGHLIGHT_BODY', id: 'managed', title: 'MANAGED_HIGHLIGHT' },
      ],
      'home.section-order': [
        'cta',
        'highlights',
        'featured-work',
        'services',
        'mobile-detailing',
        'comparison',
        'story',
        'goal',
        'areas',
        'faq',
      ],
      'portfolio.images': [
        {
          id: 'managed-photo',
          image: '/images/work-2.webp',
          thumbnail: '/images/work-2-480.webp',
        },
      ],
      'portfolio.items': [
        {
          alt: 'MANAGED_GALLERY_ALT',
          caption: 'MANAGED_GALLERY_CAPTION',
          category: 'exterior',
          id: 'managed-photo',
          order: 0,
          title: 'MANAGED_GALLERY_TITLE',
          visible: true,
        },
      ],
      'services.descriptions': [
        {
          alt: 'MANAGED_SERVICE_ALT',
          description: 'MANAGED_SERVICE_DESCRIPTION',
          id: 'managed-service',
          image: '/images/work-1.webp',
          imageSmall: '/images/work-1-480.webp',
          includes: ['MANAGED_SERVICE_INCLUDE'],
          name: 'MANAGED_SERVICE_NAME',
        },
      ],
      'site.metadata': {
        home: { description: 'MANAGED_META_DESCRIPTION', title: 'MANAGED_META_TITLE' },
      },
      'site.theme': 'dark',
    });
    const facts = structuredClone(defaultCoopFacts);
    Object.assign(facts, {
      'about.story': '<p>MANAGED_STORY</p>',
      'business.phone': { display: '(817) 555-0101', href: 'tel:+18175550101' },
      'business.service-areas': ['MANAGED_AREA'],
      'business.service-policy': [
        { answer: 'MANAGED_FAQ_ANSWER', question: 'MANAGED_FAQ_QUESTION' },
      ],
      'goal.financial-progress': { currentAmount: 10, target: 20, visible: true },
      'legal.privacy': '<p>MANAGED_PRIVACY</p>',
      'services.availability': ['MANAGED_ADDON'],
      'services.prices': [{ id: 'managed-service', price: '$101' }],
    });
    const root = await mkdtemp(join(tmpdir(), 'omnireach-coop-contract-'));
    temporaryDirectories.push(root);
    const assetRoot = resolve(root, 'assets');
    await mkdir(resolve(assetRoot, storageKey, '..'), { recursive: true });
    await writeFile(resolve(assetRoot, storageKey), managedBytes);
    const artifacts = new LocalArtifactStore(root);
    const snapshot = createPublicationSnapshot({
      assets: [
        {
          checksum: managedChecksum,
          id: assetId,
          mime: 'image/png',
          storageKey,
        },
      ],
      assetManifestHash: createHash('sha256').update('[]').digest('hex'),
      codeSha: '1'.repeat(40),
      content,
      contentRevision: 2,
      contractHash: contractHash(manifest),
      contractVersion: manifest.version,
      facts: Object.fromEntries(
        Object.entries(facts).map(([id, value]) => [id, { value, version: 1 }]),
      ),
      siteId,
    });
    const built = await buildSnapshotArtifact({
      artifacts,
      assetStorageRoot: assetRoot,
      definition: {
        buildTools: { astro: '5.15.8', node: '24.21.0' },
        healthPaths: ['/'],
        routes: manifest.routes.map(({ path }) => path),
        workspace: manifest.build.workspace,
      },
      repositoryRoot,
      siteId: snapshot.siteId,
      snapshot,
    });
    const directory = artifacts.artifactPath(snapshot.siteId, built.artifactHash);
    const pages = await Promise.all(
      [
        'index.html',
        'services/index.html',
        'our-work/index.html',
        'about/index.html',
        'contact/index.html',
        'privacy/index.html',
      ].map((path) => readFile(resolve(directory, path), 'utf8')),
    );
    const html = pages.join('\n');
    for (const token of [
      'MANAGED_HEADING',
      'MANAGED_INTRO',
      'MANAGED_HERO_ALT',
      'MANAGED_CTA',
      'MANAGED_HIGHLIGHT',
      'MANAGED_SERVICE_NAME',
      'MANAGED_SERVICE_DESCRIPTION',
      'MANAGED_SERVICE_INCLUDE',
      '$101',
      'MANAGED_ADDON',
      'MANAGED_GALLERY_TITLE',
      'MANAGED_GALLERY_CAPTION',
      'MANAGED_GALLERY_ALT',
      'MANAGED_STORY',
      'MANAGED_FAQ_QUESTION',
      'MANAGED_FAQ_ANSWER',
      '(817) 555-0101',
      'MANAGED_AREA',
      'MANAGED_PRIVACY',
      'MANAGED_META_TITLE',
      'MANAGED_META_DESCRIPTION',
      'data-theme="dark"',
    ]) {
      expect(html, token).toContain(token);
    }
    expect(pages[0]).toContain('<div style="order:1"><section class="final-cta"');
    expect(pages[0]).toContain(`/managed-assets/${assetId}.png`);
    await expect(readFile(resolve(directory, `managed-assets/${assetId}.png`))).resolves.toEqual(
      managedBytes,
    );
    expect(pages[0]).toContain('$10');
    expect(pages[0]).toContain('$20');
  }, 30_000);
});
