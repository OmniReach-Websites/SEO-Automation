import type { FastifyReply, FastifyRequest } from 'fastify';

export async function requireSameOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const origin = request.headers.origin;
  if (origin !== `https://${request.hostname}`) {
    await reply.code(403).send({ error: 'origin_rejected' });
  }
}
