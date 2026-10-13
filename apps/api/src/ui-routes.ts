import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  adminStylesheet,
  renderCustomerDashboard,
  renderOperationsCenter,
  renderOrapDashboard,
  renderOrapNotFound,
  renderOrapOverview,
  renderOrapShell,
  renderOrapSiteDetails,
  renderOrapSiteForm,
  renderOrapStaffDirectory,
  renderOrapStaffDetails,
  renderOrapStaffInviteForm,
  type AlertRow,
  type BudgetView,
  type JobRow,
  type OrapNavigationItem,
  type OrapSiteManagementModel,
  type OrapSiteSummary,
  type OrapStaffSummary,
  type OrapStaffRoleOption,
} from '@omnireach/ui';
import { canOrap, isPlatformOwnerIdentity } from '@omnireach/auth';
import type { AdminActor } from '@omnireach/tenant';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AuthEndpointService } from './auth-routes.ts';
import { clientNetworkIdentifier } from './client-network.ts';
import type { CustomerEndpointService, ResolveCustomerPrincipal } from './customer-routes.ts';
import {
  googleOAuthCallbackCookieName,
  googleOAuthCallbackCookieOptions,
  type IntegrationEndpointService,
} from './integration-routes.ts';
import type { OrapAdministrationEndpointService, ResolvePlatformActor } from './orap-routes.ts';
import { registerCustomerUiRoutes } from './customer-ui-routes.ts';
import { readCookie } from './request-auth.ts';
import { requireSameOrigin } from './request-security.ts';
import {
  webAuthnAuthenticationBrowserScript,
  webAuthnEnrollmentBrowserScript,
} from './webauthn-browser.ts';

const omnireachLogo = readFileSync(
  resolve(import.meta.dirname, '../../../sites/omnireach/public/omnireach-logo.png'),
);

