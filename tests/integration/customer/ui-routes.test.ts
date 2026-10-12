import {
  buildApiServer,
  type CustomerEndpointService,
  type CustomerPrincipal,
} from '@omnireach/api';
import { PublicationPendingError, RevisionConflictError } from '@omnireach/content';
import { afterEach, describe, expect, it, vi } from 'vitest';

const draftId = '80000000-0000-4000-8000-000000000001';
const owner: CustomerPrincipal = {
  editorPublishGrant: false,
  role: 'customer_owner',
  siteId: '20000000-0000-4000-8000-000000000010',
  tenantId: '10000000-0000-4000-8000-000000000010',
  traceId: 'customer-ui-trace',
  userId: '40000000-0000-4000-8000-000000000011',
};

function service(): CustomerEndpointService & {
  draftUpdate: ReturnType<typeof vi.fn>;
  fieldUpdate: ReturnType<typeof vi.fn>;
  preview: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
} {
  return {
    assetDownload: vi.fn(async () => ({
      bytes: new Uint8Array(),
      contentType: 'image/png',
      filename: 'image.png',
    })),
    assetUpload: vi.fn(async () => ({})),
    contactForms: vi.fn(async () => []),
    contactSubmissions: vi.fn(async () => []),
    createDraft: vi.fn(async () => ({ id: draftId })),
    dashboard: vi.fn(async () => ({})),
    drafts: vi.fn(async () => [
      {
        baseRevision: 3,
        content: {
          'business.hours': 'Always open',
          'home.heading': 'Original heading',
          'site.theme': 'default',
        },
        current: true,
        id: draftId,
        version: 2,
      },
    ]),
    draftUpdate: vi.fn(async (_principal, input) => ({ version: input.expectedVersion + 1 })),
    fieldUpdate: vi.fn(async (_principal, input) => ({ version: input.expectedVersion + 1 })),
    history: vi.fn(async () => [
      {
        active: true,
        createdAt: new Date('2026-10-10T20:00:00.000Z'),
        createdBy: owner.userId,
        origin: 'human',
        publicationPending: false,
        publicationStatus: 'published',
        revision: 3,
      },
    ]),
    pages: vi.fn(async () => [
      {
        fields: [
          {
            aiMode: 'auto',
            editableBy: ['customer_owner', 'customer_editor'],
            id: 'home.heading',
            protected: false,
            type: 'text',
          },
          {
            aiMode: 'disabled',
            editableBy: ['customer_owner'],
            id: 'business.hours',
            protected: true,
            type: 'text',
          },
          {
            aiMode: 'disabled',
            editableBy: ['customer_owner'],
            id: 'site.theme',
            protected: false,
            type: 'theme',
          },
        ],
        id: '30000000-0000-4000-8000-000000000001',
        route: '/',
        schemaVersion: 1,
        stableId: 'home',
      },
    ]),
    preview: vi.fn(async () => ({ previewToken: 'opaque-preview-token' })),
    previewFile: vi.fn(async () => ({
      body: new TextEncoder().encode('<h1>Preview</h1>'),
      contentType: 'text/html; charset=utf-8',
    })),
    publish: vi.fn(async () => ({ status: 'queued' })),
    restore: vi.fn(async () => ({ status: 'queued' })),
    updateContactForm: vi.fn(async () => ({})),
  };
}

const servers: ReturnType<typeof buildApiServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

function buildCustomerUi(content: CustomerEndpointService, principal = owner) {
  const server = buildApiServer({
    customerService: content,
    logLevel: 'silent',
    resolveCustomerPrincipal: async (request) =>
      request.hostname === 'admin.alpha.test' &&
      request.headers.cookie?.includes('customer-session')
        ? principal
        : undefined,
  });
  servers.push(server);
  return server;
}

const authenticatedHeaders = {
  cookie: '__Host-omnireach_session=customer-session',
  host: 'admin.alpha.test',
};

function formIdempotencyKey(html: string, action: string): string {
  const actionIndex = html.indexOf(`action="${action}"`);
  const formEnd = html.indexOf('</form>', actionIndex);
  const form = actionIndex >= 0 && formEnd >= 0 ? html.slice(actionIndex, formEnd) : '';
  const key = /name="idempotencyKey" value="([0-9a-f-]{36})"/u.exec(form)?.[1];
  if (!key) throw new Error(`Idempotency key was not rendered for ${action}`);
  return key;
}

