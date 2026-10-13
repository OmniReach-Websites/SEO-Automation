import { buildApiServer, type CustomerPrincipal } from '@omnireach/api';
import type { AdminActor } from '@omnireach/tenant';
import { expect, test } from '@playwright/test';

const staff: AdminActor = {
  authorization: {
    grants: [
      {
        assignmentId: 'e2e-platform-admin-assignment',
        permissionKeys: ['customers.create', 'customers.users.manage', 'websites.create'],
        portfolio: true,
        siteIds: [],
        tenantIds: [],
      },
    ],
    membershipId: '60000000-0000-4000-8000-000000000010',
    version: 1,
  },
  id: '40000000-0000-4000-8000-000000000010',
  role: 'staff',
  traceId: 'e2e-trace-staff',
};
const owner: CustomerPrincipal = {
  editorPublishGrant: false,
  role: 'customer_owner',
  siteId: '20000000-0000-4000-8000-000000000010',
  tenantId: '10000000-0000-4000-8000-000000000010',
  traceId: 'e2e-trace-customer',
  userId: '40000000-0000-4000-8000-000000000011',
};
const editor: CustomerPrincipal = {
  ...owner,
  role: 'customer_editor',
  userId: '40000000-0000-4000-8000-000000000012',
};
const viewer: CustomerPrincipal = {
  ...owner,
  role: 'customer_viewer',
  userId: '40000000-0000-4000-8000-000000000013',
};