export function registerUiRoutes(
  server: FastifyInstance,
  options: {
    authService?: AuthEndpointService;
    customerService?: CustomerEndpointService;
    integrationService?: IntegrationEndpointService;
    orapService?: OrapAdministrationEndpointService;
    resolveCustomerPrincipal?: ResolveCustomerPrincipal;
    resolvePlatformActor?: ResolvePlatformActor;
  },
): void {
  server.get('/assets/admin.css', async (_request, reply) =>
    reply
      .type('text/css; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .send(adminStylesheet),
  );
  server.get('/assets/omnireach-logo.png', async (_request, reply) =>
    reply
      .type('image/png')
      .header('Cache-Control', 'public, max-age=86400, immutable')
      .send(omnireachLogo),
  );
  server.get<{ Querystring: { error?: string; security?: string } }>(
    '/login',
    async (request, reply) =>
      reply
        .type('text/html; charset=utf-8')
        .send(renderLogin(request.hostname, request.query?.error, request.query?.security)),
  );
  server.get<{ Querystring: { email?: string; passkey?: string } }>(
    '/mfa',
    async (request, reply) =>
      reply
        .type('text/html; charset=utf-8')
        .send(
          renderMfa(
            readCookie(request, '__Host-omnireach_challenge') ?? '',
            request.query?.email === '1',
            request.query?.passkey === '1',
          ),
        ),
  );
  server.get('/mfa/passkey.js', async (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(webAuthnAuthenticationBrowserScript),
  );
  server.get<{ Querystring: { token?: string } }>(
    '/auth/invitations/accept',
    async (request, reply) =>
      reply.type('text/html; charset=utf-8').send(renderInvitation(request.query?.token ?? '')),
  );
  server.get<{ Querystring: { token?: string } }>('/auth/recovery', async (request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(
        request.query?.token
          ? renderRecoveryCompletion(request.query.token)
          : renderRecoveryRequest(),
      ),
  );

  if (options.authService?.securitySettings) {
    if (
      options.authService.prepareWebAuthnEnrollment &&
      options.authService.completeWebAuthnEnrollment
    ) {
      server.get('/security/passkey.js', async (_request, reply) =>
        reply
          .type('application/javascript; charset=utf-8')
          .header('Cache-Control', 'no-store')
          .send(webAuthnEnrollmentBrowserScript),
      );
    }
    server.get('/security', async (request, reply) => {
      const currentToken = readCookie(request, '__Host-omnireach_session');
      const [settings, sessions] = await Promise.all([
        options.authService?.securitySettings?.(currentToken, request.hostname),
        options.authService?.listSessions(currentToken, request.hostname) ?? [],
      ]);
      if (!settings) return reply.code(303).redirect('/login');
      const platformActor = await options.resolvePlatformActor?.(request);
      const platformView = platformActor !== undefined;
      if (settings.webauthnEnrollmentAvailable) {
        reply.header(
          'Content-Security-Policy',
          "default-src 'none'; img-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        );
      }
      return reply
        .type('text/html; charset=utf-8')
        .send(
          renderSecuritySettings(
            settings,
            platformView,
            platformActor ? orapNavigation(platformActor) : undefined,
            sessions,
          ),
        );
    });
    server.get<{ Querystring: { action?: string } }>('/security/email', async (request, reply) => {
      const settings = await options.authService?.securitySettings?.(
        readCookie(request, '__Host-omnireach_session'),
        request.hostname,
      );
      if (!settings) return reply.code(303).redirect('/login');
      const action = request.query?.action === 'disable' ? 'disable' : 'enable';
      return reply
        .type('text/html; charset=utf-8')
        .send(
          renderEmailPolicyVerification(
            readCookie(request, '__Host-omnireach_challenge') ?? '',
            action,
          ),
        );
    });
  }

  if (options.authService?.completeCustomerRecovery) {
    server.get('/security/recovery', async (request, reply) => {
      if (!readCookie(request, '__Host-omnireach_session')) {
        return reply.code(303).redirect('/login');
      }
      return reply.type('text/html; charset=utf-8').send(renderRestrictedRecovery());
    });
  }

  if (options.orapService && options.resolvePlatformActor) {
    server.get('/orap', async (request, reply) => {
      const actor = await options.resolvePlatformActor?.(request);
      if (!actor || !canOrap(actor, 'dashboard.view')) {
        return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
      }
      const sites = canOrap(actor, 'websites.list')
        ? parseSiteSummaries(await options.orapService?.listSites(actor))
        : [];
      const operations = options.orapService?.listOperations
        ? parseOperationsModel(await options.orapService.listOperations(actor))
        : { alerts: [], budget: null, jobs: [] };
      return reply
        .type('text/html; charset=utf-8')
        .send(
          renderOrapOverview(
            { ...operations, sites },
            canOrap(actor, 'customers.create') && canOrap(actor, 'websites.create'),
            orapNavigation(actor),
          ),
        );
    });

    server.get<{ Querystring: { notice?: string } }>('/orap/sites', async (request, reply) => {
      const actor = await options.resolvePlatformActor?.(request);
      if (!actor || !canOrap(actor, 'websites.list')) {
        return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
      }
      const sites = parseSiteSummaries(await options.orapService?.listSites(actor));
      return reply
        .type('text/html; charset=utf-8')
        .send(
          renderOrapDashboard(
            sites,
            siteNotice(request.query.notice),
            canOrap(actor, 'customers.create') && canOrap(actor, 'websites.create'),
            orapNavigation(actor),
          ),
        );
    });

    server.get<{ Querystring: { notice?: string } }>(
      '/orap/security/staff',
      async (request, reply) => {
        const actor = await options.resolvePlatformActor?.(request);
        if (!actor || !isPlatformOwnerIdentity(actor)) {
          return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
        }
        if (!options.orapService?.listStaff) {
          return reply.code(404).type('text/html; charset=utf-8').send(renderOrapNotFound());
        }
        const staff = parseStaffSummaries(await options.orapService.listStaff(actor));
        return reply
          .type('text/html; charset=utf-8')
          .send(
            renderOrapStaffDirectory(
              staff,
              orapNavigation(actor),
              staffNotice(request.query.notice),
            ),
          );
      },
    );

    server.get('/orap/security/staff/invite', async (request, reply) => {
      const actor = await options.resolvePlatformActor?.(request);
      if (!actor || !isPlatformOwnerIdentity(actor)) {
        return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
      }
      if (!options.orapService?.listStaffRoles) {
        return reply.code(404).type('text/html; charset=utf-8').send(renderOrapNotFound());
      }
      const roles = parseStaffRoles(await options.orapService.listStaffRoles(actor));
      return reply
        .type('text/html; charset=utf-8')
        .send(renderOrapStaffInviteForm(roles, undefined, orapNavigation(actor)));
    });

    server.post<{ Body: unknown }>(
      '/orap/security/staff/invite',
      { preHandler: requireSameOrigin },
      async (request, reply) => {
        const actor = await options.resolvePlatformActor?.(request);
        if (!actor || !isPlatformOwnerIdentity(actor)) {
          return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
        }
        const roles = parseStaffRoles((await options.orapService?.listStaffRoles?.(actor)) ?? []);
        const body = staffInvitationInput.safeParse(request.body);
        if (!body.success || !options.orapService?.inviteStaff) {
          return reply
            .code(400)
            .type('text/html; charset=utf-8')
            .send(
              renderOrapStaffInviteForm(
                roles,
                'Check every field and try again.',
                orapNavigation(actor),
              ),
            );
        }
        try {
          await options.orapService.inviteStaff(actor, {
            displayName: body.data.displayName,
            email: body.data.email,
            host: request.hostname,
            ...(body.data.jobTitle ? { jobTitle: body.data.jobTitle } : {}),
            reason: staffUiAuditReason.invite,
            roleSlug: body.data.roleSlug,
          });
          return reply.code(303).redirect('/orap/security/staff?notice=invited');
        } catch (error) {
          request.log.error({ error }, 'ORAP staff invitation failed');
          return reply
            .code(400)
            .type('text/html; charset=utf-8')
            .send(
              renderOrapStaffInviteForm(
                roles,
                'The invitation could not be sent. Confirm the address and role, then try again.',
                orapNavigation(actor),
              ),
            );
        }
      },
    );

    server.get<{
      Params: { userId: string };
      Querystring: { notice?: string };
    }>('/orap/security/staff/:userId', async (request, reply) => {
      const actor = await options.resolvePlatformActor?.(request);
      if (!actor || !isPlatformOwnerIdentity(actor)) {
        return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
      }
      if (!options.orapService?.listStaff) {
        return reply.code(404).type('text/html; charset=utf-8').send(renderOrapNotFound());
      }
      const staff = parseStaffSummaries(await options.orapService.listStaff(actor));
      const roles = parseStaffRoles((await options.orapService.listStaffRoles?.(actor)) ?? []);
      const member = staff.find(({ userId }) => userId === request.params.userId);
      if (!member) {
        return reply
          .code(404)
          .type('text/html; charset=utf-8')
          .send(renderOrapNotFound(orapNavigation(actor)));
      }
      const notice = staffNotice(request.query.notice);
      return reply.type('text/html; charset=utf-8').send(
        renderOrapStaffDetails(
          member,
          {
            currentUserId: actor.id,
            roles,
            ...(notice ? { notice } : {}),
          },
          orapNavigation(actor),
        ),
      );
    });

    registerOrapStaffForms(server, options);

    server.get('/orap/sites/new', async (request, reply) => {
      const actor = await options.resolvePlatformActor?.(request);
      if (!actor || !canOrap(actor, 'customers.create') || !canOrap(actor, 'websites.create')) {
        return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
      }
      return reply
        .type('text/html; charset=utf-8')
        .send(renderOrapSiteForm(undefined, orapNavigation(actor)));
    });

    server.post<{ Body: unknown }>(
      '/orap/sites',
      { preHandler: requireSameOrigin },
      async (request, reply) => {
        const actor = await options.resolvePlatformActor?.(request);
        if (!actor || !canOrap(actor, 'customers.create') || !canOrap(actor, 'websites.create')) {
          return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
        }
        const parsed = siteCreationInput.safeParse(request.body);
        if (!parsed.success) {
          return reply
            .code(400)
            .type('text/html; charset=utf-8')
            .send(
              renderOrapSiteForm(
                'Check every field and use a repository path such as sites/customer-name.',
                orapNavigation(actor),
              ),
            );
        }
        try {
          await options.orapService?.createTenantAndSite(actor, parsed.data);
          return reply.code(303).redirect('/orap/sites?notice=created');
        } catch (error) {
          request.log.error({ error }, 'ORAP site creation failed');
          return reply
            .code(500)
            .type('text/html; charset=utf-8')
            .send(
              renderOrapSiteForm(
                'The site record could not be created. No DNS or deployment changes were made.',
                orapNavigation(actor),
              ),
            );
        }
      },
    );

    server.get<{ Params: { siteIdentifier: string } }>(
      '/orap/sites/:siteIdentifier',
      async (request, reply) => {
        const actor = await options.resolvePlatformActor?.(request);
        if (!actor || !canOrap(actor, 'websites.list')) {
          return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
        }
        const sites = parseSiteSummaries(await options.orapService?.listSites(actor));
        const site = sites.find(
          (entry) =>
            entry.id === request.params.siteIdentifier ||
            entry.name === request.params.siteIdentifier,
        );
        if (
          site &&
          site.id &&
          site.tenantId &&
          canOrap(actor, 'websites.view', {
            siteId: site.id,
            tenantId: site.tenantId,
          })
        ) {
          const management = options.orapService?.siteManagement
            ? parseSiteManagement(
                await options.orapService.siteManagement(actor, {
                  siteId: site.id,
                  tenantId: site.tenantId,
                }),
              )
            : undefined;
          return reply.type('text/html; charset=utf-8').send(
            renderOrapSiteDetails(site, orapNavigation(actor), management, {
              canEditAutomation: canOrap(actor, 'automation.emergency_controls.manage', {
                siteId: site.id,
                tenantId: site.tenantId,
              }),
              canEditBudget: canOrap(actor, 'ai_budget.site.edit', {
                siteId: site.id,
                tenantId: site.tenantId,
              }),
              canEditSubscription: canOrap(actor, 'subscriptions.edit', {
                siteId: site.id,
                tenantId: site.tenantId,
              }),
              canManageGoogle: Boolean(
                options.integrationService &&
                canOrap(actor, 'integrations.google.manage', {
                  siteId: site.id,
                  tenantId: site.tenantId,
                }),
              ),
            }),
          );
        }
        return reply
          .code(404)
          .type('text/html; charset=utf-8')
          .send(renderOrapNotFound(orapNavigation(actor)));
      },
    );

    server.post<{ Params: { siteIdentifier: string }; Body: unknown }>(
      '/orap/sites/:siteIdentifier/integrations/google/start',
      { preHandler: requireSameOrigin },
      async (request, reply) => {
        const actor = await options.resolvePlatformActor?.(request);
        const body = z
          .object({ propertyKind: z.enum(['ga4', 'search_console']) })
          .safeParse(request.body);
        if (!actor || !body.success || !options.integrationService) {
          return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
        }
        if (
          !canOrap(actor, 'integrations.google.manage', {
            siteId: request.params.siteIdentifier,
          })
        ) {
          return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
        }
        const result = await options.integrationService.startGoogle(actor, {
          propertyKind: body.data.propertyKind,
          redirectUri: `https://${request.hostname}/v1/orap/integrations/google/callback`,
          siteId: request.params.siteIdentifier,
        });
        const authorizationUrl = parseGoogleAuthorizationUrl(result);
        if (!authorizationUrl) {
          request.log.error('Google authorization service returned an invalid redirect URL');
          return reply.code(503).send({ error: 'integration_unavailable' });
        }
        const sessionToken = readCookie(request, '__Host-omnireach_session');
        if (!sessionToken) {
          return reply.code(401).send({ error: 'authentication_required' });
        }
        return reply
          .setCookie(googleOAuthCallbackCookieName, sessionToken, googleOAuthCallbackCookieOptions)
          .code(303)
          .redirect(authorizationUrl);
      },
    );

    server.post<{ Params: { siteIdentifier: string }; Body: unknown }>(
      '/orap/sites/:siteIdentifier/integrations/google/select',
      { preHandler: requireSameOrigin },
      async (request, reply) => {
        const actor = await options.resolvePlatformActor?.(request);
        const body = z
          .object({
            pendingSelectionId: z.string().uuid(),
            propertyId: z.string().min(1).max(300),
            propertyKind: z.enum(['ga4', 'search_console']),
          })
          .safeParse(request.body);
        if (
          !actor ||
          !body.success ||
          !options.integrationService?.selectGoogleProperty ||
          !canOrap(actor, 'integrations.google.manage', {
            siteId: request.params.siteIdentifier,
          })
        ) {
          return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
        }
        await options.integrationService.selectGoogleProperty(actor, {
          ...body.data,
          siteId: request.params.siteIdentifier,
        });
        return reply
          .code(303)
          .redirect(
            `/orap/sites/${encodeURIComponent(request.params.siteIdentifier)}?notice=google-connected`,
          );
      },
    );

    server.post<{ Params: { siteIdentifier: string }; Body: unknown }>(
      '/orap/sites/:siteIdentifier/plan',
      { preHandler: requireSameOrigin },
      async (request, reply) => {
        const actor = await options.resolvePlatformActor?.(request);
        const body = z
          .object({
            planId: z.string().uuid(),
            reason: z.string().trim().min(3).max(500),
            tenantId: z.string().uuid(),
          })
          .safeParse(request.body);
        if (!actor || !body.success) {
          return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
        }
        if (
          !canOrap(actor, 'subscriptions.edit', {
            siteId: request.params.siteIdentifier,
            tenantId: body.data.tenantId,
          })
        ) {
          return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
        }
        await options.orapService?.assignPlan(actor, {
          ...body.data,
          siteId: request.params.siteIdentifier,
        });
        return reply
          .code(303)
          .redirect(`/orap/sites/${encodeURIComponent(request.params.siteIdentifier)}`);
      },
    );

    server.post<{ Params: { siteIdentifier: string }; Body: unknown }>(
      '/orap/sites/:siteIdentifier/subscription',
      { preHandler: requireSameOrigin },
      async (request, reply) => {
        const actor = await options.resolvePlatformActor?.(request);
        const body = z
          .object({
            reason: z.string().trim().min(3).max(500),
            status: z.enum(['active', 'cancelled', 'past_due']),
            tenantId: z.string().uuid(),
          })
          .safeParse(request.body);
        if (!actor || !body.success) {
          return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
        }
        if (
          !canOrap(actor, 'subscriptions.edit', {
            siteId: request.params.siteIdentifier,
            tenantId: body.data.tenantId,
          })
        ) {
          return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
        }
        await options.orapService?.setSubscriptionState(actor, {
          ...body.data,
          siteId: request.params.siteIdentifier,
        });
        return reply
          .code(303)
          .redirect(`/orap/sites/${encodeURIComponent(request.params.siteIdentifier)}`);
      },
    );

    server.post<{ Params: { siteIdentifier: string }; Body: unknown }>(
      '/orap/sites/:siteIdentifier/emergency',
      { preHandler: requireSameOrigin },
      async (request, reply) => {
        const actor = await options.resolvePlatformActor?.(request);
        const body = z
          .object({
            autonomousChangesStopped: z.union([z.literal('true'), z.undefined()]),
            automationStopped: z.union([z.literal('true'), z.undefined()]),
            editingFrozen: z.union([z.literal('true'), z.undefined()]),
            policyVersion: z.coerce.number().int().positive(),
            reason: z.string().trim().min(3).max(500),
            tenantId: z.string().uuid(),
          })
          .safeParse(request.body);
        if (!actor || !body.success) {
          return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
        }
        if (
          !canOrap(actor, 'automation.emergency_controls.manage', {
            siteId: request.params.siteIdentifier,
            tenantId: body.data.tenantId,
          })
        ) {
          return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
        }
        await options.orapService?.setEmergencyControls(actor, {
          autonomousChangesStopped: body.data.autonomousChangesStopped === 'true',
          automationStopped: body.data.automationStopped === 'true',
          editingFrozen: body.data.editingFrozen === 'true',
          policyVersion: body.data.policyVersion,
          reason: body.data.reason,
          siteId: request.params.siteIdentifier,
          tenantId: body.data.tenantId,
        });
        return reply
          .code(303)
          .redirect(`/orap/sites/${encodeURIComponent(request.params.siteIdentifier)}`);
      },
    );

    server.post<{ Params: { siteIdentifier: string }; Body: unknown }>(
      '/orap/sites/:siteIdentifier/ai-budget',
      { preHandler: requireSameOrigin },
      async (request, reply) => {
        const actor = await options.resolvePlatformActor?.(request);
        const body = z
          .object({
            budgetUsd: z.coerce.number().min(0).max(10_000),
            policyVersion: z.coerce.number().int().positive(),
            reason: z.string().trim().min(3).max(500),
            tenantId: z.string().uuid(),
          })
          .safeParse(request.body);
        if (!actor || !body.success) {
          return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
        }
        if (
          !canOrap(actor, 'ai_budget.site.edit', {
            siteId: request.params.siteIdentifier,
            tenantId: body.data.tenantId,
          })
        ) {
          return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
        }
        await options.orapService?.setSiteAiBudget(actor, {
          capUsdMicros: Math.round(body.data.budgetUsd * 1_000_000),
          policyVersion: body.data.policyVersion,
          reason: body.data.reason,
          siteId: request.params.siteIdentifier,
          tenantId: body.data.tenantId,
        });
        return reply
          .code(303)
          .redirect(`/orap/sites/${encodeURIComponent(request.params.siteIdentifier)}`);
      },
    );

    server.get<{ Querystring: { notice?: string } }>('/orap/operations', async (request, reply) => {
      const actor = await options.resolvePlatformActor?.(request);
      if (!actor || !canOrap(actor, 'dashboard.view')) {
        return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
      }
      if (!options.orapService?.listOperations) return reply.code(404).send();
      const model = parseOperationsModel(await options.orapService.listOperations(actor));
      const notice = operationNotice(request.query.notice);
      return reply.type('text/html; charset=utf-8').send(
        renderOrapShell({
          content: renderOperationsCenter({
            ...model,
            canAcknowledgeAlerts: canOrap(actor, 'alerts.acknowledge'),
            canCancelJobs: canOrap(actor, 'automation.jobs.cancel'),
            canReplayJobs: canOrap(actor, 'automation.jobs.replay'),
            canResolveAlerts: canOrap(actor, 'alerts.resolve'),
          }),
          current: 'operations',
          eyebrow: 'Platform health',
          heading: 'Operations',
          navigation: orapNavigation(actor),
          ...(notice ? { notice } : {}),
          title: 'Operations',
        }),
      );
    });

    registerOrapOperationForms(server, options);
  }

  if (options.customerService && options.resolveCustomerPrincipal) {
    registerCustomerUiRoutes(server, options.customerService, options.resolveCustomerPrincipal);
  }

  server.get('/', async (request, reply) => {
    const platformActor = await options.resolvePlatformActor?.(request);
    if (platformActor) {
      return reply.code(303).redirect(orapLandingPage(platformActor));
    }

    const principal = await options.resolveCustomerPrincipal?.(request);
    if (!principal || !options.customerService) return reply.code(303).redirect('/login');
    const raw = await options.customerService.dashboard(principal);
    if (!isRecord(raw) || !isRecord(raw.site)) throw new Error('Dashboard model is unavailable');
    const controls = isRecord(raw.controls) ? raw.controls : {};
    const publication = isRecord(raw.publication) ? raw.publication : {};
    const integration = isRecord(raw.integrations) ? raw.integrations : {};
    const artifact = stringValue(publication.artifactHash);
    return reply.type('text/html; charset=utf-8').send(
      renderCustomerDashboard({
        features: [
          {
            enabled: controls.editingFrozen !== true,
            label: 'Content editing',
            reason: controls.editingFrozen === true ? 'Temporarily frozen' : 'Available by policy',
          },
          {
            enabled: controls.automationStopped !== true,
            label: 'Automation',
            reason:
              controls.automationStopped === true ? 'Temporarily stopped' : 'Available by policy',
          },
        ],
        integrations: [
          {
            label: 'Analytics',
            status: integration.status === 'connected' ? 'connected' : 'not-connected',
          },
        ],
        publication:
          publication.status === 'active'
            ? {
                ...(artifact ? { artifact } : {}),
                status: 'healthy',
              }
            : { status: 'never-published' },
        siteName: stringValue(raw.site.name) ?? 'Customer site',
      }),
    );
  });
}

function renderLogin(hostname: string, error?: string, security?: string): string {
  const errorNotice =
    error === 'credentials'
      ? '<div class="notice error" role="alert">The email address or password was not accepted. Check your details and try again.</div>'
      : '';
  const securityNotice =
    security === 'updated'
      ? '<div class="notice" role="status">Your security settings were updated. Sign in again to continue.</div>'
      : '';
  return renderAuthPage({
    content: `${errorNotice}${securityNotice}<form method="post" action="/auth/login"><div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="username" required autofocus></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><button type="submit">Sign in securely</button></form><p class="auth-card-footer"><a href="/auth/recovery">Forgot your password?</a></p>`,
    description: `Continue to the secure administration workspace for ${escapeHtml(hostname)}.`,
    eyebrow: 'Staff access',
    heading: 'Welcome back',
    title: 'Sign in',
  });
}

function renderMfa(
  challengeId: string,
  emailAvailable: boolean,
  passkeyAvailable: boolean,
): string {
  const resend = emailAvailable
    ? `<form method="post" action="/auth/mfa/email/resend"><input name="challengeId" type="hidden" value="${escapeHtml(challengeId)}"><button class="secondary" type="submit">Send a new email code</button></form>`
    : '';
  const passkey = passkeyAvailable
    ? `<input id="webauthn-challenge-id" type="hidden" value="${escapeHtml(challengeId)}"><button class="secondary" id="passkey-sign-in" type="button">Use a passkey</button><p id="passkey-sign-in-status" role="status" aria-live="polite"></p><script src="/mfa/passkey.js" defer></script>`
    : '';
  return renderAuthPage({
    content: `<form method="post" action="/auth/mfa/verify"><input name="challengeId" type="hidden" value="${escapeHtml(challengeId)}"><div class="field"><label for="code">Verification or recovery code</label><input id="code" name="code" autocomplete="one-time-code" inputmode="numeric" required${passkeyAvailable ? '' : ' autofocus'}></div><button type="submit">Verify and continue</button></form>${passkey}${resend}`,
    description:
      'Enter your 8-digit email code, 6-digit authenticator code, or alphanumeric recovery code.',
    eyebrow: 'Two-step verification',
    heading: 'Confirm it’s you',
    title: 'Verify sign in',
  });
}

function renderSecuritySettings(
  settings: {
    emailCodeEnabled: boolean;
    emailPolicyChangeAllowed: boolean;
    secondStepRequired: boolean;
    totpEnabled: boolean;
    webauthnEnrollmentAvailable: boolean;
    webauthnEnabled: boolean;
    webauthnCredentials?: {
      backedUp: boolean;
      createdAt: Date;
      deviceType: string;
      id: string;
      lastUsedAt?: Date;
      name: string;
    }[];
  },
  platformView = false,
  navigation?: readonly OrapNavigationItem[],
  rawSessions: unknown[] = [],
): string {
  const action = settings.emailCodeEnabled ? 'disable' : 'enable';
  const verb = settings.emailCodeEnabled ? 'Disable' : 'Enable';
  const emailControl = settings.emailPolicyChangeAllowed
    ? `<form method="post" action="/auth/security/email/prepare"><input name="action" type="hidden" value="${action}"><label for="currentPassword">Current password</label><input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required><button type="submit">${verb} email verification</button></form>`
    : '<p>Privileged-account verification changes require the approved stronger recovery or security procedure.</p>';
  const passkeyEnrollment = settings.webauthnEnrollmentAvailable
    ? `<form id="passkey-enrollment" novalidate><label for="credentialName">Passkey name</label><input id="credentialName" name="credentialName" maxlength="80" autocomplete="off" required><label for="passkeyCurrentPassword">Current password</label><input id="passkeyCurrentPassword" name="currentPassword" type="password" maxlength="128" autocomplete="current-password" required><button type="submit">Create passkey</button></form><section id="passkey-recovery" hidden><h3>Save replacement recovery codes</h3><p>These codes are shown once. Store them securely before completing enrollment.</p><ul id="passkey-recovery-codes"></ul><label><input id="passkey-recovery-acknowledged" type="checkbox"> I saved every recovery code.</label><button id="passkey-complete" type="button">Finish passkey enrollment</button></section><p id="passkey-status" role="status" aria-live="polite"></p><script src="/security/passkey.js" defer></script>`
    : '<p>Enrollment remains unavailable until passkey sign-in support is activated in the same release.</p>';
  const passkeyCredentials = settings.webauthnCredentials ?? [];
  const passkeyList = passkeyCredentials.length
    ? `<div class="stack">${passkeyCredentials
        .map(
          (credential) =>
            `<article class="surface-note"><h3>${escapeHtml(credential.name)}</h3><p>${escapeHtml(credential.deviceType === 'multiDevice' ? 'Synced passkey' : 'Device-bound passkey')} · Added ${escapeHtml(credential.createdAt.toISOString())}${credential.lastUsedAt ? ` · Last used ${escapeHtml(credential.lastUsedAt.toISOString())}` : ' · Not used yet'}${credential.backedUp ? ' · Backed up' : ''}</p><form method="post" action="/auth/security/webauthn/rename"><input name="credentialId" type="hidden" value="${escapeHtml(credential.id)}"><label for="passkeyName-${escapeHtml(credential.id)}">Rename passkey</label><input id="passkeyName-${escapeHtml(credential.id)}" name="name" value="${escapeHtml(credential.name)}" maxlength="80" required><label for="passkeyRenamePassword-${escapeHtml(credential.id)}">Current password</label><input id="passkeyRenamePassword-${escapeHtml(credential.id)}" name="currentPassword" type="password" maxlength="128" autocomplete="current-password" required><button class="secondary" type="submit">Save name</button></form><form method="post" action="/auth/security/webauthn/revoke"><input name="credentialId" type="hidden" value="${escapeHtml(credential.id)}"><label for="passkeyRevokePassword-${escapeHtml(credential.id)}">Current password</label><input id="passkeyRevokePassword-${escapeHtml(credential.id)}" name="currentPassword" type="password" maxlength="128" autocomplete="current-password" required><label class="checkbox-label"><input name="confirmed" type="checkbox" value="true" required><span>Revoke this passkey and sign out every session.</span></label><button class="danger" type="submit">Revoke passkey</button></form></article>`,
        )
        .join('')}</div>`
    : '<p>No passkey is enrolled.</p>';
  const totpControl = settings.emailPolicyChangeAllowed
    ? settings.totpEnabled
      ? '<p>Status: <span class="badge">enabled</span></p><form method="post" action="/auth/security/totp/disable"><label for="totpDisablePassword">Current password</label><input id="totpDisablePassword" name="currentPassword" type="password" maxlength="128" autocomplete="current-password" required><label class="checkbox-label"><input name="confirmed" type="checkbox" value="true" required><span>Disable the authenticator and replace its recovery codes.</span></label><button class="danger" type="submit">Disable authenticator app</button></form>'
      : '<p>Status: <span class="badge disabled">not enrolled</span></p><form method="post" action="/auth/security/totp/prepare"><label for="totpCurrentPassword">Current password</label><input id="totpCurrentPassword" name="currentPassword" type="password" maxlength="128" autocomplete="current-password" required><button type="submit">Set up authenticator app</button></form>'
    : '<p>Privileged staff authenticator changes use the audited owner-security procedure.</p>';
  const sessions = rawSessions.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = stringValue(value.id);
    const host = stringValue(value.host);
    const createdAt = dateValue(value.createdAt);
    const expiresAt = dateValue(value.expiresAt);
    const lastSeenAt = dateValue(value.lastSeenAt);
    if (!id || !host || !createdAt || !expiresAt || !lastSeenAt) return [];
    return [
      {
        assurance: stringValue(value.assuranceLevel) ?? 'basic',
        authenticationMethod: stringValue(value.authenticationMethod) ?? 'password',
        createdAt,
        expiresAt,
        host,
        id,
        lastSeenAt,
      },
    ];
  });
  const sessionList = sessions.length
    ? `<div class="stack">${sessions
        .map(
          (session) =>
            `<article class="surface-note"><h3>${escapeHtml(session.authenticationMethod)} session</h3><p>${escapeHtml(session.host)} · ${escapeHtml(session.assurance)} assurance · Last active ${escapeHtml(session.lastSeenAt.toISOString())} · Expires ${escapeHtml(session.expiresAt.toISOString())}</p><form method="post" action="/auth/sessions/${escapeHtml(session.id)}/revoke"><button class="danger" type="submit">Revoke session</button></form></article>`,
        )
        .join('')}</div>`
    : '<p>No active sessions were returned.</p>';
  const content = `<p class="lede">Two-step verification is <strong>${settings.secondStepRequired ? 'required' : 'optional'}</strong> for this account.</p><section class="panel"><h2>Email verification codes</h2><p>Status: <span class="badge${settings.emailCodeEnabled ? '' : ' disabled'}">${settings.emailCodeEnabled ? 'enabled' : 'disabled'}</span></p>${emailControl}</section><section class="panel"><h2>Authenticator app</h2>${totpControl}</section><section class="panel"><h2>Passkeys and Windows Hello</h2>${passkeyList}${passkeyEnrollment}</section><section class="panel"><h2>Active sessions</h2>${sessionList}</section><p class="help">Changing a verification method signs out every active session. The final strong factor cannot be removed until another allowed verification method exists.</p>`;
  if (platformView) {
    return renderOrapShell({
      content,
      current: 'security',
      eyebrow: 'Account protection',
      heading: 'Security settings',
      ...(navigation ? { navigation } : {}),
      title: 'Security settings',
    });
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><meta name="theme-color" content="#0b1820"><link rel="icon" type="image/png" href="/assets/omnireach-logo.png"><link rel="stylesheet" href="/assets/admin.css?v=orap-3"><title>Security settings | OmniReach</title></head><body><a class="skip-link" href="#main">Skip to content</a><main class="content" id="main"><div class="page-head"><div><p class="eyebrow">Account protection</p><h1>Security settings</h1></div></div>${content}<p><a class="button secondary" href="/">Return to dashboard</a></p></main></body></html>`;
}

function renderEmailPolicyVerification(challengeId: string, action: 'disable' | 'enable'): string {
  return renderAuthPage({
    content: `<form method="post" action="/auth/security/email/complete"><input name="challengeId" type="hidden" value="${escapeHtml(challengeId)}"><div class="field"><label for="code">Email verification code</label><input id="code" name="code" inputmode="numeric" pattern="[0-9]{8}" autocomplete="one-time-code" required autofocus></div><button type="submit">Confirm security change</button></form><form method="post" action="/auth/mfa/email/resend"><input name="challengeId" type="hidden" value="${escapeHtml(challengeId)}"><button class="secondary" type="submit">Send a new code</button></form>`,
    description: `Enter the 8-digit code sent to your account email to ${action} email verification.`,
    eyebrow: 'Security confirmation',
    heading: 'Verify this change',
    title: 'Verify security change',
  });
}

function renderRestrictedRecovery(): string {
  return renderAuthPage({
    content:
      '<div class="surface-note">This session is restricted. Completing recovery revokes optional verification methods, passkeys, recovery codes, and every active session.</div><form method="post" action="/auth/security/recovery/complete"><div class="field"><label for="currentPassword">Current password</label><input id="currentPassword" name="currentPassword" type="password" minlength="12" maxlength="128" autocomplete="current-password" required></div><label class="checkbox-label"><input name="recoveryConfirmed" type="checkbox" value="true" required><span>I understand that all verification methods and active sessions will be revoked.</span></label><button type="submit">Reset account security</button></form><p class="auth-card-footer">Privileged OmniReach staff recovery requires the approved audited recovery procedure.</p>',
    description: 'Review the impact carefully before resetting account security.',
    eyebrow: 'Restricted recovery',
    heading: 'Complete recovery',
    title: 'Complete account recovery',
  });
}

function renderInvitation(token: string): string {
  return renderAuthPage({
    content: `<form method="post" action="/auth/invitations/accept"><input name="token" type="hidden" value="${escapeHtml(token)}"><div class="field"><label for="displayName">Your name</label><input id="displayName" name="displayName" maxlength="160" autocomplete="name" required autofocus></div><div class="field"><label for="password">Create a password</label><input id="password" name="password" type="password" minlength="12" autocomplete="new-password" required><p class="help">Use at least 12 characters and a unique password.</p></div><button type="submit">Accept invitation</button></form>`,
    description: 'Create the secure credentials used for your OmniReach account.',
    eyebrow: 'Account invitation',
    heading: 'Accept your invitation',
    title: 'Accept invitation',
  });
}

function renderRecoveryRequest(): string {
  return renderAuthPage({
    content:
      '<form method="post" action="/auth/recovery"><div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required autofocus></div><button type="submit">Send recovery link</button></form><p class="auth-card-footer"><a href="/login">Return to sign in</a></p>',
    description:
      'If the address belongs to an active account, we will send a time-limited recovery link.',
    eyebrow: 'Account recovery',
    heading: 'Recover access',
    title: 'Recover access',
  });
}

function renderRecoveryCompletion(token: string): string {
  return renderAuthPage({
    content: `<form method="post" action="/auth/recovery/complete"><input name="token" type="hidden" value="${escapeHtml(token)}"><div class="field"><label for="newPassword">New password</label><input id="newPassword" name="newPassword" type="password" minlength="12" autocomplete="new-password" required autofocus><p class="help">Use at least 12 characters and a password you have not used here before.</p></div><button type="submit">Update password</button></form>`,
    description: 'Choose a new unique password to regain access to your account.',
    eyebrow: 'Account recovery',
    heading: 'Choose a new password',
    title: 'Choose a new password',
  });
}

function renderForbidden(): string {
  return renderAuthPage({
    content:
      '<div class="surface-note">This administration workspace is not available to the current account or session.</div><p class="auth-card-footer"><a href="/login">Return to sign in</a></p>',
    description: 'Your account does not have access to this administration host.',
    eyebrow: 'Authorization required',
    heading: 'Access denied',
    title: 'Access denied',
  });
}

function renderAuthPage(input: {
  content: string;
  description: string;
  eyebrow: string;
  heading: string;
  title: string;
}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><meta name="theme-color" content="#0b1820"><link rel="icon" type="image/png" href="/assets/omnireach-logo.png"><link rel="stylesheet" href="/assets/admin.css?v=orap-3"><title>${escapeHtml(input.title)} | OmniReach</title></head><body><a class="skip-link" href="#main">Skip to content</a><div class="auth-page"><aside class="auth-brand-panel" aria-label="OmniReach"><a class="auth-brand" href="/login"><img class="brand-mark" src="/assets/omnireach-logo.png" alt="" width="48" height="48"><span class="brand-copy"><strong>OmniReach</strong><small>Administration platform</small></span></a><div class="auth-brand-copy"><p class="eyebrow">Agency-first website operations</p><h2>Run every customer site with confidence.</h2><p>Securely manage content, automation, publishing, access, and operational health from one staff workspace.</p></div><p class="auth-meta">Protected by host-bound sessions and two-step verification.</p></aside><div class="auth-workspace"><main class="auth-card" id="main"><p class="eyebrow">${escapeHtml(input.eyebrow)}</p><h1>${escapeHtml(input.heading)}</h1><p class="lede">${input.description}</p>${input.content}</main></div></div></body></html>`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function dateValue(value: unknown): Date | undefined {
  const parsed =
    value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
}

function orapNavigation(actor: AdminActor): OrapNavigationItem[] {
  return [
    ...(canOrap(actor, 'dashboard.view') ? (['overview'] as const) : []),
    ...(canOrap(actor, 'websites.list') ? (['sites'] as const) : []),
    ...(canOrap(actor, 'dashboard.view') ? (['operations'] as const) : []),
    ...(isPlatformOwnerIdentity(actor) ? (['staff'] as const) : []),
    'security' as const,
  ];
}

function parseStaffSummaries(value: unknown): OrapStaffSummary[] {
  if (!Array.isArray(value)) throw new Error('Staff directory model is unavailable');
  return value.flatMap((entry): OrapStaffSummary[] => {
    if (!isRecord(entry)) return [];
    const activeSessions = entry.activeSessions;
    const createdAt = stringValue(entry.createdAt);
    const displayName = stringValue(entry.displayName);
    const identityKind = stringValue(entry.identityKind);
    const membershipId = stringValue(entry.membershipId);
    const normalizedEmail = stringValue(entry.normalizedEmail);
    const status = stringValue(entry.status);
    const userId = stringValue(entry.userId);
    const jobTitle = stringValue(entry.jobTitle);
    const lastLoginAt = stringValue(entry.lastLoginAt);
    const roleName = stringValue(entry.roleName);
    const roleSlug = stringValue(entry.roleSlug);
    if (
      typeof activeSessions !== 'number' ||
      !createdAt ||
      !displayName ||
      !membershipId ||
      !normalizedEmail ||
      !userId ||
      !['platform_owner', 'platform_admin', 'staff'].includes(identityKind ?? '') ||
      !['active', 'disabled', 'pending'].includes(status ?? '') ||
      typeof entry.emailCodeEnabled !== 'boolean' ||
      typeof entry.strongFactorEnrolled !== 'boolean'
    ) {
      return [];
    }
    return [
      {
        activeSessions,
        createdAt,
        displayName,
        emailCodeEnabled: entry.emailCodeEnabled,
        identityKind: identityKind as OrapStaffSummary['identityKind'],
        ...(jobTitle ? { jobTitle } : {}),
        ...(lastLoginAt ? { lastLoginAt } : {}),
        membershipId,
        normalizedEmail,
        ...(roleName ? { roleName } : {}),
        ...(roleSlug ? { roleSlug } : {}),
        status: status as OrapStaffSummary['status'],
        strongFactorEnrolled: entry.strongFactorEnrolled,
        userId,
      },
    ];
  });
}

function parseStaffRoles(value: unknown): OrapStaffRoleOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): OrapStaffRoleOption[] => {
    if (!isRecord(entry)) return [];
    const description = stringValue(entry.description);
    const name = stringValue(entry.name);
    const slug = stringValue(entry.slug);
    if (!description || !name || !slug || typeof entry.permissionCount !== 'number') return [];
    return [{ description, name, permissionCount: entry.permissionCount, slug }];
  });
}

function orapLandingPage(actor: AdminActor): string {
  if (canOrap(actor, 'dashboard.view')) return '/orap';
  if (canOrap(actor, 'websites.list')) return '/orap/sites';
  return '/security';
}

function parseOperationsModel(value: unknown): {
  alerts: AlertRow[];
  budget: BudgetView | null;
  jobs: JobRow[];
} {
  if (!isRecord(value)) {
    throw new Error('Operations model is unavailable');
  }
  const alerts = Array.isArray(value.alerts)
    ? value.alerts.flatMap((entry): AlertRow[] => {
        if (!isRecord(entry)) return [];
        const fingerprint = stringValue(entry.fingerprint);
        const id = stringValue(entry.id);
        const message = stringValue(entry.message);
        const severity = stringValue(entry.severity);
        const state = stringValue(entry.state);
        if (
          !fingerprint ||
          !message ||
          !severity ||
          !state ||
          typeof entry.occurrences !== 'number'
        ) {
          return [];
        }
        return [
          {
            fingerprint,
            ...(id ? { id } : {}),
            message,
            occurrences: entry.occurrences,
            severity,
            state,
          },
        ];
      })
    : [];
  const jobs = Array.isArray(value.jobs)
    ? value.jobs.flatMap((entry): JobRow[] => {
        if (!isRecord(entry)) return [];
        const category = stringValue(entry.category);
        const id = stringValue(entry.id);
        const state = stringValue(entry.state);
        const traceId = stringValue(entry.traceId);
        const updatedAt = stringValue(entry.updatedAt);
        return category && id && state && traceId && updatedAt
          ? [{ category, id, state, traceId, updatedAt }]
          : [];
      })
    : [];
  const budget = value.budget;
  if (budget !== null && !isRecord(budget)) {
    throw new Error('Operations budget model is unavailable');
  }
  const parsedBudget =
    budget === null
      ? null
      : typeof budget.capUsdMicros === 'number' &&
          typeof budget.reservedUsdMicros === 'number' &&
          typeof budget.usedUsdMicros === 'number' &&
          typeof budget.periodStart === 'string'
        ? {
            capUsdMicros: budget.capUsdMicros,
            periodStart: budget.periodStart,
            reservedUsdMicros: budget.reservedUsdMicros,
            usedUsdMicros: budget.usedUsdMicros,
          }
        : undefined;
  if (parsedBudget === undefined) throw new Error('Operations budget model is unavailable');
  return {
    alerts,
    budget: parsedBudget,
    jobs,
  };
}

const siteCreationInput = z.object({
  reason: z.string().trim().min(3).max(500),
  siteName: z.string().trim().min(1).max(160),
  sourcePath: z
    .string()
    .trim()
    .regex(/^sites\/[a-z0-9_-]+$/u)
    .max(300),
  tenantName: z.string().trim().min(1).max(160),
});

const operationReason = z.object({ reason: z.string().trim().min(3).max(500) });
const staffUiAuditReason = {
  disable: 'Platform Owner disabled staff access through Team & access',
  invite: 'Platform Owner invited staff through Team & access',
  profile: 'Platform Owner updated a staff account through Team & access',
  reset: 'Platform Owner requested a staff password reset through Team & access',
  role: 'Platform Owner changed a staff role through Team & access',
  sessions: 'Platform Owner revoked staff sessions through Team & access',
} as const;
const staffInvitationInput = z.object({
  displayName: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(320),
  jobTitle: z.string().trim().max(160).optional(),
  roleSlug: z.string().regex(/^[a-z0-9-]{1,100}$/u),
});
const staffAccountUpdateInput = z
  .object({
    confirmPassword: z.string().max(128).optional(),
    displayName: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(320),
    jobTitle: z.string().trim().max(160).optional(),
    newPassword: z.string().max(128).optional(),
  })
  .superRefine((value, context) => {
    const password = value.newPassword ?? '';
    const confirmation = value.confirmPassword ?? '';
    if (!password && !confirmation) return;
    if (password.length < 12 || password !== confirmation) {
      context.addIssue({
        code: 'custom',
        message: 'Passwords must match and contain at least 12 characters',
        path: ['newPassword'],
      });
    }
  });

function parseSiteSummaries(value: unknown): OrapSiteSummary[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const id = stringValue(entry.id);
        const name = stringValue(entry.name);
        const tenantId = stringValue(entry.tenantId);
        const tenantName = stringValue(entry.tenantName);
        const status = entry.status === 'disabled' ? ('disabled' as const) : ('active' as const);
        return name && tenantName
          ? [{ ...(id ? { id } : {}), name, status, ...(tenantId ? { tenantId } : {}), tenantName }]
          : [];
      })
    : [];
}

