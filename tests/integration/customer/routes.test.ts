import { buildApiServer, type CustomerPrincipal } from '@omnireach/api';
import { ProtectedFieldError, RevisionConflictError, readLimitedUpload } from '@omnireach/content';
import { afterEach, describe, expect, it, vi } from 'vitest';

const owner: CustomerPrincipal = {
  editorPublishGrant: false,
  role: 'customer_owner',
  siteId: 'site-a',
  tenantId: 'tenant-a',
  traceId: 'trace-customer',
  userId: 'user-a',
};

function service() {
  return {
    assetDownload: vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
      filename: 'fixture.png',
    })),
    assetUpload: vi.fn(
      async (
        _principal: CustomerPrincipal,
        input: { filename: string; stream: AsyncIterable<Uint8Array> },
      ) => ({
        bytes: (await readLimitedUpload(input.stream, 10)).byteLength,
        status: 'quarantined',
      }),
    ),
    contactForms: vi.fn(async () => []),
    contactSubmissions: vi.fn(async () => []),
    createDraft: vi.fn(async () => ({ id: '80000000-0000-4000-8000-000000000001' })),
    dashboard: vi.fn(async () => ({ status: 'ready' })),
    drafts: vi.fn(async () => []),
    fieldUpdate: vi.fn(async () => ({ version: 2 })),
    history: vi.fn(async () => []),
    pages: vi.fn(async () => []),
    preview: vi.fn(async () => ({ previewToken: 'fictional-preview-token' })),
    previewFile: vi.fn(async () => ({
      body: new TextEncoder().encode('<h1>Preview</h1>'),
      contentType: 'text/html; charset=utf-8',
    })),
    publish: vi.fn(async () => ({ status: 'queued' })),
    restore: vi.fn(async () => ({ status: 'queued' })),
    updateContactForm: vi.fn(async () => ({ status: 'updated' })),
  };
}

