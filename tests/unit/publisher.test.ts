import { MockContactDelivery, validateContactSubmission } from '@omnireach/content';
import {
  createPreviewToken,
  createPublicationSnapshot,
  discoverSiteBuildDefinitions,
  LocalArtifactStore,
  LocalPublicationBuilder,
  PostgresPreviewService,
  previewHeaders,
  runSiteBuild,
  verifyPreviewToken,
} from '@omnireach/worker-publisher';
import { describe, expect, it, vi } from 'vitest';

describe('snapshot, preview, and contact boundaries', () => {
  it('discovers every contract-valid custom site workspace without a code registry', () => {
    const definitions = discoverSiteBuildDefinitions(process.cwd());
    expect([...definitions.keys()]).toEqual([
      'sites/_starter',
      'sites/custom-portfolio-example',
      'sites/restaurant-example',
    ]);
    expect(definitions.get('sites/_starter')).toMatchObject({
      healthPaths: ['/'],
      routes: ['/', '/about/', '/menu/', '/contact/', '/privacy/'],
      workspace: '@omnireach/site-starter',
    });
  });
  it('hashes identical snapshot inputs reproducibly regardless of object key order', () => {
    const first = createPublicationSnapshot({
      assetManifestHash: 'a'.repeat(64),
      codeSha: 'b'.repeat(40),
      content: { b: 2, a: 1 },
      contentRevision: 3,
      contractHash: 'c'.repeat(64),
      contractVersion: '1.0',
      siteId: 'site-a',
    });
    const second = createPublicationSnapshot({
      assetManifestHash: 'a'.repeat(64),
      codeSha: 'b'.repeat(40),
      content: { a: 1, b: 2 },
      contentRevision: 3,
      contractHash: 'c'.repeat(64),
      contractVersion: '1.0',
      siteId: 'site-a',
    });
    expect(first.hash).toBe(second.hash);
  });

  it('authenticates expiring no-index previews', () => {
    const token = createPreviewToken(
      { expiresAt: 2_000, siteId: 'site-a', snapshotHash: 'a'.repeat(64) },
      'fictional-secret-value',
    );
    expect(verifyPreviewToken(token, 'fictional-secret-value', 1_000).siteId).toBe('site-a');
    expect(() => verifyPreviewToken(token, 'fictional-secret-value', 2_001)).toThrow('expired');
    expect(previewHeaders['X-Robots-Tag']).toContain('noindex');
    expect(previewHeaders['Cache-Control']).toContain('no-store');
  });

  it('keeps bounded contact delivery behind a mock adapter', async () => {
    const submission = validateContactSubmission({
      allowedOrigin: 'https://fictional.test',
      body: {
        consent: true,
        email: 'PERSON@EXAMPLE.TEST',
        formId: 'contact',
        message: 'A fictional inquiry',
        name: 'Example Person',
      },
      enabledFieldIds: ['name', 'email', 'message', 'consent'],
      expectedFormId: 'contact',
      fields: [
        { id: 'name', required: true, type: 'text' },
        { id: 'email', required: true, type: 'email' },
        { id: 'message', required: true, type: 'textarea' },
        { id: 'consent', required: true, type: 'consent' },
      ],
      origin: 'https://fictional.test',
      recipientEmail: 'inbox@fictional.test',
      siteId: 'site-a',
    });
    const adapter = new MockContactDelivery();
    await expect(adapter.deliver(submission)).resolves.toEqual({ providerReference: 'mock-1' });
    expect(adapter.deliveries).toHaveLength(1);
    expect(submission.fields).toEqual({
      consent: true,
      email: 'person@example.test',
      message: 'A fictional inquiry',
      name: 'Example Person',
    });
    expect(() =>
      validateContactSubmission({
        allowedOrigin: 'https://fictional.test',
        body: { consent: true, email: 'person@example.test', formId: 'contact', extra: 'no' },
        enabledFieldIds: ['email', 'consent'],
        expectedFormId: 'contact',
        fields: [
          { id: 'email', required: true, type: 'email' },
          { id: 'consent', required: true, type: 'consent' },
        ],
        origin: 'https://fictional.test',
        recipientEmail: 'inbox@fictional.test',
        siteId: 'site-a',
      }),
    ).toThrow('unsupported');
    expect(() =>
      validateContactSubmission({
        allowedOrigin: 'https://fictional.test',
        body: { formId: submission.formId, ...submission.fields },
        enabledFieldIds: ['name', 'email', 'message', 'consent'],
        expectedFormId: 'contact',
        fields: [
          { id: 'name', required: true, type: 'text' },
          { id: 'email', required: true, type: 'email' },
          { id: 'message', required: true, type: 'textarea' },
          { id: 'consent', required: true, type: 'consent' },
        ],
        origin: 'https://attacker.test',
        recipientEmail: 'inbox@fictional.test',
        siteId: 'site-a',
      }),
    ).toThrow('origin');
  });

  it('runs only a validated workspace build with a bounded secret-free environment', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'omnireach-snapshot-'));
    const snapshot = join(temporary, 'content.json');
    await writeFile(
      snapshot,
      JSON.stringify({ content: { 'home.heading': 'Snapshot-driven fictional heading' } }),
    );
    try {
      await expect(
        runSiteBuild({
          contentSnapshotPath: snapshot,
          repositoryRoot: process.cwd(),
          timeoutMs: 30_000,
          workspace: '@omnireach/site-starter',
        }),
      ).resolves.toMatchObject({ workspace: '@omnireach/site-starter' });
      await expect(readFile(resolve('sites/_starter/dist/index.html'), 'utf8')).resolves.toContain(
        'Snapshot-driven fictional heading',
      );
    } finally {
      await rm(temporary, { force: true, recursive: true });
    }
    await expect(
      runSiteBuild({
        repositoryRoot: process.cwd(),
        workspace: '; powershell -Command bad',
      }),
    ).rejects.toThrow('Invalid site workspace');
  }, 35_000);

  it('materializes snapshot content into an immutable, recorded static artifact', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'omnireach-artifact-test-'));
    const siteId = '20000000-0000-4000-8000-000000000001';
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void text;
      void values;
      return { rows: [] };
    });
    const pool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };
    const snapshot = createPublicationSnapshot({
      assetManifestHash: 'a'.repeat(64),
      codeSha: 'b'.repeat(40),
      content: { 'home.heading': 'Published from immutable snapshot' },
      contentRevision: 2,
      contractHash: 'c'.repeat(64),
      contractVersion: '1.0',
      siteId,
    });
    const artifacts = new LocalArtifactStore(join(temporary, 'artifacts'));
    const builder = new LocalPublicationBuilder(
      pool,
      {
        materializeWithSource: vi.fn(async () => ({
          snapshot,
          sourcePath: 'sites/_starter',
        })),
      } as never,
      artifacts,
      {
        codeSha: snapshot.codeSha,
        repositoryRoot: process.cwd(),
        sites: new Map([
          [
            'sites/_starter',
            {
              buildTools: { astro: '7.3.8', node: process.version },
              healthPaths: ['/'],
              routes: ['/'],
              workspace: '@omnireach/site-starter',
            },
          ],
        ]),
      },
    );
    const request = {
      actorId: '40000000-0000-4000-8000-000000000001',
      contentRevision: 2,
      editorPublishGrant: false,
      idempotencyKey: 'publisher-test-1',
      origin: 'customer' as const,
      reason: 'Approved fictional publication',
      role: 'customer_owner',
      siteId,
      tenantId: '10000000-0000-4000-8000-000000000001',
      traceId: 'trace-publisher-test',
    };
    try {
      const result = await builder.build(request);
      const html = await readFile(
        join(artifacts.artifactPath(siteId, result.artifactHash), 'index.html'),
        'utf8',
      );
      expect(html).toContain('Published from immutable snapshot');
      expect(query.mock.calls.some(([text]) => text.includes('INSERT INTO build_artifacts'))).toBe(
        true,
      );
      await expect(builder.build(request)).resolves.toEqual(result);
    } finally {
      await rm(temporary, { force: true, recursive: true });
    }
  }, 35_000);

  it('builds an expiring site-bound preview directly from a draft snapshot', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'omnireach-preview-test-'));
    const siteId = '20000000-0000-4000-8000-000000000001';
    const query = vi.fn(async (text: string) => {
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
      if (text.includes('SELECT contract_version')) {
        return {
          rows: [
            {
              contract_hash: 'c'.repeat(64),
              contract_version: '1.0',
              source_path: 'sites/_starter',
            },
          ],
        };
      }
      if (text.includes('SELECT base_revision')) {
        return {
          rows: [
            {
              base_revision: 1,
              content: { 'home.heading': 'Draft-only preview heading' },
              version: 4,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const preview = new PostgresPreviewService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
      {
        artifactsRoot: join(temporary, 'previews'),
        codeSha: 'b'.repeat(40),
        repositoryRoot: process.cwd(),
        signingKey: 'fictional-preview-signing-key-material-0001',
        definitions: new Map([
          [
            'sites/_starter',
            {
              buildTools: { astro: '7.3.8', node: process.version },
              healthPaths: ['/'],
              routes: ['/'],
              workspace: '@omnireach/site-starter',
            },
          ],
        ]),
      },
    );
    const context = {
      siteId,
      tenantId: '10000000-0000-4000-8000-000000000001',
      userId: '40000000-0000-4000-8000-000000000001',
    };
    try {
      const token = await preview.create(context, '80000000-0000-4000-8000-000000000001');
      expect(
        query.mock.calls.some(
          ([text]) => text.includes('FROM content_drafts') && text.includes("state = 'active'"),
        ),
      ).toBe(true);
      const file = await preview.read(context, { path: '', token: token.previewToken });
      expect(new TextDecoder().decode(file.body)).toContain('Draft-only preview heading');
      await expect(
        preview.read(
          { ...context, siteId: '20000000-0000-4000-8000-000000000002' },
          {
            path: '',
            token: token.previewToken,
          },
        ),
      ).rejects.toThrow('does not belong');
    } finally {
      await rm(temporary, { force: true, recursive: true });
    }
  }, 35_000);
});
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