function parseSiteManagement(value: unknown): OrapSiteManagementModel | undefined {
  const result = z
    .object({
      availability: z.object({
        activeArtifact: z.boolean(),
        preservedDuringDelinquency: z.literal(true),
        publicDomain: z.boolean(),
      }),
      budget: z
        .object({
          capUsdMicros: z.number().nonnegative(),
          policyVersion: z.number().int().nonnegative(),
        })
        .nullable(),
      emergency: z.object({
        autonomousChangesStopped: z.boolean(),
        automationStopped: z.boolean(),
        editingFrozen: z.boolean(),
        policyVersion: z.number().int().nonnegative(),
      }),
      features: z.array(z.object({ enabled: z.boolean(), key: z.string(), readiness: z.string() })),
      integrations: z.array(
        z.object({
          lastSyncedAt: z.string().nullable(),
          propertyKind: z.string(),
          status: z.string(),
        }),
      ),
      plans: z.array(
        z.object({
          code: z.string(),
          commercialStatus: z.string(),
          id: z.string(),
          name: z.string(),
          version: z.number().int().positive(),
        }),
      ),
      subscription: z
        .object({
          aiReviewCyclesPerMonth: z.number().int().nonnegative(),
          code: z.string(),
          customerSeatLimit: z.number().int().nonnegative(),
          graceEndsAt: z.string().nullable(),
          planId: z.string(),
          seoAuditIntervalHours: z.number().int().positive(),
          standardPageLimit: z.number().int().nonnegative(),
          status: z.string(),
          version: z.number().int().positive(),
        })
        .nullable(),
    })
    .safeParse(value);
  return result.success ? result.data : undefined;
}

