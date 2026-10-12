import {
  buildApiServer,
  type CustomerEndpointService,
  type CustomerPrincipal,
} from '@omnireach/api';
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
        id: draftId,
        version: 2,
      },
    ]),
    draftUpdate: vi.fn(async (_principal, input) => ({ version: input.expectedVersion + 1 })),
    fieldUpdate: vi.fn(async (_principal, input) => ({ version: input.expectedVersion + 1 })),
    history: vi.fn(async () => [
      {
        createdAt: new Date('2026-10-10T20:00:00.000Z'),
        createdBy: owner.userId,
        origin: 'human',
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
