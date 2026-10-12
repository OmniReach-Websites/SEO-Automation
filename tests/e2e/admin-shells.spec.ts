import { buildApiServer, type CustomerPrincipal } from '@omnireach/api';
import type { AdminActor } from '@omnireach/tenant';
import { expect, test } from '@playwright/test';

const staff: AdminActor = {
  id: '40000000-0000-4000-8000-000000000010',
  role: 'platform_owner',
  traceId: 'browser-staff-trace',
};
const customer: CustomerPrincipal = {
  editorPublishGrant: false,
  role: 'customer_owner',
  siteId: '20000000-0000-4000-8000-000000000010',
  tenantId: '10000000-0000-4000-8000-000000000010',
  traceId: 'browser-customer-trace',
  userId: '40000000-0000-4000-8000-000000000011',
};

test('served ORAP and customer shells remain accessible and host isolated', async ({ browser }) => {
  test.setTimeout(45_000);
  const server = buildApiServer({
    customerService: {
      assetDownload: async () => ({
        bytes: new Uint8Array(),
        contentType: 'image/png',
        filename: 'image.png',
      }),
      assetUpload: async () => ({}),
      contactForms: async () => [],
      contactSubmissions: async () => [],
      createDraft: async () => ({}),
      dashboard: async () => ({
        controls: { automationStopped: false, editingFrozen: false },
        integrations: { status: 'not_configured' },
        publication: { status: 'not_published' },
        site: { id: customer.siteId, name: 'Fictional Alpha', status: 'active' },
      }),
      drafts: async () => [
        {
          baseRevision: 1,
          content: { 'home.heading': 'Welcome to Fictional Alpha' },
          current: true,
          id: '80000000-0000-4000-8000-000000000001',
          version: 2,
        },
      ],
      draftUpdate: async () => ({}),
      fieldUpdate: async () => ({}),
      history: async () => [
        {
          active: false,
          createdAt: new Date('2026-10-10T21:00:00.000Z'),
          createdBy: customer.userId,
          errorCode: 'publication_failed',
          origin: 'human',
          publicationPending: false,
          publicationStatus: 'failed',
          restoreEligible: false,
          revision: 2,
        },
        {
          active: true,
          createdAt: new Date('2026-10-10T20:00:00.000Z'),
          createdBy: customer.userId,
          origin: 'human',
          publicationPending: false,
          publicationStatus: 'published',
          restoreEligible: true,
          revision: 1,
        },
      ],
      pages: async () => [
        {
          fields: [
            {
              aiMode: 'auto',
              editableBy: ['customer_owner', 'customer_editor'],
              id: 'home.heading',
              protected: false,
              type: 'text',
            },
          ],
          id: '30000000-0000-4000-8000-000000000001',
          route: '/',
          schemaVersion: 1,
          stableId: 'home',
        },
      ],
      preview: async () => ({ previewToken: 'preview' }),
      previewFile: async () => ({ body: new Uint8Array(), contentType: 'text/html' }),
      publish: async () => ({}),
      restore: async () => ({}),
      updateContactForm: async () => ({}),
    },
    logLevel: 'silent',
    orapService: {
      acknowledgeAlert: async () => ({}),
      assignPlan: async () => ({}),
      cancelJob: async () => ({}),
      changeCustomerRole: async () => ({}),
      createPlan: async () => ({}),
      createTenantAndSite: async () => ({}),
      disableCustomer: async () => ({}),
      disableStaff: async () => ({}),
      inviteCustomer: async () => ({}),
      listOperations: async () => ({
        alerts: [
          {
            fingerprint: 'fixture-alert',
            id: '80000000-0000-4000-8000-000000000001',
            message: 'Fictional worker unavailable',
            occurrences: 2,
            severity: 'critical',
            state: 'open',
          },
        ],
        budget: {
          capUsdMicros: 50_000_000,
          periodStart: '2026-10-01T00:00:00.000Z',
          reservedUsdMicros: 1_000_000,
          usedUsdMicros: 2_000_000,
        },
        jobs: [
          {
            category: 'health_check',
            id: '70000000-0000-4000-8000-000000000001',
            state: 'failed',
            traceId: 'trace-fixture-job-1',
            updatedAt: '2026-10-10T00:00:00.000Z',
          },
          {
            category: 'seo_audit',
            id: '70000000-0000-4000-8000-000000000002',
            state: 'queued',
            traceId: 'trace-fixture-job-2',
            updatedAt: '2026-10-10T00:05:00.000Z',
          },
        ],
      }),
      listSites: async () => [
        {
          id: customer.siteId,
          name: 'Fictional Alpha',
          status: 'active',
          tenantId: customer.tenantId,
          tenantName: 'Fictional Group',
        },
      ],
      listStaff: async () => [
        {
          activeSessions: 1,
          authorizationVersion: 1,
          createdAt: '2026-10-10T00:00:00.000Z',
          displayName: 'Fictional Owner',
          emailCodeEnabled: true,
          identityKind: 'platform_owner',
          lastLoginAt: '2026-10-12T00:00:00.000Z',
          membershipId: '90000000-0000-4000-8000-000000000001',
          normalizedEmail: 'owner@example.test',
          status: 'active',
          strongFactorEnrolled: true,
          userId: staff.id,
        },
        {
          activeSessions: 2,
          authorizationVersion: 1,
          createdAt: '2026-10-11T00:00:00.000Z',
          displayName: 'Fictional Employee',
          emailCodeEnabled: true,
          identityKind: 'staff',
          jobTitle: 'Operations Specialist',
          lastLoginAt: '2026-10-12T00:10:00.000Z',
          membershipId: '90000000-0000-4000-8000-000000000002',
          normalizedEmail: 'employee@example.test',
          roleName: 'Operations Manager',
          roleSlug: 'operations-manager',
          status: 'active',
          strongFactorEnrolled: false,
          userId: '40000000-0000-4000-8000-000000000012',
        },
      ],
      listStaffRoles: async () => [
        {
          description: 'Broad operational access.',
          name: 'Operations Manager',
          permissionCount: 12,
          slug: 'operations-manager',
        },
        {
          description: 'Read-only access.',
          name: 'Analyst',
          permissionCount: 5,
          slug: 'analyst',
        },
      ],
      inviteStaff: async () => ({}),
      changeStaffRole: async () => ({}),
      requestCustomerReset: async () => ({}),
      requestStaffReset: async () => ({}),
      replayJob: async () => ({}),
      resolveAlert: async () => ({}),
      revokeStaffSessions: async () => ({}),
      setContactForm: async () => ({}),
      setContactSubmissionHold: async () => ({}),
      setEmergencyControls: async () => ({}),
      setFeatureOverride: async () => ({}),
      setPlatformAiBudget: async () => ({}),
      setQuotaOverride: async () => ({}),
      setSiteAiBudget: async () => ({}),
      setSubscriptionState: async () => ({}),
      updateStaffAccount: async () => ({}),
    },
    resolveCustomerPrincipal: async (request) =>
      request.hostname === 'admin.alpha.localhost' &&
      request.headers.cookie?.includes('customer-session')
        ? customer
        : undefined,
    resolvePlatformActor: async (request) =>
      request.hostname === 'admin.omnireach.localhost' ? staff : undefined,
  });
  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address();
  if (!address || typeof address === 'string') throw new Error('Test server address unavailable');
  const customerBase = `http://admin.alpha.localhost:${address.port}`;
  const staffBase = `http://admin.omnireach.localhost:${address.port}`;
  const customerContext = await browser.newContext({
    extraHTTPHeaders: {
      cookie: '__Host-omnireach_session=customer-session',
    },
  });
  const staffContext = await browser.newContext({
    extraHTTPHeaders: {
      cookie: '__Host-omnireach_session=staff-session',
    },
  });
  try {
    const customerPage = await customerContext.newPage();
    await customerPage.goto(customerBase);
    await expect(customerPage.getByRole('heading', { level: 1 })).toHaveText('Site overview');
    await expect(customerPage.getByText('Fictional Alpha', { exact: true })).toBeVisible();
    await expect(customerPage.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    await expect(customerPage.getByRole('link', { name: 'Skip to content' })).toBeVisible();

    await customerPage.getByRole('link', { name: 'Editor' }).click();
    await expect(customerPage.getByRole('heading', { level: 1 })).toHaveText('Content editor');
    await expect(customerPage.getByLabel('Text')).toHaveValue('Welcome to Fictional Alpha');
    await expect(customerPage.getByRole('button', { name: 'Save draft' })).toBeVisible();
    await expect(customerPage.getByRole('button', { name: 'Preview draft' })).toBeVisible();
    await expect(customerPage.getByRole('button', { name: 'Publish draft' })).toBeVisible();
    await expect(
      customerPage.locator('form[action="/editor/publish"] input[name="idempotencyKey"]'),
    ).toHaveValue(/^[0-9a-f-]{36}$/u);
    await expect(
      customerPage.locator('form[action="/editor/publish"] input[name="expectedVersion"]'),
    ).toHaveValue('2');

    await customerPage.getByRole('link', { name: 'History' }).click();
    await expect(customerPage.getByRole('heading', { level: 1 })).toHaveText('Revision history');
    await expect(customerPage.getByRole('table')).toContainText('Published content revision 1');
    await expect(customerPage.getByRole('table')).toContainText('Failed');
    await expect(customerPage.getByRole('button', { name: 'Restore revision 1' })).toBeVisible();
    await expect(customerPage.locator('form[action="/history/2/restore"]')).toHaveCount(0);
    await expect(
      customerPage.locator('form[action="/history/1/restore"] input[name="idempotencyKey"]'),
    ).toHaveValue(/^[0-9a-f-]{36}$/u);

    const customerOrap = await customerPage.goto(`${customerBase}/orap/sites`);
    expect(customerOrap?.status()).toBe(403);
    await expect(customerPage.getByRole('heading', { level: 1 })).toHaveText('Access denied');

    await customerPage.goto(`${customerBase}/auth/recovery`);
    await expect(customerPage.getByRole('heading', { level: 1 })).toHaveText('Recover access');
    await expect(customerPage.getByRole('button', { name: 'Send recovery link' })).toBeVisible();
    await expect(customerPage.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');

    await customerPage.goto(`${customerBase}/auth/invitations/accept?token=${'A'.repeat(43)}`);
    await expect(customerPage.getByRole('heading', { level: 1 })).toHaveText(
      'Accept your invitation',
    );
    await expect(customerPage.locator('input[name="token"]')).toHaveValue('A'.repeat(43));

    const staffPage = await staffContext.newPage();
    await staffPage.goto(staffBase);
    await expect(staffPage).toHaveURL(`${staffBase}/orap`);
    await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText('Overview');
    await expect(staffPage.getByText('Fictional worker unavailable')).toBeVisible();
    await staffPage.getByRole('link', { exact: true, name: 'Customer sites' }).click();
    await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText('Customer sites');
    await expect(staffPage.getByRole('table')).toContainText('Fictional Group');
    await expect(staffPage.getByRole('link', { name: 'Skip to content' })).toBeVisible();
    await expect(staffPage.locator('html')).toHaveCSS('background-color', 'rgb(246, 247, 250)');
    await expect(staffPage.getByRole('link', { name: 'Users' })).toHaveCount(0);
    await expect(staffPage.getByRole('link', { name: 'Audit' })).toHaveCount(0);
    for (const width of [360, 768, 1024, 1440]) {
      await staffPage.setViewportSize({ height: 900, width });
      const dimensions = await staffPage.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((element) => element.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 8)
          .map((element) => ({
            className: element.className,
            right: Math.round(element.getBoundingClientRect().right),
            tag: element.tagName,
          })),
      }));
      expect(
        dimensions.documentWidth,
        `document width at ${width}px viewport; offenders=${JSON.stringify(dimensions.offenders)}`,
      ).toBeLessThanOrEqual(width);
    }

    await staffPage.getByRole('link', { name: 'Team & access' }).click();
    await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText('Team & access');
    await expect(staffPage.getByText('You are signed in as a Platform Owner.')).toBeVisible();
    await staffPage.getByRole('link', { name: 'Invite staff' }).click();
    await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText('Invite staff');
    await expect(staffPage.getByRole('button', { name: 'Send invitation' })).toBeVisible();
    await staffPage.getByRole('link', { name: 'Back to team' }).click();
    await expect(staffPage.getByRole('table')).toContainText('Fictional Owner');
    const employeeRow = staffPage.getByRole('row').filter({ hasText: 'Fictional Employee' });
    await employeeRow.getByRole('link', { name: 'Open' }).click();
    await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText('Fictional Employee');
    await expect(staffPage.getByRole('heading', { name: 'Edit account' })).toBeVisible();
    await expect(staffPage.getByLabel('Name')).toHaveValue('Fictional Employee');
    await expect(staffPage.getByLabel('Email')).toHaveValue('employee@example.test');
    await expect(staffPage.getByLabel('New password', { exact: true })).toHaveValue('');
    await expect(staffPage.getByText('Current passwords', { exact: false })).toBeVisible();
    await expect(staffPage.getByLabel('Staff role')).toHaveValue('operations-manager');
    await expect(staffPage.getByRole('button', { name: 'Update authority' })).toBeVisible();

    const resetStaff = staffPage.locator(
      'form[action="/orap/security/staff/40000000-0000-4000-8000-000000000012/reset"]',
    );
    await resetStaff.getByLabel('Audit reason').fill('Approved fictional recovery request');
    await resetStaff.getByRole('button', { name: 'Send reset instructions' }).click();
    await expect(staffPage.getByRole('status')).toContainText('reset instructions were requested');

    const revokeStaff = staffPage.locator(
      'form[action="/orap/security/staff/40000000-0000-4000-8000-000000000012/sessions/revoke-all"]',
    );
    await revokeStaff.getByLabel('Audit reason').fill('Approved fictional session revocation');
    await revokeStaff.getByRole('button', { name: 'Revoke all sessions' }).click();
    await expect(staffPage.getByRole('status')).toContainText('sessions were revoked');

    const disableStaff = staffPage.locator(
      'form[action="/orap/security/staff/40000000-0000-4000-8000-000000000012/disable"]',
    );
    await disableStaff.getByLabel('Audit reason').fill('Approved fictional staff departure');
    await disableStaff.getByRole('button', { name: 'Disable staff access' }).click();
    await expect(staffPage.getByRole('status')).toContainText('Staff access was disabled');

    await staffPage.getByRole('link', { exact: true, name: 'Customer sites' }).click();

    await staffPage.getByRole('link', { name: 'Add customer site' }).click();
    await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText('Add customer site');
    await staffPage.getByLabel('Customer or organization').fill('Fictional Group Two');
    await staffPage.getByLabel('Site name').fill('Fictional Beta');
    await staffPage.getByLabel('Repository source path').fill('sites/fictional-beta');
    await staffPage.getByLabel('Audit reason').fill('Approved fictional browser test');
    await staffPage.getByRole('button', { name: 'Create site record' }).click();
    await expect(staffPage).toHaveURL(/\/orap\/sites\?notice=created$/u);
    await expect(staffPage.getByRole('status')).toContainText('Site record created');

    await staffPage.getByRole('link', { name: 'Open site' }).click();
    await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText('Fictional Alpha');
    await expect(staffPage.getByText(customer.siteId, { exact: true })).toBeVisible();

    await staffPage.getByRole('link', { name: 'Jobs & alerts' }).click();
    await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText('Operations');
    await expect(
      staffPage.getByText('Fictional worker unavailable', { exact: false }),
    ).toBeVisible();
    await expect(staffPage.getByText('$50.00 USD', { exact: true })).toBeVisible();
    await expect(staffPage.getByRole('button', { name: 'Acknowledge' })).toBeVisible();
    await expect(staffPage.getByRole('button', { name: 'Resolve' })).toBeVisible();
    await expect(staffPage.getByRole('button', { name: 'Replay job' })).toBeVisible();
    await expect(staffPage.getByRole('button', { name: 'Cancel job' })).toBeVisible();

    const acknowledge = staffPage.locator(
      'form[action="/orap/operations/alerts/80000000-0000-4000-8000-000000000001/acknowledge"]',
    );
    await acknowledge.getByLabel('Reason').fill('Owner reviewed the fictional incident');
    await acknowledge.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(staffPage).toHaveURL(/\/orap\/operations\?notice=updated$/u);

    const resolve = staffPage.locator(
      'form[action="/orap/operations/alerts/80000000-0000-4000-8000-000000000001/resolve"]',
    );
    await resolve.getByLabel('Resolution').fill('Fictional incident resolved after verification');
    await resolve.getByRole('button', { name: 'Resolve' }).click();
    await expect(staffPage).toHaveURL(/\/orap\/operations\?notice=updated$/u);

    const cancel = staffPage.locator(
      'form[action="/orap/operations/jobs/70000000-0000-4000-8000-000000000002/cancel"]',
    );
    await cancel.getByLabel('Reason').fill('Fictional queued job is no longer required');
    await cancel.getByRole('button', { name: 'Cancel job' }).click();
    await expect(staffPage).toHaveURL(/\/orap\/operations\?notice=updated$/u);

    const replay = staffPage.locator(
      'form[action="/orap/operations/jobs/70000000-0000-4000-8000-000000000001/replay"]',
    );
    await replay.getByLabel('Reason').fill('Approved browser replay test');
    await replay.getByRole('button', { name: 'Replay job' }).click();
    await expect(staffPage).toHaveURL(/\/orap\/operations\?notice=updated$/u);
    await expect(staffPage.getByRole('status')).toContainText('operational record was updated');

    const sister = await staffPage.goto(`http://admin.sister.localhost:${address.port}/orap/sites`);
    expect(sister?.status()).toBe(403);
  } finally {
    await customerContext.close();
    await staffContext.close();
    await server.close();
  }
});