describe('customer editor and history pages', () => {
  it('creates a draft from the served empty state', async () => {
    const content = service();
    vi.mocked(content.drafts).mockResolvedValue([]);
    const server = buildCustomerUi(content);

    const empty = await server.inject({
      headers: authenticatedHeaders,
      method: 'GET',
      url: '/editor',
    });
    expect(empty.body).toContain('Create draft');

    const created = await server.inject({
      headers: {
        ...authenticatedHeaders,
        origin: 'https://admin.alpha.test',
      },
      method: 'POST',
      url: '/editor/draft/new',
    });
    expect(created.statusCode).toBe(303);
    expect(created.headers.location).toBe('/editor?notice=draft-created');
    expect(content.createDraft).toHaveBeenCalledWith(owner);
  });

  it('serves authenticated real draft and history models without crossing hosts', async () => {
    const content = service();
    const server = buildCustomerUi(content);

    const editor = await server.inject({
      headers: authenticatedHeaders,
      method: 'GET',
      url: '/editor',
    });
    expect(editor.statusCode).toBe(200);
    expect(editor.body).toContain('Content editor');
    expect(editor.body).toContain('Original heading');
    expect(editor.body).toContain(`name="draftId" value="${draftId}"`);
    expect(editor.body).toContain('Preview draft');
    expect(editor.body).toContain('Publish draft');
    expect(editor.body).toContain('Verified business fact');

    const history = await server.inject({
      headers: authenticatedHeaders,
      method: 'GET',
      url: '/history',
    });
    expect(history.statusCode).toBe(200);
    expect(history.body).toContain('2026-10-10T20:00:00.000Z');
    expect(history.body).toContain('Restore revision 3');
    expect(history.body).toContain('<td>customer</td>');

    const sisterHost = await server.inject({
      headers: {
        cookie: '__Host-omnireach_session=customer-session',
        host: 'admin.sister.test',
      },
      method: 'GET',
      url: '/editor',
    });
    expect(sisterHost.statusCode).toBe(303);
    expect(sisterHost.headers.location).toBe('/login');
  });

  it('saves only server-declared editable fields and rejects cross-origin form posts', async () => {
    const content = service();
    const server = buildCustomerUi(content);
    const payload = new URLSearchParams({
      'business.hours': 'Attacker supplied value',
      'home.heading': 'Updated heading',
      draftId,
      expectedVersion: '2',
      'unknown.field': 'Ignored',
    }).toString();

    const rejected = await server.inject({
      headers: {
        ...authenticatedHeaders,
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://attacker.test',
      },
      method: 'POST',
      payload,
      url: '/editor/draft',
    });
    expect(rejected.statusCode).toBe(403);
    expect(content.draftUpdate).not.toHaveBeenCalled();

    const saved = await server.inject({
      headers: {
        ...authenticatedHeaders,
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://admin.alpha.test',
      },
      method: 'POST',
      payload,
      url: '/editor/draft',
    });
    expect(saved.statusCode).toBe(303);
    expect(saved.headers.location).toBe('/editor?notice=draft-saved');
    expect(content.draftUpdate).toHaveBeenCalledTimes(1);
    expect(content.draftUpdate).toHaveBeenCalledWith(owner, {
      draftId,
      expectedVersion: 2,
      patch: { 'home.heading': 'Updated heading' },
    });
    expect(content.fieldUpdate).not.toHaveBeenCalled();
  });

  it('keeps preview tokens host-only and wires publish and restore with server idempotency', async () => {
    const content = service();
    const server = buildCustomerUi(content);
    const formHeaders = {
      ...authenticatedHeaders,
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://admin.alpha.test',
    };
    const editor = await server.inject({
      headers: authenticatedHeaders,
      method: 'GET',
      url: '/editor',
    });
    const publishIdempotencyKey = formIdempotencyKey(editor.body, '/editor/publish');

    const preview = await server.inject({
      headers: formHeaders,
      method: 'POST',
      payload: new URLSearchParams({ draftId }).toString(),
      url: '/editor/preview',
    });
    expect(preview.statusCode).toBe(303);
    expect(preview.headers.location).toBe('/v1/customer/preview-content/');
    expect(preview.headers['set-cookie']).toContain('__Host-omnireach_preview=');
    expect(preview.headers['set-cookie']).toContain('Path=/;');
    expect(preview.headers['set-cookie']).not.toContain('Path=/v1/customer/preview-content');
    expect(preview.headers['set-cookie']).toContain('HttpOnly');
    expect(preview.headers['set-cookie']).toContain('Secure');
    expect(preview.headers['set-cookie']).toContain('SameSite=Strict');
    expect(preview.headers['set-cookie']).not.toContain('Domain=');

    const published = await server.inject({
      headers: formHeaders,
      method: 'POST',
      payload: new URLSearchParams({
        draftId,
        idempotencyKey: publishIdempotencyKey,
        reason: 'Approved customer update',
      }).toString(),
      url: '/editor/publish',
    });
    expect(published.statusCode).toBe(303);
    expect(published.headers.location).toBe('/history?notice=publication-queued');
    expect(content.publish).toHaveBeenCalledWith(owner, {
      draftId,
      idempotencyKey: publishIdempotencyKey,
      reason: 'Approved customer update',
    });

    const duplicatePublish = await server.inject({
      headers: formHeaders,
      method: 'POST',
      payload: new URLSearchParams({
        draftId,
        idempotencyKey: publishIdempotencyKey,
        reason: 'Approved customer update',
      }).toString(),
      url: '/editor/publish',
    });
    expect(duplicatePublish.statusCode).toBe(303);
    expect(content.publish).toHaveBeenCalledTimes(2);
    expect(vi.mocked(content.publish).mock.calls[1]?.[1].idempotencyKey).toBe(
      publishIdempotencyKey,
    );

    const history = await server.inject({
      headers: authenticatedHeaders,
      method: 'GET',
      url: '/history',
    });
    const restoreIdempotencyKey = formIdempotencyKey(history.body, '/history/3/restore');

    const restored = await server.inject({
      headers: formHeaders,
      method: 'POST',
      payload: new URLSearchParams({
        idempotencyKey: restoreIdempotencyKey,
        reason: 'Return to approved revision',
      }).toString(),
      url: '/history/3/restore',
    });
    expect(restored.statusCode).toBe(303);
    expect(restored.headers.location).toBe('/history?notice=restore-queued');
    expect(content.restore).toHaveBeenCalledWith(owner, {
      idempotencyKey: restoreIdempotencyKey,
      reason: 'Return to approved revision',
      revision: 3,
    });

    const duplicateRestore = await server.inject({
      headers: formHeaders,
      method: 'POST',
      payload: new URLSearchParams({
        idempotencyKey: restoreIdempotencyKey,
        reason: 'Return to approved revision',
      }).toString(),
      url: '/history/3/restore',
    });
    expect(duplicateRestore.statusCode).toBe(303);
    expect(content.restore).toHaveBeenCalledTimes(2);
    expect(vi.mocked(content.restore).mock.calls[1]?.[1].idempotencyKey).toBe(
      restoreIdempotencyKey,
    );
  });

  it('freezes the editor during a queued build and unlocks the same draft after failure', async () => {
    const content = service();
    vi.mocked(content.drafts).mockResolvedValue([
      {
        baseRevision: 3,
        content: { 'home.heading': 'Frozen snapshot' },
        current: true,
        id: draftId,
        publicationStatus: 'building',
        version: 2,
      },
    ]);
    vi.mocked(content.history).mockResolvedValue([
      {
        active: false,
        createdAt: new Date('2026-10-11T20:00:00.000Z'),
        createdBy: owner.userId,
        origin: 'human',
        publicationPending: true,
        publicationStatus: 'building',
        revision: 4,
      },
    ]);
    const server = buildCustomerUi(content);

    const building = await server.inject({
      headers: authenticatedHeaders,
      method: 'GET',
      url: '/editor',
    });
    expect(building.body).toContain('Publication is building');
    expect(building.body).not.toContain('Save draft');
    const blockedSave = await server.inject({
      headers: {
        ...authenticatedHeaders,
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://admin.alpha.test',
      },
      method: 'POST',
      payload: new URLSearchParams({
        draftId,
        expectedVersion: '2',
        'home.heading': 'Must not diverge',
      }).toString(),
      url: '/editor/draft',
    });
    expect(blockedSave.statusCode).toBe(409);
    expect(content.draftUpdate).not.toHaveBeenCalled();

    vi.mocked(content.drafts).mockResolvedValue([
      {
        baseRevision: 3,
        content: { 'home.heading': 'Frozen snapshot' },
        current: true,
        id: draftId,
        version: 2,
      },
    ]);
    vi.mocked(content.history).mockResolvedValue([
      {
        active: false,
        createdAt: new Date('2026-10-11T20:00:00.000Z'),
        createdBy: owner.userId,
        errorCode: 'publication_failed',
        origin: 'human',
        publicationPending: false,
        publicationStatus: 'failed',
        revision: 4,
      },
    ]);
    const recovered = await server.inject({
      headers: authenticatedHeaders,
      method: 'GET',
      url: '/editor',
    });
    expect(recovered.body).toContain('Save draft');
    const failedHistory = await server.inject({
      headers: authenticatedHeaders,
      method: 'GET',
      url: '/history',
    });
    expect(failedHistory.body).toContain('Failed');
    expect(failedHistory.body).toContain('live content unchanged');
    expect(failedHistory.body).not.toContain('action="/history/4/restore"');
  });

  it('fails closed instead of choosing an arbitrary duplicate or stale active draft', async () => {
    const content = service();
    const duplicate = {
      baseRevision: 3,
      content: { 'home.heading': 'Duplicate' },
      current: true,
      id: draftId,
      version: 2,
    };
    vi.mocked(content.drafts).mockResolvedValue([
      duplicate,
      { ...duplicate, id: '80000000-0000-4000-8000-000000000002' },
    ]);
    const server = buildCustomerUi(content);
    const conflicted = await server.inject({
      headers: authenticatedHeaders,
      method: 'GET',
      url: '/editor',
    });
    expect(conflicted.statusCode).toBe(409);
    expect(conflicted.body).toContain('Multiple active drafts');

    vi.mocked(content.drafts).mockResolvedValue([{ ...duplicate, current: false }]);
    const stale = await server.inject({
      headers: authenticatedHeaders,
      method: 'GET',
      url: '/editor',
    });
    expect(stale.body).toContain('Start from latest published revision');
    expect(stale.body).not.toContain('Save draft');
    const staleSave = await server.inject({
      headers: {
        ...authenticatedHeaders,
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://admin.alpha.test',
      },
      method: 'POST',
      payload: new URLSearchParams({
        draftId,
        expectedVersion: '2',
        'home.heading': 'Stale browser write',
      }).toString(),
      url: '/editor/draft',
    });
    expect(staleSave.statusCode).toBe(409);
    expect(content.draftUpdate).not.toHaveBeenCalled();
  });

  it('renders safe HTML lifecycle conflicts for publish and restore forms', async () => {
    const content = service();
    vi.mocked(content.publish).mockRejectedValue(
      new PublicationPendingError('private publication queue details'),
    );
    vi.mocked(content.restore).mockRejectedValue(
      new RevisionConflictError('private restore eligibility details'),
    );
    const server = buildCustomerUi(content);
    const headers = {
      ...authenticatedHeaders,
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://admin.alpha.test',
    };
    const publish = await server.inject({
      headers,
      method: 'POST',
      payload: new URLSearchParams({
        draftId,
        idempotencyKey: '90000000-0000-4000-8000-000000000001',
        reason: 'Approved publication',
      }).toString(),
      url: '/editor/publish',
    });
    expect(publish.statusCode).toBe(409);
    expect(publish.headers['content-type']).toContain('text/html');
    expect(publish.body).toContain('Another publication is already in progress');
    expect(publish.body).not.toContain('private');

    const restore = await server.inject({
      headers,
      method: 'POST',
      payload: new URLSearchParams({
        idempotencyKey: '90000000-0000-4000-8000-000000000002',
        reason: 'Approved restore',
      }).toString(),
      url: '/history/3/restore',
    });
    expect(restore.statusCode).toBe(409);
    expect(restore.headers['content-type']).toContain('text/html');
    expect(restore.body).toContain('no longer eligible for restore');
    expect(restore.body).not.toContain('private');
  });

  it('supports publish, atomic rebase, edit, and publish again', async () => {
    const content = service();
    let activeDraftId = draftId;
    let current = true;
    let version = 2;
    let heading = 'First publish';
    let pending = false;
    let revision = 3;
    const history = [
      {
        active: true,
        createdAt: new Date('2026-10-10T20:00:00.000Z'),
        createdBy: owner.userId,
        origin: 'human',
        publicationPending: false,
        publicationStatus: 'published',
        revision,
      },
    ];
    vi.mocked(content.drafts).mockImplementation(async () => [
      {
        baseRevision: revision,
        content: { 'home.heading': heading },
        current,
        id: activeDraftId,
        ...(pending ? { publicationStatus: 'queued' as const } : {}),
        version,
      },
    ]);
    vi.mocked(content.history).mockImplementation(async () => history);
    vi.mocked(content.createDraft).mockImplementation(async () => {
      activeDraftId = '80000000-0000-4000-8000-000000000002';
      current = true;
      version = 1;
      return { id: activeDraftId, version };
    });
    vi.mocked(content.draftUpdate).mockImplementation(async (_principal, input) => {
      heading = String(input.patch['home.heading']);
      version += 1;
      return { version };
    });
    vi.mocked(content.publish).mockImplementation(async () => {
      pending = true;
      revision += 1;
      history.unshift({
        active: false,
        createdAt: new Date('2026-10-11T20:00:00.000Z'),
        createdBy: owner.userId,
        origin: 'human',
        publicationPending: true,
        publicationStatus: 'queued',
        revision,
      });
      return { contentRevision: revision, status: 'queued' };
    });
    const server = buildCustomerUi(content);
    const formHeaders = {
      ...authenticatedHeaders,
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://admin.alpha.test',
    };

    const firstEditor = await server.inject({ headers: authenticatedHeaders, url: '/editor' });
    const firstKey = formIdempotencyKey(firstEditor.body, '/editor/publish');
    await server.inject({
      headers: formHeaders,
      method: 'POST',
      payload: new URLSearchParams({
        draftId: activeDraftId,
        idempotencyKey: firstKey,
        reason: 'First publication',
      }).toString(),
      url: '/editor/publish',
    });
    const queuedEditor = await server.inject({ headers: authenticatedHeaders, url: '/editor' });
    expect(queuedEditor.body).toContain('Editing is paused');
    expect(queuedEditor.body).not.toContain('Save draft');

    pending = false;
    current = false;
    const completedPublication = history[0];
    if (!completedPublication) throw new Error('Queued publication state is missing');
    history[0] = {
      ...completedPublication,
      active: true,
      publicationPending: false,
      publicationStatus: 'published',
    };
    const staleEditor = await server.inject({ headers: authenticatedHeaders, url: '/editor' });
    expect(staleEditor.body).toContain('Start from latest published revision');
    await server.inject({ headers: formHeaders, method: 'POST', url: '/editor/draft/new' });
    await server.inject({
      headers: formHeaders,
      method: 'POST',
      payload: new URLSearchParams({
        draftId: activeDraftId,
        expectedVersion: '1',
        'home.heading': 'Second publish',
      }).toString(),
      url: '/editor/draft',
    });
    const secondEditor = await server.inject({ headers: authenticatedHeaders, url: '/editor' });
    const secondKey = formIdempotencyKey(secondEditor.body, '/editor/publish');
    await server.inject({
      headers: formHeaders,
      method: 'POST',
      payload: new URLSearchParams({
        draftId: activeDraftId,
        idempotencyKey: secondKey,
        reason: 'Second publication',
      }).toString(),
      url: '/editor/publish',
    });
    expect(content.publish).toHaveBeenCalledTimes(2);
    expect(content.draftUpdate).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ patch: { 'home.heading': 'Second publish' } }),
    );
  });

  it('supports restore, atomic rebase, edit, and publish', async () => {
    const content = service();
    let activeDraftId = draftId;
    let current = true;
    let version = 2;
    let revision = 3;
    const history = [
      {
        active: true,
        createdAt: new Date('2026-10-10T20:00:00.000Z'),
        createdBy: owner.userId,
        origin: 'human',
        publicationPending: false,
        publicationStatus: 'published',
        revision,
      },
    ];
    vi.mocked(content.drafts).mockImplementation(async () => [
      {
        baseRevision: revision,
        content: { 'home.heading': 'Restored base' },
        current,
        id: activeDraftId,
        version,
      },
    ]);
    vi.mocked(content.history).mockImplementation(async () => history);
    vi.mocked(content.createDraft).mockImplementation(async () => {
      activeDraftId = '80000000-0000-4000-8000-000000000003';
      current = true;
      version = 1;
      return { id: activeDraftId, version };
    });
    vi.mocked(content.restore).mockImplementation(async () => {
      revision += 1;
      const priorActive = history[0];
      if (!priorActive) throw new Error('Published restore target is missing');
      history[0] = { ...priorActive, active: false };
      history.unshift({
        active: false,
        createdAt: new Date('2026-10-11T21:00:00.000Z'),
        createdBy: owner.userId,
        origin: 'restore',
        publicationPending: true,
        publicationStatus: 'queued',
        revision,
      });
      return { contentRevision: revision, status: 'queued' };
    });
    const server = buildCustomerUi(content);
    const formHeaders = {
      ...authenticatedHeaders,
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://admin.alpha.test',
    };
    const historyPage = await server.inject({ headers: authenticatedHeaders, url: '/history' });
    const restoreKey = formIdempotencyKey(historyPage.body, '/history/3/restore');
    await server.inject({
      headers: formHeaders,
      method: 'POST',
      payload: new URLSearchParams({
        idempotencyKey: restoreKey,
        reason: 'Restore known-good revision',
      }).toString(),
      url: '/history/3/restore',
    });

    const completedRestore = history[0];
    if (!completedRestore) throw new Error('Queued restore state is missing');
    history[0] = {
      ...completedRestore,
      active: true,
      publicationPending: false,
      publicationStatus: 'published',
    };
    current = false;
    const staleEditor = await server.inject({ headers: authenticatedHeaders, url: '/editor' });
    expect(staleEditor.body).toContain('Start from latest published revision');
    await server.inject({ headers: formHeaders, method: 'POST', url: '/editor/draft/new' });
    await server.inject({
      headers: formHeaders,
      method: 'POST',
      payload: new URLSearchParams({
        draftId: activeDraftId,
        expectedVersion: '1',
        'home.heading': 'Edited after restore',
      }).toString(),
      url: '/editor/draft',
    });
    const editor = await server.inject({ headers: authenticatedHeaders, url: '/editor' });
    const publishKey = formIdempotencyKey(editor.body, '/editor/publish');
    await server.inject({
      headers: formHeaders,
      method: 'POST',
      payload: new URLSearchParams({
        draftId: activeDraftId,
        idempotencyKey: publishKey,
        reason: 'Publish edits after restore',
      }).toString(),
      url: '/editor/publish',
    });
    expect(content.restore).toHaveBeenCalledTimes(1);
    expect(content.draftUpdate).toHaveBeenCalledTimes(1);
    expect(content.publish).toHaveBeenCalledTimes(1);
  });

  it('does not expose publish or restore controls to an editor without a site grant', async () => {
    const content = service();
    const editorPrincipal: CustomerPrincipal = {
      ...owner,
      role: 'customer_editor',
    };
    const server = buildCustomerUi(content, editorPrincipal);

    const editor = await server.inject({
      headers: authenticatedHeaders,
      method: 'GET',
      url: '/editor',
    });
    expect(editor.body).not.toContain('action="/editor/publish"');
    expect(editor.body).toContain('Publishing is unavailable');
    expect(editor.body).toMatch(/name="site\.theme" disabled/u);

    const ownerOnlyAttempt = await server.inject({
      headers: {
        ...authenticatedHeaders,
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://admin.alpha.test',
      },
      method: 'POST',
      payload: new URLSearchParams({
        draftId,
        expectedVersion: '2',
        'site.theme': 'dark',
      }).toString(),
      url: '/editor/draft',
    });
    expect(ownerOnlyAttempt.statusCode).toBe(303);
    expect(content.draftUpdate).not.toHaveBeenCalled();

    const denied = await server.inject({
      headers: {
        ...authenticatedHeaders,
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://admin.alpha.test',
      },
      method: 'POST',
      payload: new URLSearchParams({
        draftId,
        idempotencyKey: '90000000-0000-4000-8000-000000000001',
        reason: 'Attempted publication',
      }).toString(),
      url: '/editor/publish',
    });
    expect(denied.statusCode).toBe(403);
    expect(content.publish).not.toHaveBeenCalled();
  });
});