function parseGoogleAuthorizationUrl(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = stringValue(value.authorizationUrl);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' &&
      url.hostname === 'accounts.google.com' &&
      url.pathname === '/o/oauth2/v2/auth'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function siteNotice(value: string | undefined): string | undefined {
  if (value === 'created') return 'Site record created. No DNS or deployment changes were made.';
  if (value === 'google-connected') return 'Google reporting property connected successfully.';
  if (value === 'google-no-match') {
    return 'No authorized Google property exactly matched this website hostname.';
  }
  return undefined;
}

function operationNotice(
  value: string | undefined,
): { kind?: 'error' | 'success'; message: string } | undefined {
  if (value === 'updated') return { message: 'The operational record was updated.' };
  if (value === 'unavailable') {
    return { kind: 'error', message: 'That action is not available in this deployment.' };
  }
  if (value === 'failed') {
    return {
      kind: 'error',
      message: 'The action could not be completed. No unrelated platform state was changed.',
    };
  }
  return undefined;
}

function staffNotice(
  value: string | undefined,
): { kind?: 'error' | 'success'; message: string } | undefined {
  if (value === 'sessions') return { message: 'All active ORAP sessions were revoked.' };
  if (value === 'reset') return { message: 'Password reset instructions were requested.' };
  if (value === 'disabled') return { message: 'Staff access was disabled.' };
  if (value === 'invited') return { message: 'The secure staff invitation was sent.' };
  if (value === 'role') {
    return { message: 'Staff authority was updated and active sessions were revoked.' };
  }
  if (value === 'updated') {
    return { message: 'Account details were updated and active sessions were revoked.' };
  }
  if (value === 'failed') {
    return {
      kind: 'error',
      message: 'The staff security action could not be completed. No authority was changed.',
    };
  }
  return undefined;
}

function registerOrapStaffForms(
  server: FastifyInstance,
  options: {
    orapService?: OrapAdministrationEndpointService;
    resolvePlatformActor?: ResolvePlatformActor;
  },
): void {
  server.post<{ Body: unknown; Params: { userId: string } }>(
    '/orap/security/staff/:userId/profile',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await options.resolvePlatformActor?.(request);
      if (!actor || !isPlatformOwnerIdentity(actor)) {
        return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
      }
      const body = staffAccountUpdateInput.safeParse(request.body);
      if (!body.success || !options.orapService?.updateStaffAccount) {
        return reply
          .code(303)
          .redirect(`/orap/security/staff/${request.params.userId}?notice=failed`);
      }
      try {
        await options.orapService.updateStaffAccount(actor, {
          displayName: body.data.displayName,
          email: body.data.email,
          ...(body.data.jobTitle ? { jobTitle: body.data.jobTitle } : {}),
          ...(body.data.newPassword ? { newPassword: body.data.newPassword } : {}),
          reason: staffUiAuditReason.profile,
          userId: request.params.userId,
        });
        return request.params.userId === actor.id
          ? reply.code(303).redirect('/login')
          : reply
              .code(303)
              .redirect(`/orap/security/staff/${request.params.userId}?notice=updated`);
      } catch (error) {
        request.log.error({ error }, 'ORAP staff account update failed');
        return reply
          .code(303)
          .redirect(`/orap/security/staff/${request.params.userId}?notice=failed`);
      }
    },
  );

  const register = (
    path: string,
    action: 'disabled' | 'reset' | 'sessions',
    operation: (
      actor: AdminActor,
      userId: string,
      request: Parameters<NonNullable<typeof options.resolvePlatformActor>>[0],
    ) => Promise<unknown> | undefined,
  ) => {
    server.post<{ Body: unknown; Params: { userId: string } }>(
      path,
      { preHandler: requireSameOrigin },
      async (request, reply) => {
        const actor = await options.resolvePlatformActor?.(request);
        if (!actor || !isPlatformOwnerIdentity(actor)) {
          return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
        }
        try {
          const pending = operation(actor, request.params.userId, request);
          if (!pending) {
            return reply
              .code(303)
              .redirect(`/orap/security/staff/${request.params.userId}?notice=failed`);
          }
          await pending;
          return reply
            .code(303)
            .redirect(`/orap/security/staff/${request.params.userId}?notice=${action}`);
        } catch (error) {
          request.log.error({ error }, 'ORAP staff security action failed');
          return reply
            .code(303)
            .redirect(`/orap/security/staff/${request.params.userId}?notice=failed`);
        }
      },
    );
  };

  register('/orap/security/staff/:userId/sessions/revoke-all', 'sessions', (actor, userId) =>
    options.orapService?.revokeStaffSessions?.(actor, {
      reason: staffUiAuditReason.sessions,
      userId,
    }),
  );
  register('/orap/security/staff/:userId/reset', 'reset', (actor, userId, request) =>
    options.orapService?.requestStaffReset?.(actor, {
      host: request.hostname,
      networkIdentifier: clientNetworkIdentifier(request.ip),
      reason: staffUiAuditReason.reset,
      userId,
    }),
  );
  register('/orap/security/staff/:userId/disable', 'disabled', (actor, userId) =>
    options.orapService?.disableStaff?.(actor, {
      reason: staffUiAuditReason.disable,
      userId,
    }),
  );
  server.post<{ Body: unknown; Params: { userId: string } }>(
    '/orap/security/staff/:userId/role',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await options.resolvePlatformActor?.(request);
      if (!actor || !isPlatformOwnerIdentity(actor)) {
        return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
      }
      const body = z
        .object({
          roleSlug: z.string().regex(/^[a-z0-9-]{1,100}$/u),
        })
        .safeParse(request.body);
      if (!body.success || !options.orapService?.changeStaffRole) {
        return reply
          .code(303)
          .redirect(`/orap/security/staff/${request.params.userId}?notice=failed`);
      }
      try {
        await options.orapService.changeStaffRole(actor, {
          reason: staffUiAuditReason.role,
          roleSlug: body.data.roleSlug,
          userId: request.params.userId,
        });
        return reply
          .code(303)
          .redirect(`/orap/security/staff/${request.params.userId}?notice=role`);
      } catch (error) {
        request.log.error({ error }, 'ORAP staff role change failed');
        return reply
          .code(303)
          .redirect(`/orap/security/staff/${request.params.userId}?notice=failed`);
      }
    },
  );
}

