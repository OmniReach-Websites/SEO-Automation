import { buildApiServer, type CustomerPrincipal } from '@omnireach/api';
import {
  PostgresContentRepository,
  ProtectedFieldError,
  PublicationPendingError,
  RevisionConflictError,
  readLimitedUpload,
} from '@omnireach/content';
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
    draftUpdate: vi.fn(async () => ({ version: 2 })),
    fieldUpdate: vi.fn(async () => ({ version: 2 })),
    history: vi.fn(async () => []),
    pages: vi.fn(async () => []),
    proposals: vi.fn(async () => [] as unknown[]),
    reports: vi.fn(async () => ({
      generatedAt: new Date(0).toISOString(),
      measurements: [] as unknown[],
    })),
    preview: vi.fn(async () => ({ previewToken: 'fictional-preview-token' })),
    previewFile: vi.fn(async () => ({
      body: new TextEncoder().encode('<h1>Preview</h1>'),
      contentType: 'text/html; charset=utf-8',
    })),
    publish: vi.fn(async () => ({ status: 'queued' })),
    restore: vi.fn(async () => ({ status: 'queued' })),
    reviewProposal: vi.fn(async () => ({ proposalId: 'proposal-a', state: 'applied' })),
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

  it('applies a multi-field patch through one atomic service call', async () => {
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
      payload: {
        expectedVersion: 4,
        patch: { 'home.heading': 'Updated', 'home.intro': '<p>Updated</p>' },
      },
      url: '/v1/customer/drafts/80000000-0000-4000-8000-000000000001',
    });
    expect(response.statusCode).toBe(200);
    expect(content.draftUpdate).toHaveBeenCalledTimes(1);
    expect(content.draftUpdate).toHaveBeenCalledWith(owner, {
      draftId: '80000000-0000-4000-8000-000000000001',
      expectedVersion: 4,
      patch: { 'home.heading': 'Updated', 'home.intro': '<p>Updated</p>' },
    });
  });

  it('returns a safe conflict when direct API editing races an in-flight publication', async () => {
    const content = service();
    content.draftUpdate.mockRejectedValue(
      new PublicationPendingError('private queued publication details'),
    );
    const server = buildApiServer({
      customerService: content,
      logLevel: 'silent',
      resolveCustomerPrincipal: async () => owner,
    });
    servers.push(server);
    const response = await server.inject({
      headers: { host: 'admin.alpha.test', origin: 'https://admin.alpha.test' },
      method: 'PATCH',
      payload: { expectedVersion: 4, patch: { 'home.heading': 'Racing edit' } },
      url: '/v1/customer/drafts/80000000-0000-4000-8000-000000000001',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'publication_pending' });
    expect(response.body).not.toContain('private');
  });

  it('denies an owner-only field to a customer editor through the direct API', async () => {
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
      if (text.includes("status IN ('queued', 'building')")) return { rows: [] };
      if (text.includes('revision.revision = COALESCE')) {
        return { rows: [{ content: { 'site.theme': 'default' }, revision: 1 }] };
      }
      if (text.includes('FROM content_drafts')) {
        return {
          rows: [
            {
              base_revision: 1,
              content: { 'site.theme': 'default' },
              id: '80000000-0000-4000-8000-000000000001',
              version: 2,
            },
          ],
        };
      }
      if (text.includes('FROM content_fields')) {
        return {
          rows: [
            {
              ai_mode: 'disabled',
              editable_by: ['customer_owner'],
              field_type: 'theme',
              protected: false,
              stable_id: 'site.theme',
            },
          ],
        };
      }
      if (text.includes('UPDATE content_drafts')) {
        return {
          rows: [
            {
              base_revision: 1,
              content: JSON.parse(String(values?.[0])) as Record<string, unknown>,
              id: '80000000-0000-4000-8000-000000000001',
              version: 3,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const repository = new PostgresContentRepository({
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    });
    const repositoryService = {
      ...service(),
      fieldUpdate: vi.fn(async (principal: CustomerPrincipal, input) =>
        repository.updateDraftField(principal, input),
      ),
    };
    const request = {
      headers: { host: 'admin.alpha.test', origin: 'https://admin.alpha.test' },
      method: 'PATCH' as const,
      payload: { expectedVersion: 2, value: 'dark' },
      url: '/v1/customer/drafts/80000000-0000-4000-8000-000000000001/fields/site.theme',
    };

    const editorServer = buildApiServer({
      customerService: repositoryService,
      logLevel: 'silent',
      resolveCustomerPrincipal: async () => ({ ...owner, role: 'customer_editor' }),
    });
    servers.push(editorServer);
    const denied = await editorServer.inject(request);
    expect(denied.statusCode).toBe(403);
    expect(query.mock.calls.some(([text]) => text.includes('UPDATE content_drafts'))).toBe(false);

    query.mockClear();
    const ownerServer = buildApiServer({
      customerService: repositoryService,
      logLevel: 'silent',
      resolveCustomerPrincipal: async () => owner,
    });
    servers.push(ownerServer);
    const accepted = await ownerServer.inject(request);
    expect(accepted.statusCode).toBe(200);
    expect(
      query.mock.calls.filter(([text]) => text.includes('UPDATE content_drafts')),
    ).toHaveLength(1);
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
      payload: { expectedVersion: 2, reason: 'Approved draft' },
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
      payload: { expectedVersion: 2, reason: 'Approved draft' },
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
      payload: { expectedVersion: 2, reason: 'Approved draft' },
      url: `/v1/customer/drafts/${draftId}/publish`,
    });
    expect(accepted.statusCode).toBe(202);
    expect(content.publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ draftId, expectedVersion: 2 }),
    );
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
    expect(created.headers['set-cookie']).toContain('Path=/;');
    expect(created.headers['set-cookie']).not.toContain('Path=/v1/customer/preview-content');
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

  it('returns only the authenticated site report assembled by the customer service', async () => {
    const content = service();
    content.reports.mockResolvedValueOnce({
      generatedAt: '2026-10-13T00:00:00.000Z',
      measurements: [
        {
          caveat: 'Search Console may omit low-volume queries.',
          freshness: 'delayed',
          kind: 'traffic',
          label: 'Search clicks',
          source: 'Google Search Console',
          state: 'available',
          value: 12,
        },
      ],
    });
    const server = buildApiServer({
      customerService: content,
      logLevel: 'silent',
      resolveCustomerPrincipal: async () => owner,
    });
    servers.push(server);

    const response = await server.inject({ method: 'GET', url: '/v1/customer/reports' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      measurements: [{ source: 'Google Search Console', value: 12 }],
    });
    expect(content.reports).toHaveBeenCalledWith(owner);
  });

  it('lists scoped AI proposals and applies approval only through the review service', async () => {
    const content = service();
    content.proposals.mockResolvedValueOnce([
      {
        base_revision: 3,
        current_value: 'Current heading',
        evidence: ['crawl:home'],
        field_id: 'home.heading',
        id: '90000000-0000-4000-8000-000000000009',
        model: 'fixture-model',
        proposed_value: 'Reviewed heading',
        rationale: 'Clearer summary',
        stale: false,
        state: 'pending',
      },
    ]);
    const server = buildApiServer({
      customerService: content,
      logLevel: 'silent',
      resolveCustomerPrincipal: async () => owner,
    });
    servers.push(server);

    const listed = await server.inject({ method: 'GET', url: '/v1/customer/proposals' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject([{ field_id: 'home.heading', stale: false }]);

    const reviewed = await server.inject({
      headers: { host: 'admin.alpha.test', origin: 'https://admin.alpha.test' },
      method: 'POST',
      payload: {
        action: 'approve',
        editedValue: 'Owner edited heading',
        reason: 'Approved after review',
      },
      url: '/v1/customer/proposals/90000000-0000-4000-8000-000000000009/review',
    });
    expect(reviewed.statusCode).toBe(200);
    expect(content.reviewProposal).toHaveBeenCalledWith(owner, {
      action: 'approve',
      editedValue: 'Owner edited heading',
      proposalId: '90000000-0000-4000-8000-000000000009',
      reason: 'Approved after review',
    });
  });
});
