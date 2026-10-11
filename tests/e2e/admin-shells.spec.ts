import { buildApiServer, type CustomerPrincipal } from '@omnireach/api';
import type { AdminActor } from '@omnireach/tenant';
import { expect, test } from '@playwright/test';

const staff: AdminActor = {
  id: '40000000-0000-4000-8000-000000000010',
  role: 'staff',
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
      drafts: async () => [],
      fieldUpdate: async () => ({}),
      history: async () => [],
      pages: async () => [],
      preview: async () => ({ previewToken: 'preview' }),
      previewFile: async () => ({ body: new Uint8Array(), contentType: 'text/html' }),
      publish: async () => ({}),
      restore: async () => ({}),
      updateContactForm: async () => ({}),
    },
    logLevel: 'silent',
    orapService: {
      assignPlan: async () => ({}),
      cancelJob: async () => ({}),
      changeCustomerRole: async () => ({}),
      createPlan: async () => ({}),
      createTenantAndSite: async () => ({}),
      disableCustomer: async () => ({}),
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
      requestCustomerReset: async () => ({}),
      replayJob: async () => ({}),
      setContactForm: async () => ({}),
      setContactSubmissionHold: async () => ({}),
      setEmergencyControls: async () => ({}),
      setFeatureOverride: async () => ({}),
      setPlatformAiBudget: async () => ({}),
      setQuotaOverride: async () => ({}),
      setSiteAiBudget: async () => ({}),
      setSubscriptionState: async () => ({}),
    },
    resolveCustomerPrincipal: async (request) =>
      request.hostname === 'admin.alpha.localhost' &&
      request.headers.cookie?.includes('customer-session')
        ? customer
        : undefined,
    resolvePlatformActor: async (request) =>
      request.hostname === 'admin.omnireach.localhost' &&
      request.headers.cookie?.includes('staff-session')
        ? staff
        : undefined,
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
    await staffPage.goto(`${staffBase}/orap/sites`);
    await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText('Customer sites');
    await expect(staffPage.getByRole('table')).toContainText('Fictional Group');
    await expect(staffPage.getByRole('link', { name: 'Skip to content' })).toBeVisible();

    await staffPage.goto(`${staffBase}/orap/operations`);
    await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText('Operations');
    await expect(
      staffPage.getByText('Fictional worker unavailable', { exact: false }),
    ).toBeVisible();
    await expect(staffPage.getByText('$50.00 USD', { exact: true })).toBeVisible();
    await expect(staffPage.getByRole('button', { name: 'Acknowledge' })).toBeVisible();
    await expect(staffPage.getByRole('button', { name: 'Resolve' })).toBeVisible();
    await expect(staffPage.getByRole('button', { name: 'Replay job' })).toBeVisible();

    const sister = await staffPage.goto(`http://admin.sister.localhost:${address.port}/orap/sites`);
    expect(sister?.status()).toBe(403);
  } finally {
    await customerContext.close();
    await staffContext.close();
    await server.close();
  }
});