function registerOrapOperationForms(
  server: FastifyInstance,
  options: {
    orapService?: OrapAdministrationEndpointService;
    resolvePlatformActor?: ResolvePlatformActor;
  },
): void {
  server.post<{ Body: unknown; Params: { jobId: string } }>(
    '/orap/operations/jobs/:jobId/cancel',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await options.resolvePlatformActor?.(request);
      if (!actor || !canOrap(actor, 'automation.jobs.cancel')) {
        return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
      }
      const body = operationReason.safeParse(request.body);
      if (!body.success) return reply.code(303).redirect('/orap/operations?notice=failed');
      if (!options.orapService?.cancelJob) {
        return reply.code(303).redirect('/orap/operations?notice=unavailable');
      }
      try {
        await options.orapService.cancelJob(actor, {
          jobId: request.params.jobId,
          reason: body.data.reason,
        });
        return reply.code(303).redirect('/orap/operations?notice=updated');
      } catch (error) {
        request.log.error({ error }, 'ORAP job cancellation failed');
        return reply.code(303).redirect('/orap/operations?notice=failed');
      }
    },
  );

  server.post<{ Body: unknown; Params: { jobId: string } }>(
    '/orap/operations/jobs/:jobId/replay',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await options.resolvePlatformActor?.(request);
      if (!actor || !canOrap(actor, 'automation.jobs.replay')) {
        return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
      }
      const body = operationReason.safeParse(request.body);
      if (!body.success) return reply.code(303).redirect('/orap/operations?notice=failed');
      if (!options.orapService?.replayJob) {
        return reply.code(303).redirect('/orap/operations?notice=unavailable');
      }
      try {
        await options.orapService.replayJob(actor, {
          jobId: request.params.jobId,
          reason: body.data.reason,
        });
        return reply.code(303).redirect('/orap/operations?notice=updated');
      } catch (error) {
        request.log.error({ error }, 'ORAP job replay failed');
        return reply.code(303).redirect('/orap/operations?notice=failed');
      }
    },
  );

  server.post<{ Body: unknown; Params: { alertId: string } }>(
    '/orap/operations/alerts/:alertId/acknowledge',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await options.resolvePlatformActor?.(request);
      if (!actor || !canOrap(actor, 'alerts.acknowledge')) {
        return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
      }
      const body = operationReason.safeParse(request.body);
      if (!body.success) return reply.code(303).redirect('/orap/operations?notice=failed');
      if (!options.orapService?.acknowledgeAlert) {
        return reply.code(303).redirect('/orap/operations?notice=unavailable');
      }
      try {
        await options.orapService.acknowledgeAlert(actor, {
          alertId: request.params.alertId,
          reason: body.data.reason,
        });
        return reply.code(303).redirect('/orap/operations?notice=updated');
      } catch (error) {
        request.log.error({ error }, 'ORAP alert acknowledgement failed');
        return reply.code(303).redirect('/orap/operations?notice=failed');
      }
    },
  );

  server.post<{ Body: unknown; Params: { alertId: string } }>(
    '/orap/operations/alerts/:alertId/resolve',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await options.resolvePlatformActor?.(request);
      if (!actor || !canOrap(actor, 'alerts.resolve')) {
        return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
      }
      const body = operationReason.safeParse(request.body);
      if (!body.success) return reply.code(303).redirect('/orap/operations?notice=failed');
      if (!options.orapService?.resolveAlert) {
        return reply.code(303).redirect('/orap/operations?notice=unavailable');
      }
      try {
        await options.orapService.resolveAlert(actor, {
          alertId: request.params.alertId,
          reason: body.data.reason,
        });
        return reply.code(303).redirect('/orap/operations?notice=updated');
      } catch (error) {
        request.log.error({ error }, 'ORAP alert resolution failed');
        return reply.code(303).redirect('/orap/operations?notice=failed');
      }
    },
  );
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}
