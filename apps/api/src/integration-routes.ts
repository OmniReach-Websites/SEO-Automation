import { canOrap, type OrapCapabilityKey, type OrapResourceTarget } from '@omnireach/auth';
import type { AdminActor } from '@omnireach/tenant';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ResolvePlatformActor } from './orap-routes.ts';
import { assertOrapRoutePolicyRegistry } from './orap-route-policy.ts';
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
      return reply
        .code(201)
        .send(await service.startGoogle(actor, { ...body, siteId: params.siteId }));
    },
  );
  server.get('/v1/orap/integrations/google/callback', async (request, reply) => {
    const actor = await authorize(request, reply, resolveActor);
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
    return service.finishGoogle(actor, {
      code: query.code,
      siteId: query.siteId,
      state: query.state,
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
    });
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
