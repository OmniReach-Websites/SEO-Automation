import type { FastifyReply, FastifyRequest } from 'fastify';

export async function requireSameOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const expectedOrigin = `https://${request.hostname}`;
  const origin = request.headers.origin;
  if (origin === expectedOrigin) return;

  // An explicit Origin always wins. Never let a matching Referer or Fetch
  // Metadata header override a cross-origin Origin value.
  if (origin !== undefined) {
    await reply.code(403).send({ error: 'origin_rejected' });
    return;
  }

  const sameOriginFormNavigation =
    request.headers['sec-fetch-site'] === 'same-origin' &&
    request.headers['sec-fetch-mode'] === 'navigate' &&
    request.headers['sec-fetch-dest'] === 'document';
  if (sameOriginFormNavigation) return;

  const referer = request.headers.referer;
  if (referer !== undefined) {
    try {
      if (new URL(referer).origin === expectedOrigin) return;
    } catch {
      // Malformed Referer values are rejected below.
    }
  }

  await reply.code(403).send({ error: 'origin_rejected' });
}
