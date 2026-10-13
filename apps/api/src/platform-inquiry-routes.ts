import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

const inquiry = z.object({
  businessName: z.string().trim().max(160).optional().default(''),
  email: z.string().trim().email().max(320),
  message: z.string().trim().min(10).max(5_000),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(50).optional().default(''),
  consent: z.union([z.literal(true), z.literal('on')]),
  turnstileToken: z.string().max(2_048).optional().default(''),
  website: z.string().max(200).optional().default(''),
});

export interface PlatformInquiryEndpointService {
  publicConfig(): Promise<{ enabled: boolean; turnstileSiteKey?: string }>;
  submit(input: {
    businessName?: string;
    email: string;
    message: string;
    name: string;
    origin: string;
    phone?: string;
    remoteIp: string;
    turnstileToken: string;
    website?: string;
  }): Promise<void>;
}

export function registerPlatformInquiryRoutes(
  server: FastifyInstance,
  service: PlatformInquiryEndpointService,
): void {
  server.get(
    '/v1/public/platform-inquiry/config',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return reply.send(await service.publicConfig());
    },
  );

  server.post(
    '/v1/public/platform-inquiry',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request: FastifyRequest, reply) => {
      const origin = request.headers.origin;
      if (typeof origin !== 'string') {
        return reply.code(403).send({ error: 'origin_rejected' });
      }
      const parsed = inquiry.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_submission' });
      const { businessName, email, message, name, phone, turnstileToken, website } = parsed.data;
      try {
        await service.submit({
          email,
          message,
          name,
          origin,
          remoteIp: request.ip,
          turnstileToken,
          ...(businessName ? { businessName } : {}),
          ...(phone ? { phone } : {}),
          ...(website ? { website } : {}),
        });
        return reply.code(202).send({ status: 'accepted' });
      } catch {
        return reply.code(503).send({ error: 'delivery_unavailable' });
      }
    },
  );
}
