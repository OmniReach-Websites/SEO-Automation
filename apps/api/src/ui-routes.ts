import {
  renderCustomerDashboard,
  renderOperationsCenter,
  renderOrapDashboard,
  type AlertRow,
  type BudgetView,
  type JobRow,
} from '@omnireach/ui';
import type { FastifyInstance } from 'fastify';

import type { CustomerEndpointService, ResolveCustomerPrincipal } from './customer-routes.ts';
import type { OrapAdministrationEndpointService, ResolvePlatformActor } from './orap-routes.ts';

export function registerUiRoutes(
  server: FastifyInstance,
  options: {
    customerService?: CustomerEndpointService;
    orapService?: OrapAdministrationEndpointService;
    resolveCustomerPrincipal?: ResolveCustomerPrincipal;
    resolvePlatformActor?: ResolvePlatformActor;
  },
): void {
  server.get('/login', async (request, reply) =>
    reply.type('text/html; charset=utf-8').send(renderLogin(request.hostname)),
  );
  server.get<{ Querystring: { challengeId?: string } }>('/mfa', async (request, reply) =>
    reply.type('text/html; charset=utf-8').send(renderMfa(request.query?.challengeId ?? '')),
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

  if (options.orapService && options.resolvePlatformActor) {
    server.get('/orap/sites', async (request, reply) => {
      const actor = await options.resolvePlatformActor?.(request);
      if (!actor || !['platform_owner', 'platform_admin', 'staff'].includes(actor.role)) {
        return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
      }
      const raw = await options.orapService?.listSites(actor);
      const sites = Array.isArray(raw)
        ? raw.flatMap((entry) => {
            if (!isRecord(entry)) return [];
            const name = stringValue(entry.name);
            const tenantName = stringValue(entry.tenantName);
            const status =
              entry.status === 'disabled' ? ('disabled' as const) : ('active' as const);
            return name && tenantName ? [{ name, status, tenantName }] : [];
          })
        : [];
      return reply.type('text/html; charset=utf-8').send(renderOrapDashboard(sites));
    });

    server.get('/orap/operations', async (request, reply) => {
      const actor = await options.resolvePlatformActor?.(request);
      if (!actor || !['platform_owner', 'platform_admin', 'staff'].includes(actor.role)) {
        return reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
      }
      if (!options.orapService?.listOperations) return reply.code(404).send();
      const model = parseOperationsModel(await options.orapService.listOperations(actor));
      return reply
        .type('text/html; charset=utf-8')
        .send(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>Operations | OmniReach</title></head><body><a href="#operations-heading">Skip to content</a>${renderOperationsCenter(model)}</body></html>`,
        );
    });
  }

  if (options.customerService && options.resolveCustomerPrincipal) {
    server.get('/', async (request, reply) => {
      const principal = await options.resolveCustomerPrincipal?.(request);
      if (!principal) return reply.redirect('/login');
      const raw = await options.customerService?.dashboard(principal);
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
              reason:
                controls.editingFrozen === true ? 'Temporarily frozen' : 'Available by policy',
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
}

function renderLogin(hostname: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>Sign in | OmniReach</title></head><body><a href="#main">Skip to content</a><main id="main"><h1>Sign in</h1><p>Continue to the administration site for <strong>${escapeHtml(hostname)}</strong>.</p><form method="post" action="/auth/login"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Sign in</button></form><p><a href="/auth/recovery">Recover access</a></p></main></body></html>`;
}

function renderMfa(challengeId: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>Verify sign in | OmniReach</title></head><body><a href="#main">Skip to content</a><main id="main"><h1>Verify sign in</h1><form method="post" action="/auth/mfa/verify"><input name="challengeId" type="hidden" value="${escapeHtml(challengeId)}"><label for="code">Authenticator or recovery code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required autofocus><button type="submit">Verify</button></form></main></body></html>`;
}

function renderInvitation(token: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>Accept invitation | OmniReach</title></head><body><a href="#main">Skip to content</a><main id="main"><h1>Accept your invitation</h1><p>Create the credentials used to manage this website.</p><form method="post" action="/auth/invitations/accept"><input name="token" type="hidden" value="${escapeHtml(token)}"><label for="displayName">Your name</label><input id="displayName" name="displayName" maxlength="160" autocomplete="name" required><label for="password">Password</label><input id="password" name="password" type="password" minlength="12" autocomplete="new-password" required><button type="submit">Accept invitation</button></form></main></body></html>`;
}

function renderRecoveryRequest(): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>Recover access | OmniReach</title></head><body><a href="#main">Skip to content</a><main id="main"><h1>Recover access</h1><p>If the address belongs to an active account, a time-limited recovery link will be sent.</p><form method="post" action="/auth/recovery"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required><button type="submit">Send recovery link</button></form><p><a href="/login">Return to sign in</a></p></main></body></html>';
}

function renderRecoveryCompletion(token: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>Choose a new password | OmniReach</title></head><body><a href="#main">Skip to content</a><main id="main"><h1>Choose a new password</h1><form method="post" action="/auth/recovery/complete"><input name="token" type="hidden" value="${escapeHtml(token)}"><label for="newPassword">New password</label><input id="newPassword" name="newPassword" type="password" minlength="12" autocomplete="new-password" required><button type="submit">Update password</button></form></main></body></html>`;
}

function renderForbidden(): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Access denied</title></head><body><main><h1>Access denied</h1><p>This administration site is not available to this account.</p></main></body></html>';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function parseOperationsModel(value: unknown): {
  alerts: AlertRow[];
  budget: BudgetView;
  jobs: JobRow[];
} {
  if (!isRecord(value) || !isRecord(value.budget)) {
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
  if (
    typeof budget.capUsdMicros !== 'number' ||
    typeof budget.reservedUsdMicros !== 'number' ||
    typeof budget.usedUsdMicros !== 'number' ||
    typeof budget.periodStart !== 'string'
  ) {
    throw new Error('Operations budget model is unavailable');
  }
  return {
    alerts,
    budget: {
      capUsdMicros: budget.capUsdMicros,
      periodStart: budget.periodStart,
      reservedUsdMicros: budget.reservedUsdMicros,
      usedUsdMicros: budget.usedUsdMicros,
    },
    jobs,
  };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}
