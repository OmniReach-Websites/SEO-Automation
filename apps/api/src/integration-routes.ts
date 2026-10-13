import { canOrap, type OrapCapabilityKey, type OrapResourceTarget } from '@omnireach/auth';
import type { AdminActor } from '@omnireach/tenant';
import { renderOrapShell } from '@omnireach/ui';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  googleOAuthCallbackCookieName,
  googleOAuthCallbackCookieOptions,
} from './google-oauth-cookie.ts';
import type { ResolvePlatformActor } from './orap-routes.ts';
import { assertOrapRoutePolicyRegistry } from './orap-route-policy.ts';
import { readCookie } from './request-auth.ts';
import { requireSameOrigin } from './request-security.ts';

export interface IntegrationEndpointService {
  disconnect(
    actor: AdminActor,
    input: { readonly connectionId: string; readonly reason: string },
  ): Promise<unknown>;
  finishGoogle(
    actor: AdminActor,
    input: {
      readonly code: string;
      readonly propertyId?: string;
      readonly siteId: string;
      readonly state: string;
    },
  ): Promise<unknown>;
  list(actor: AdminActor, siteId: string): Promise<unknown>;
  startGoogle(
    actor: AdminActor,
    input: {
      readonly propertyKind: 'ga4' | 'search_console';
      readonly redirectUri: string;
      readonly siteId: string;
    },
  ): Promise<unknown>;
  selectGoogleProperty?(
    actor: AdminActor,
    input: {
      readonly pendingSelectionId: string;
      readonly propertyId: string;
      readonly propertyKind: 'ga4' | 'search_console';
      readonly siteId: string;
    },
  ): Promise<unknown>;
}

export function registerIntegrationRoutes(
  server: FastifyInstance,
  service: IntegrationEndpointService,
  resolveActor: ResolvePlatformActor,
  resolveCallbackActor: ResolvePlatformActor = resolveActor,
): void {
  assertOrapRoutePolicyRegistry();
  server.get('/v1/orap/sites/:siteId/integrations', async (request, reply) => {
    const actor = await authorize(request, reply, resolveActor);
    if (!actor) return;
    const params = parse(z.object({ siteId: z.string().uuid() }), request.params, reply);
    if (!params) return;
    if (!authorizeCapability(actor, 'integrations.google.view', params, reply)) return;
    return service.list(actor, params.siteId);
  });
  server.post(
    '/v1/orap/sites/:siteId/integrations/google/start',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorize(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(z.object({ siteId: z.string().uuid() }), request.params, reply);
      const body = parse(
        z.object({
          propertyKind: z.enum(['ga4', 'search_console']),
          redirectUri: z.string().url().max(500),
        }),
        request.body,
        reply,
      );
      if (!params || !body) return;
      if (!authorizeCapability(actor, 'integrations.google.manage', params, reply)) return;
      const result = await service.startGoogle(actor, { ...body, siteId: params.siteId });
      const sessionToken = readCookie(request, '__Host-omnireach_session');
      if (sessionToken) {
        reply.setCookie(
          googleOAuthCallbackCookieName,
          sessionToken,
          googleOAuthCallbackCookieOptions,
        );
      }
      return reply.code(201).send(result);
    },
  );
  server.get('/v1/orap/integrations/google/callback', async (request, reply) => {
    const actor = await authorize(request, reply, resolveCallbackActor);
    if (!actor) return;
    const query = parse(
      z.object({
        code: z.string().min(1).max(2000),
        propertyId: z.string().min(1).max(300).optional(),
        siteId: z.string().uuid(),
        state: z.string().min(16).max(200),
      }),
      request.query,
      reply,
    );
    if (!query) return;
    if (!authorizeCapability(actor, 'integrations.google.manage', query, reply)) return;
    const result = await service.finishGoogle(actor, {
      code: query.code,
      siteId: query.siteId,
      state: query.state,
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
    });
    reply.clearCookie(googleOAuthCallbackCookieName, googleOAuthCallbackCookieOptions);
    if (!acceptsHtml(request)) return result;
    const completion = googleCompletion.safeParse(result);
    if (!completion.success) return result;
    if (completion.data.status === 'connected') {
      return reply
        .code(303)
        .redirect(`/orap/sites/${encodeURIComponent(query.siteId)}?notice=google-connected`);
    }
    if (completion.data.status === 'no_matching_property') {
      return reply
        .code(303)
        .redirect(`/orap/sites/${encodeURIComponent(query.siteId)}?notice=google-no-match`);
    }
    return reply
      .type('text/html; charset=utf-8')
      .send(renderGooglePropertySelection(query.siteId, completion.data));
  });
  server.post(
    '/v1/orap/sites/:siteId/integrations/google/select',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorize(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(z.object({ siteId: z.string().uuid() }), request.params, reply);
      const body = parse(
        z.object({
          pendingSelectionId: z.string().uuid(),
          propertyId: z.string().min(1).max(300),
          propertyKind: z.enum(['ga4', 'search_console']),
        }),
        request.body,
        reply,
      );
      if (!params || !body) return;
      if (!service.selectGoogleProperty)
        return reply.code(503).send({ error: 'integration_unavailable' });
      if (!authorizeCapability(actor, 'integrations.google.manage', params, reply)) return;
      return service.selectGoogleProperty(actor, { ...body, siteId: params.siteId });
    },
  );
  server.delete(
    '/v1/orap/integrations/:connectionId',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const actor = await authorize(request, reply, resolveActor);
      if (!actor) return;
      const params = parse(z.object({ connectionId: z.string().uuid() }), request.params, reply);
      const body = parse(
        z.object({ reason: z.string().trim().min(3).max(500) }),
        request.body,
        reply,
      );
      if (!params || !body) return;
      if (!authorizeCapability(actor, 'integrations.google.manage', {}, reply)) return;
      return service.disconnect(actor, { ...body, connectionId: params.connectionId });
    },
  );
}

