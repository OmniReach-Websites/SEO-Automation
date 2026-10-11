import type { AdminActor } from '@omnireach/tenant';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ResolvePlatformActor } from './orap-routes.ts';
import { requireSameOrigin } from './request-security.ts';

export interface IntegrationEndpointService {
  disconnect(
    actor: AdminActor,
    input: { readonly connectionId: string; readonly reason: string },
  ): Promise<unknown>;
  finishGoogle(
    actor: AdminActor,
    input: { readonly code: string; readonly siteId: string; readonly state: string },
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
}

export function registerIntegrationRoutes(
  server: FastifyInstance,
  service: IntegrationEndpointService,
  resolveActor: ResolvePlatformActor,
): void {
  server.get('/v1/orap/sites/:siteId/integrations', async (request, reply) => {
    const actor = await authorize(request, reply, resolveActor);
    if (!actor) return;
    const params = parse(z.object({ siteId: z.string().uuid() }), request.params, reply);
    if (!params) return;
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
        siteId: z.string().uuid(),
        state: z.string().min(16).max(200),
      }),
      request.query,
      reply,
    );
    if (!query) return;
    return service.finishGoogle(actor, query);
  });
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
function parse<T>(schema: z.ZodType<T>, value: unknown, reply: FastifyReply): T | undefined {
  const result = schema.safeParse(value);
  if (!result.success) {
    void reply.code(400).send({ error: 'invalid_request' });
    return undefined;
  }
  return result.data;
}
