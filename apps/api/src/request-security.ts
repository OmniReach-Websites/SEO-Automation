import type { FastifyReply, FastifyRequest } from 'fastify';

export async function requireSameOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authority = request.headers.host ?? request.hostname;
  const expectedOrigin = `${request.protocol}://${authority}`;
  const acceptedOrigins = new Set([expectedOrigin, `https://${authority}`]);
  const origin = request.headers.origin;
  if (origin !== undefined && acceptedOrigins.has(origin)) return;

  // An explicit Origin always wins. Never let a matching Referer or Fetch
  // Metadata header override a cross-origin Origin value.
  if (origin !== undefined) {
    await rejectOrigin(request, reply);
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
      if (acceptedOrigins.has(new URL(referer).origin)) return;
    } catch {
      // Malformed Referer values are rejected below.
    }
  }

  await rejectOrigin(request, reply);
}

async function rejectOrigin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const formSubmission = String(request.headers['content-type'] ?? '')
    .toLowerCase()
    .startsWith('application/x-www-form-urlencoded');
  if (!formSubmission) {
    await reply.code(403).send({ error: 'origin_rejected' });
    return;
  }
  await reply
    .code(403)
    .type('text/html; charset=utf-8')
    .send(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><link rel="stylesheet" href="/assets/admin.css?v=orap-2"><title>Request blocked | OmniReach</title></head><body><main class="auth-workspace"><section class="auth-card"><p class="eyebrow">Security check</p><h1>Request blocked</h1><p class="lede">The page origin could not be verified. Return to sign in and try again from the official administration address.</p><a class="button" href="/login">Return to sign in</a></section></main></body></html>',
    );
}