async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  resolveActor: ResolvePlatformActor,
): Promise<AdminActor | undefined> {
  const actor = await resolveActor(request);
  if (!actor) {
    await reply.code(401).send({ error: 'authentication_required' });
    return undefined;
  }
  return actor;
}

function authorizeCapability(
  actor: AdminActor,
  capabilityKey: OrapCapabilityKey,
  target: OrapResourceTarget,
  reply: FastifyReply,
): boolean {
  if (canOrap(actor, capabilityKey, target)) return true;
  void reply.code(403).send({ error: 'orap_authorization_denied' });
  return false;
}
function parse<T>(schema: z.ZodType<T>, value: unknown, reply: FastifyReply): T | undefined {
  const result = schema.safeParse(value);
  if (!result.success) {
    void reply.code(400).send({ error: 'invalid_request' });
    return undefined;
  }
  return result.data;
}

const googleCompletion = z.discriminatedUnion('status', [
  z.object({ status: z.literal('connected') }),
  z.object({ status: z.literal('no_matching_property') }),
  z.object({
    eligibleProperties: z.array(
      z.object({
        id: z.string().min(1).max(300),
        kind: z.enum(['ga4', 'search_console']),
        siteUrl: z.string().min(1).max(500),
      }),
    ),
    pendingSelectionId: z.string().uuid(),
    status: z.literal('property_selection_required'),
  }),
]);

function acceptsHtml(request: FastifyRequest): boolean {
  const accept = request.headers.accept;
  return typeof accept === 'string' && accept.includes('text/html');
}

function renderGooglePropertySelection(
  siteId: string,
  input: Extract<z.infer<typeof googleCompletion>, { status: 'property_selection_required' }>,
): string {
  const options = input.eligibleProperties
    .map(
      (property) =>
        `<option value="${escapeHtml(property.id)}" data-kind="${property.kind}">${escapeHtml(property.siteUrl)} — ${property.kind === 'ga4' ? 'Google Analytics 4' : 'Search Console'}</option>`,
    )
    .join('');
  const propertyKind = input.eligibleProperties[0]?.kind ?? 'ga4';
  return renderOrapShell({
    actions: `<a class="button secondary" href="/orap/sites/${encodeURIComponent(siteId)}">Cancel</a>`,
    content: `<section class="panel"><p class="lede">More than one Google property matches this website. Select the exact reporting property OmniReach should use.</p><form method="post" action="/orap/sites/${encodeURIComponent(siteId)}/integrations/google/select"><input type="hidden" name="pendingSelectionId" value="${escapeHtml(input.pendingSelectionId)}"><input type="hidden" name="propertyKind" value="${propertyKind}"><label for="propertyId">Google property</label><select id="propertyId" name="propertyId" required>${options}</select><button type="submit">Connect selected property</button></form></section>`,
    current: 'sites',
    eyebrow: 'Google integrations',
    heading: 'Select a property',
    title: 'Select Google property',
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}