test('agency onboarding and customer edit-to-restore flow stays host scoped', async ({
  request,
}) => {
  const state = {
    content: { 'home.heading': 'Initial fictional heading' } as Record<string, string>,
    draftVersion: 1,
    liveRevision: 1,
    revisions: [
      {
        actorLabel: 'Seed',
        createdAt: new Date(0).toISOString(),
        number: 1,
        origin: 'seed',
        restoreEligible: true,
      },
    ],
    sites: [] as { id: string; name: string; tenantId: string; tenantName: string }[],
  };
  const server = buildApiServer({
    customerService: {
      assetDownload: async () => ({
        bytes: new Uint8Array([1]),
        contentType: 'image/png',
        filename: 'fictional.png',
      }),
      assetUpload: async () => ({ status: 'validated' }),
      contactForms: async () => [],
      contactSubmissions: async () => [],
      createDraft: async () => ({
        id: '80000000-0000-4000-8000-000000000001',
        version: state.draftVersion,
      }),
      dashboard: async (principal) => ({
        liveRevision: state.liveRevision,
        siteId: principal.siteId,
      }),
      drafts: async () => [
        { id: '80000000-0000-4000-8000-000000000001', version: state.draftVersion },
      ],
      draftUpdate: async (_principal, input) => {
        if (input.expectedVersion !== state.draftVersion) throw new Error('stale draft');
        for (const [fieldId, value] of Object.entries(input.patch)) {
          state.content[fieldId] = String(value);
        }
        state.draftVersion += 1;
        return { version: state.draftVersion };
      },
      fieldUpdate: async (_principal, input) => {
        if (input.expectedVersion !== state.draftVersion) throw new Error('stale draft');
        state.content[input.fieldId] = String(input.value);
        state.draftVersion += 1;
        return { version: state.draftVersion };
      },
      history: async () => state.revisions,
      reports: async () => ({ generatedAt: new Date(0).toISOString(), measurements: [] }),
      pages: async () => [{ fields: state.content, stableId: 'home' }],
      preview: async () => ({ previewToken: 'e2e-preview-token' }),
      previewFile: async (_principal, input) => {
        if (input.token !== 'e2e-preview-token') throw new Error('invalid preview');
        return {
          body: new TextEncoder().encode(`<h1>${state.content['home.heading']}</h1>`),
          contentType: 'text/html; charset=utf-8',
        };
      },
      publish: async (_principal, input) => {
        state.liveRevision += 1;
        state.revisions.push({
          actorLabel: 'Fictional Owner',
          createdAt: new Date(state.liveRevision * 1000).toISOString(),
          number: state.liveRevision,
          origin: 'customer',
          restoreEligible: true,
        });
        return { idempotencyKey: input.idempotencyKey, revision: state.liveRevision };
      },
      restore: async (_principal, input) => {
        if (!state.revisions.some(({ number }) => number === input.revision)) {
          throw new Error('revision missing');
        }
        state.liveRevision += 1;
        state.revisions.push({
          actorLabel: 'Fictional Owner',
          createdAt: new Date(state.liveRevision * 1000).toISOString(),
          number: state.liveRevision,
          origin: 'restore',
          restoreEligible: true,
        });
        return { restoredFrom: input.revision, revision: state.liveRevision };
      },
      updateContactForm: async () => ({ status: 'updated' }),
    },
    logLevel: 'silent',
    orapService: {
      assignPlan: async () => ({ status: 'assigned' }),
      changeCustomerRole: async () => ({ status: 'changed' }),
      createTenantAndSite: async (_actor, input) => {
        const site = {
          id: owner.siteId,
          name: input.siteName,
          tenantId: owner.tenantId,
          tenantName: input.tenantName,
        };
        state.sites.push(site);
        return { site, tenant: { id: owner.tenantId, name: input.tenantName } };
      },
      createPlan: async () => ({ id: 'plan-a' }),
      disableCustomer: async () => ({ status: 'disabled' }),
      inviteCustomer: async (_actor, input) => ({
        email: input.email,
        invitationId: '70000000-0000-4000-8000-000000000001',
        status: 'pending',
      }),
      listSites: async () => state.sites,
      requestCustomerReset: async () => ({ status: 'accepted' }),
      setContactForm: async () => ({ status: 'updated' }),
      setContactSubmissionHold: async () => ({ status: 'updated' }),
      setEmergencyControls: async () => ({ status: 'updated' }),
      setFeatureOverride: async () => ({ status: 'updated' }),
      setPlatformAiBudget: async () => ({ status: 'updated' }),
      setQuotaOverride: async () => ({ status: 'updated' }),
      setSiteAiBudget: async () => ({ status: 'updated' }),
      setSubscriptionState: async () => ({ status: 'updated' }),
    },
    resolveCustomerPrincipal: async (incoming) => {
      const cookie = incoming.headers.cookie ?? '';
      if (incoming.hostname !== 'admin.alpha.test') return undefined;
      if (cookie.includes('owner-session')) return owner;
      if (cookie.includes('editor-session')) return editor;
      if (cookie.includes('viewer-session')) return viewer;
      return undefined;
    },
    resolvePlatformActor: async (incoming) => {
      const cookie = incoming.headers.cookie ?? '';
      return incoming.hostname === 'admin.omnireach.test' && cookie.includes('staff-session')
        ? { ...staff, traceId: String(incoming.id) }
        : undefined;
    },
  });
  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address();
  if (!address || typeof address === 'string') throw new Error('Test server address unavailable');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const staffHeaders = {
      cookie: '__Host-omnireach_session=staff-session',
      host: 'admin.omnireach.test',
      origin: 'https://admin.omnireach.test',
    };
    const created = await request.post(`${base}/v1/orap/sites`, {
      data: {
        reason: 'Approved fictional onboarding',
        siteName: 'Fictional Alpha',
        sourcePath: 'sites/_starter',
        tenantName: 'Fictional Alpha Group',
      },
      headers: staffHeaders,
    });
    expect(created.status()).toBe(201);
    const invitation = await request.post(`${base}/v1/orap/sites/${owner.siteId}/invitations`, {
      data: {
        email: 'owner@alpha.example.test',
        reason: 'Approved fictional access',
        role: 'customer_owner',
        tenantId: owner.tenantId,
      },
      headers: staffHeaders,
    });
    expect(invitation.status()).toBe(202);
    expect(await invitation.text()).not.toMatch(/password|token|hash/iu);
    for (const role of ['customer_editor', 'customer_viewer'] as const) {
      const roleInvitation = await request.post(
        `${base}/v1/orap/sites/${owner.siteId}/invitations`,
        {
          data: {
            email: `${role.replace('customer_', '')}@alpha.example.test`,
            reason: `Approved fictional ${role} access`,
            role,
            tenantId: owner.tenantId,
          },
          headers: staffHeaders,
        },
      );
      expect(roleInvitation.status()).toBe(202);
    }

    const customerHeaders = {
      cookie: '__Host-omnireach_session=owner-session',
      host: 'admin.alpha.test',
      origin: 'https://admin.alpha.test',
    };
    const dashboard = await request.get(`${base}/v1/customer/dashboard`, {
      headers: customerHeaders,
    });
    expect(await dashboard.json()).toMatchObject({ siteId: owner.siteId });
    const sisterSite = await request.get(`${base}/v1/customer/dashboard`, {
      headers: {
        ...customerHeaders,
        host: 'admin.sister.test',
        origin: 'https://admin.sister.test',
      },
    });
    expect(sisterSite.status()).toBe(403);

    const editorDashboard = await request.get(`${base}/v1/customer/dashboard`, {
      headers: { ...customerHeaders, cookie: '__Host-omnireach_session=editor-session' },
    });
    expect(editorDashboard.status()).toBe(200);
    const editorPublish = await request.post(
      `${base}/v1/customer/drafts/80000000-0000-4000-8000-000000000001/publish`,
      {
        data: { expectedVersion: 1, reason: 'Editor must not publish without a grant' },
        headers: {
          ...customerHeaders,
          cookie: '__Host-omnireach_session=editor-session',
          'idempotency-key': 'e2e-editor-publish-denied',
        },
      },
    );
    expect(editorPublish.status()).toBe(403);
    const viewerDashboard = await request.get(`${base}/v1/customer/dashboard`, {
      headers: { ...customerHeaders, cookie: '__Host-omnireach_session=viewer-session' },
    });
    expect(viewerDashboard.status()).toBe(200);
    const viewerEdit = await request.patch(
      `${base}/v1/customer/drafts/80000000-0000-4000-8000-000000000001/fields/home.heading`,
      {
        data: { expectedVersion: 1, value: 'Viewer edit must be denied' },
        headers: { ...customerHeaders, cookie: '__Host-omnireach_session=viewer-session' },
      },
    );
    expect(viewerEdit.status()).toBe(403);

    const edited = await request.patch(
      `${base}/v1/customer/drafts/80000000-0000-4000-8000-000000000001/fields/home.heading`,
      {
        data: { expectedVersion: 1, value: 'Updated fictional heading' },
        headers: customerHeaders,
      },
    );
    expect(await edited.json()).toEqual({ version: 2 });
    const preview = await request.post(`${base}/v1/customer/preview`, {
      data: { draftId: '80000000-0000-4000-8000-000000000001' },
      headers: customerHeaders,
    });
    expect(preview.status()).toBe(201);
    expect(preview.headers()['set-cookie']).not.toContain('Domain=');

    const published = await request.post(
      `${base}/v1/customer/drafts/80000000-0000-4000-8000-000000000001/publish`,
      {
        data: { expectedVersion: 2, reason: 'Owner approved fictional update' },
        headers: { ...customerHeaders, 'idempotency-key': 'e2e-publish-1' },
      },
    );
    expect(published.status()).toBe(202);
    expect(await published.json()).toMatchObject({ revision: 2 });

    const restored = await request.post(`${base}/v1/customer/history/1/restore`, {
      data: { reason: 'Restore verified fictional revision' },
      headers: { ...customerHeaders, 'idempotency-key': 'e2e-restore-1' },
    });
    expect(restored.status()).toBe(202);
    expect(await restored.json()).toEqual({ restoredFrom: 1, revision: 3 });
    const history = await request.get(`${base}/v1/customer/history`, {
      headers: customerHeaders,
    });
    expect(await history.json()).toHaveLength(3);

    const missingOrigin = await request.patch(
      `${base}/v1/customer/drafts/80000000-0000-4000-8000-000000000001/fields/home.heading`,
      {
        data: { expectedVersion: 2, value: 'CSRF attempt' },
        headers: { cookie: customerHeaders.cookie, host: customerHeaders.host },
      },
    );
    expect(missingOrigin.status()).toBe(403);
    expect(state.content['home.heading']).toBe('Updated fictional heading');
  } finally {
    await server.close();
  }
});
