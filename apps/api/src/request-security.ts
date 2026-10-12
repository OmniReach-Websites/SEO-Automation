import type { FastifyReply, FastifyRequest } from 'fastify';

export async function requireSameOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const origin = request.headers.origin;
  if (origin === `https://${request.hostname}`) return;

  const sameOriginFormNavigation =
    origin === undefined &&
    request.headers['sec-fetch-site'] === 'same-origin' &&
    request.headers['sec-fetch-mode'] === 'navigate' &&
    request.headers['sec-fetch-dest'] === 'document';
  if (sameOriginFormNavigation) return;

  await reply.code(403).send({ error: 'origin_rejected' });
}
