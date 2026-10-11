import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

const stableId = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const submission = z
  .record(z.string().max(100), z.union([z.string().max(5_000), z.boolean()]))
  .superRefine((input, context) => {
    if (Object.keys(input).length > 24) {
      context.addIssue({ code: 'custom', message: 'Too many contact form fields' });
    }
    if (typeof input.formId !== 'string' || !stableId.test(input.formId)) {
      context.addIssue({ code: 'custom', message: 'Invalid contact form id' });
    }
    const token = input.turnstileToken ?? input['cf-turnstile-response'];
    if (typeof token !== 'string' || token.length < 1 || token.length > 2_048) {
      context.addIssue({ code: 'custom', message: 'Turnstile response is required' });
    }
    if (typeof input.website === 'string' && input.website.length > 200) {
      context.addIssue({ code: 'custom', message: 'Invalid honeypot value' });
    }
    for (const key of Object.keys(input)) {
      if (
        !['cf-turnstile-response', 'formId', 'turnstileToken', 'website'].includes(key) &&
        !stableId.test(key)
      ) {
        context.addIssue({ code: 'custom', message: `Invalid contact field: ${key}` });
      }
    }
  })
  .transform((input) => {
    const {
      'cf-turnstile-response': widgetToken,
      formId,
      turnstileToken,
      website,
      ...fields
    } = input;
    return {
      fields,
      formId: String(formId),
      turnstileToken: String(turnstileToken ?? widgetToken),
      ...(typeof website === 'string' ? { website } : {}),
    };
  });

export interface ContactSiteContext {
  allowedOrigin: string;
  siteId: string;
  tenantId: string;
}

export interface ContactEndpointService {
  publicConfig?(
    context: ContactSiteContext,
    formId: string,
  ): Promise<{ enabled: boolean; turnstileSiteKey?: string }>;
  submit(
    context: ContactSiteContext,
    input: z.infer<typeof submission> & { origin: string; remoteIp: string },
  ): Promise<{ submissionId: string }>;
}

export type ResolveContactSite = (
  request: FastifyRequest,
) => Promise<ContactSiteContext | undefined>;

export function registerContactRoutes(
  server: FastifyInstance,
  service: ContactEndpointService,
  resolveSite: ResolveContactSite,
): void {
  server.get(
    '/v1/public/contact/config',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const context = await resolveSite(request);
      const query = z
        .object({ formId: z.string().regex(stableId).max(100) })
        .safeParse(request.query);
      reply.header('Cache-Control', 'no-store');
      if (!context || !query.success || !service.publicConfig) {
        return reply.code(query.success ? 404 : 400).send({ enabled: false });
      }
      const config = await service.publicConfig(context, query.data.formId);
      return reply.send(config);
    },
  );

  server.post(
    '/v1/public/contact',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const context = await resolveSite(request);
      const origin = request.headers.origin;
      if (!context || typeof origin !== 'string' || origin !== context.allowedOrigin) {
        return reply.code(403).send({ error: 'origin_rejected' });
      }
      const parsed = submission.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_submission' });
      try {
        const result = await service.submit(context, {
          ...parsed.data,
          origin,
          remoteIp: request.ip,
        });
        return reply.code(202).send({ ...result, status: 'accepted' });
      } catch {
        return reply.code(503).send({ error: 'delivery_unavailable' });
      }
    },
  );
}