const servers: ReturnType<typeof buildApiServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe('customer content routes', () => {
  it('returns safe conflict and protected-field errors without leaking internals', async () => {
    const content = service();
    content.fieldUpdate
      .mockRejectedValueOnce(new RevisionConflictError('private stale details'))
      .mockRejectedValueOnce(new ProtectedFieldError('private policy details'));
    const server = buildApiServer({
      customerService: content,
      logLevel: 'silent',
      resolveCustomerPrincipal: async () => owner,
    });
    servers.push(server);
    const request = (value: string) =>
      server.inject({
        headers: { host: 'admin.alpha.test', origin: 'https://admin.alpha.test' },
        method: 'PATCH',
        payload: { expectedVersion: 1, value },
        url: '/v1/customer/drafts/80000000-0000-4000-8000-000000000001/fields/home.heading',
      });
    const stale = await request('Stale');
    const protectedField = await request('Forbidden');
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'revision_conflict' });
    expect(protectedField.statusCode).toBe(403);
    expect(protectedField.json()).toEqual({ error: 'field_protected' });
    expect(`${stale.body}${protectedField.body}`).not.toContain('private');
  });

  it('passes only the server-resolved site principal to content services', async () => {
    const content = service();
    const server = buildApiServer({
      customerService: content,
      logLevel: 'silent',
      resolveCustomerPrincipal: async () => owner,
    });
    servers.push(server);

    const response = await server.inject({
      headers: { host: 'admin.alpha.test', origin: 'https://admin.alpha.test' },
      method: 'PATCH',
      payload: { expectedVersion: 1, siteId: 'site-b', value: 'Updated' },
      url: '/v1/customer/drafts/80000000-0000-4000-8000-000000000001/fields/home.heading',
    });
    expect(response.statusCode).toBe(200);
    expect(content.fieldUpdate).toHaveBeenCalledWith(owner, {
      draftId: '80000000-0000-4000-8000-000000000001',
      expectedVersion: 1,
      fieldId: 'home.heading',
      value: 'Updated',
    });
  });

  it('requires explicit editor publish grants and an idempotency key', async () => {
    const content = service();
    const server = buildApiServer({
      customerService: content,
      logLevel: 'silent',
      resolveCustomerPrincipal: async () => ({ ...owner, role: 'customer_editor' }),
    });
    servers.push(server);
    const draftId = '10000000-0000-4000-8000-000000000001';

    const denied = await server.inject({
      headers: { host: 'admin.alpha.test', origin: 'https://admin.alpha.test' },
      method: 'POST',
      payload: { reason: 'Approved draft' },
      url: `/v1/customer/drafts/${draftId}/publish`,
    });
    expect(denied.statusCode).toBe(403);
    expect(content.publish).not.toHaveBeenCalled();

    const grantedServer = buildApiServer({
      customerService: content,
      logLevel: 'silent',
      resolveCustomerPrincipal: async () => ({
        ...owner,
        editorPublishGrant: true,
        role: 'customer_editor',
      }),
    });
    servers.push(grantedServer);
    const missingKey = await grantedServer.inject({
      headers: { host: 'admin.alpha.test', origin: 'https://admin.alpha.test' },
      method: 'POST',
      payload: { reason: 'Approved draft' },
      url: `/v1/customer/drafts/${draftId}/publish`,
    });
    expect(missingKey.statusCode).toBe(400);
    const accepted = await grantedServer.inject({
      headers: {
        host: 'admin.alpha.test',
        'idempotency-key': 'publish-1',
        origin: 'https://admin.alpha.test',
      },
      method: 'POST',
      payload: { reason: 'Approved draft' },
      url: `/v1/customer/drafts/${draftId}/publish`,
    });
    expect(accepted.statusCode).toBe(202);
  });

  it('fails closed when no host-scoped session resolves', async () => {
    const content = service();
    const server = buildApiServer({
      customerService: content,
      logLevel: 'silent',
      resolveCustomerPrincipal: async () => undefined,
    });
    servers.push(server);
    const response = await server.inject({ method: 'GET', url: '/v1/customer/dashboard' });
    expect(response.statusCode).toBe(403);
    expect(content.dashboard).not.toHaveBeenCalled();
  });

  it('streams site-scoped asset uploads and authorizes original downloads', async () => {
    const content = service();
    const server = buildApiServer({
      customerService: content,
      logLevel: 'silent',
      resolveCustomerPrincipal: async () => owner,
    });
    servers.push(server);
    const uploaded = await server.inject({
      headers: {
        'content-type': 'application/octet-stream',
        host: 'admin.alpha.test',
        origin: 'https://admin.alpha.test',
        'x-file-name': 'fixture.png',
      },
      method: 'POST',
      payload: Buffer.from([1, 2, 3]),
      url: '/v1/customer/assets',
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toMatchObject({ bytes: 3, status: 'quarantined' });
    expect(content.assetUpload).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ filename: 'fixture.png' }),
    );

    const downloaded = await server.inject({
      method: 'GET',
      url: '/v1/customer/assets/10000000-0000-4000-8000-000000000002',
    });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers['content-type']).toBe('image/png');
    expect(downloaded.headers['content-disposition']).toContain('fixture.png');
  });

  it('keeps preview tokens in a host-only cookie and serves no-index content', async () => {
    const content = service();
    const server = buildApiServer({
      customerService: content,
      logLevel: 'silent',
      resolveCustomerPrincipal: async () => owner,
    });
    servers.push(server);
    const created = await server.inject({
      headers: { host: 'admin.alpha.test', origin: 'https://admin.alpha.test' },
      method: 'POST',
      payload: { draftId: '10000000-0000-4000-8000-000000000003' },
      url: '/v1/customer/preview',
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain('fictional-preview-token');
    expect(created.headers['set-cookie']).toContain('__Host-omnireach_preview=');
    expect(created.headers['set-cookie']).not.toContain('Domain=');

    const preview = await server.inject({
      cookies: { '__Host-omnireach_preview': 'fictional-preview-token' },
      method: 'GET',
      url: '/v1/customer/preview-content/index.html',
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['x-robots-tag']).toContain('noindex');
    expect(preview.headers['cache-control']).toContain('no-store');
    expect(content.previewFile).toHaveBeenCalledWith(owner, {
      path: 'index.html',
      token: 'fictional-preview-token',
    });
  });

  it('lets authorized customers view submissions and configure only supported form fields', async () => {
    const content = service();
    const server = buildApiServer({
      customerService: content,
      logLevel: 'silent',
      resolveCustomerPrincipal: async () => owner,
    });
    servers.push(server);
    const headers = { host: 'admin.alpha.test', origin: 'https://admin.alpha.test' };
    const forms = await server.inject({
      headers,
      method: 'GET',
      url: '/v1/customer/contact-forms',
    });
    const submissions = await server.inject({
      headers,
      method: 'GET',
      url: '/v1/customer/contact-submissions',
    });
    const updated = await server.inject({
      headers,
      method: 'PATCH',
      payload: {
        confirmationEnabled: false,
        fieldIds: ['name', 'email', 'message', 'consent'],
        reason: 'Approved form configuration',
      },
      url: '/v1/customer/contact-forms/general-inquiry',
    });

    expect([forms.statusCode, submissions.statusCode, updated.statusCode]).toEqual([200, 200, 200]);
    expect(content.updateContactForm).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ formId: 'general-inquiry' }),
    );
  });
});
