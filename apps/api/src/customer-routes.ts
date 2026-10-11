import { hasPermission, type Role } from '@omnireach/auth';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireSameOrigin } from './request-security.ts';
import { readCookie } from './request-auth.ts';

const stableId = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u)
  .max(100);
const reason = z.string().trim().min(3).max(500);

export interface CustomerPrincipal {
  editorPublishGrant: boolean;
  role: Role;
  siteId: string;
  tenantId: string;
  traceId: string;
  userId: string;
}

export interface CustomerEndpointService {
  assetDownload(
    principal: CustomerPrincipal,
    input: { assetId: string },
  ): Promise<{ bytes: Uint8Array; contentType: string; filename: string }>;
  assetUpload(
    principal: CustomerPrincipal,
    input: { filename: string; stream: AsyncIterable<Uint8Array> },
  ): Promise<unknown>;
  dashboard(principal: CustomerPrincipal): Promise<unknown>;
  createDraft(principal: CustomerPrincipal): Promise<unknown>;
  contactForms(principal: CustomerPrincipal): Promise<unknown>;
  contactSubmissions(principal: CustomerPrincipal): Promise<unknown>;
  drafts(principal: CustomerPrincipal): Promise<unknown>;
  fieldUpdate(
    principal: CustomerPrincipal,
    input: { draftId: string; expectedVersion: number; fieldId: string; value: unknown },
  ): Promise<unknown>;
  history(principal: CustomerPrincipal): Promise<unknown>;
  pages(principal: CustomerPrincipal): Promise<unknown>;
  preview(
    principal: CustomerPrincipal,
    input: { draftId: string },
  ): Promise<{ previewToken: string }>;
  previewFile(
    principal: CustomerPrincipal,
    input: { path: string; token: string },
  ): Promise<{ body: Uint8Array; contentType: string }>;
  publish(
    principal: CustomerPrincipal,
    input: { draftId: string; idempotencyKey: string; reason: string },
  ): Promise<unknown>;
  restore(
    principal: CustomerPrincipal,
    input: { idempotencyKey: string; reason: string; revision: number },
  ): Promise<unknown>;
  updateContactForm(
    principal: CustomerPrincipal,
    input: {
      confirmationEnabled: boolean;
      fieldIds: string[];
      formId: string;
      reason: string;
    },
  ): Promise<unknown>;
}

export type ResolveCustomerPrincipal = (
  request: FastifyRequest,
) => Promise<CustomerPrincipal | undefined>;

export function registerCustomerRoutes(
  server: FastifyInstance,
  service: CustomerEndpointService,
  resolvePrincipal: ResolveCustomerPrincipal,
): void {
  server.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
    done(null, payload);
  });

  server.get('/v1/customer/dashboard', async (request, reply) => {
    const principal = await authorize(request, reply, resolvePrincipal, 'content.read');
    if (!principal) return undefined;
    return service.dashboard(principal);
  });

  server.get('/v1/customer/pages', async (request, reply) => {
    const principal = await authorize(request, reply, resolvePrincipal, 'content.read');
    if (!principal) return undefined;
    return service.pages(principal);
  });

  server.get('/v1/customer/drafts', async (request, reply) => {
    const principal = await authorize(request, reply, resolvePrincipal, 'content.read');
    if (!principal) return undefined;
    return service.drafts(principal);
  });

  server.get('/v1/customer/contact-forms', async (request, reply) => {
    const principal = await authorize(request, reply, resolvePrincipal, 'content.read');
    if (!principal) return undefined;
    return service.contactForms(principal);
  });

  server.patch(
    '/v1/customer/contact-forms/:formId',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const principal = await authorize(request, reply, resolvePrincipal, 'content.edit');
      if (!principal) return;
      const params = parse(z.object({ formId: stableId }), request.params, reply);
      const body = parse(
        z.object({
          confirmationEnabled: z.boolean(),
          fieldIds: z.array(stableId).min(1).max(20),
          reason,
        }),
        request.body,
        reply,
      );
      if (!params || !body) return;
      return service.updateContactForm(principal, { ...params, ...body });
    },
  );

  server.get('/v1/customer/contact-submissions', async (request, reply) => {
    const principal = await authorize(request, reply, resolvePrincipal, 'content.read');
    if (!principal) return undefined;
    return service.contactSubmissions(principal);
  });

  server.post('/v1/customer/drafts', { preHandler: requireSameOrigin }, async (request, reply) => {
    const principal = await authorize(request, reply, resolvePrincipal, 'content.edit');
    if (!principal) return undefined;
    return reply.code(201).send(await service.createDraft(principal));
  });

  server.patch(
    '/v1/customer/drafts/:draftId/fields/:fieldId',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const principal = await authorize(request, reply, resolvePrincipal, 'content.edit');
      if (!principal) return;
      const params = parse(
        z.object({ draftId: z.string().uuid(), fieldId: stableId }),
        request.params,
        reply,
      );
      const body = parse(
        z.object({ expectedVersion: z.number().int().positive(), value: z.unknown() }),
        request.body,
        reply,
      );
      if (!params || !body) return;
      return service.fieldUpdate(principal, { ...params, ...body });
    },
  );

  server.post('/v1/customer/preview', { preHandler: requireSameOrigin }, async (request, reply) => {
    const principal = await authorize(request, reply, resolvePrincipal, 'content.edit');
    if (!principal) return;
    const body = parse(z.object({ draftId: z.string().uuid() }), request.body, reply);
    if (!body) return;
    const preview = await service.preview(principal, body);
    return reply
      .setCookie('__Host-omnireach_preview', preview.previewToken, {
        httpOnly: true,
        maxAge: 900,
        path: '/v1/customer/preview-content',
        sameSite: 'strict',
        secure: true,
      })
      .code(201)
      .send({ path: '/v1/customer/preview-content/' });
  });

  server.get('/v1/customer/preview-content/*', async (request, reply) => {
    const principal = await authorize(request, reply, resolvePrincipal, 'content.read');
    if (!principal) return;
    const token = readCookie(request, '__Host-omnireach_preview');
    const path = String((request.params as { '*': unknown })['*'] ?? '');
    if (!token || path.includes('..') || path.includes('\\')) {
      return reply.code(403).send({ error: 'preview_unavailable' });
    }
    const file = await service.previewFile(principal, { path, token });
    return reply
      .headers({
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; form-action 'none'",
        'Content-Type': file.contentType,
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      })
      .send(Buffer.from(file.body));
  });

  server.post(
    '/v1/customer/drafts/:draftId/publish',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const principal = await authorize(request, reply, resolvePrincipal, 'content.publish');
      if (!principal) return;
      const params = parse(z.object({ draftId: z.string().uuid() }), request.params, reply);
      const body = parse(z.object({ reason }), request.body, reply);
      const idempotencyKey = request.headers['idempotency-key'];
      if (!params || !body || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
        if (!reply.sent) await reply.code(400).send({ error: 'invalid_request' });
        return;
      }
      return reply
        .code(202)
        .send(await service.publish(principal, { ...params, ...body, idempotencyKey }));
    },
  );

  server.get('/v1/customer/history', async (request, reply) => {
    const principal = await authorize(request, reply, resolvePrincipal, 'content.read');
    if (!principal) return undefined;
    return service.history(principal);
  });

  server.post('/v1/customer/assets', { preHandler: requireSameOrigin }, async (request, reply) => {
    const principal = await authorize(request, reply, resolvePrincipal, 'content.edit');
    if (!principal) return;
    const filename = request.headers['x-file-name'];
    const stream = request.body as AsyncIterable<Uint8Array> | undefined;
    if (typeof filename !== 'string' || !filename.trim() || !stream?.[Symbol.asyncIterator]) {
      return reply.code(400).send({ error: 'invalid_upload' });
    }
    return reply.code(201).send(await service.assetUpload(principal, { filename, stream }));
  });

  server.get('/v1/customer/assets/:assetId', async (request, reply) => {
    const principal = await authorize(request, reply, resolvePrincipal, 'content.read');
    if (!principal) return;
    const params = parse(z.object({ assetId: z.string().uuid() }), request.params, reply);
    if (!params) return;
    const asset = await service.assetDownload(principal, params);
    return reply
      .header('Content-Type', asset.contentType)
      .header('Content-Disposition', `attachment; filename="${safeDownloadName(asset.filename)}"`)
      .send(Buffer.from(asset.bytes));
  });

  server.post(
    '/v1/customer/history/:revision/restore',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const principal = await authorize(request, reply, resolvePrincipal, 'content.publish');
      if (!principal) return;
      const params = parse(
        z.object({ revision: z.coerce.number().int().positive() }),
        request.params,
        reply,
      );
      const body = parse(z.object({ reason }), request.body, reply);
      const idempotencyKey = request.headers['idempotency-key'];
      if (!params || !body || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
        if (!reply.sent) await reply.code(400).send({ error: 'invalid_request' });
        return;
      }
      return reply
        .code(202)
        .send(await service.restore(principal, { ...params, ...body, idempotencyKey }));
    },
  );
}

function safeDownloadName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/gu, '-').slice(0, 160) || 'asset';
}

async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  resolvePrincipal: ResolveCustomerPrincipal,
  action: 'content.edit' | 'content.publish' | 'content.read',
): Promise<CustomerPrincipal | undefined> {
  const principal = await resolvePrincipal(request);
  const grants = principal?.editorPublishGrant ? new Set(['content.publish' as const]) : undefined;
  if (!principal || !hasPermission(principal.role, action, grants)) {
    await reply.code(403).send({ error: 'forbidden' });
    return undefined;
  }
  return principal;
}

function parse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  reply: { code(status: number): { send(body: unknown): unknown } },
): T | undefined {
  const result = schema.safeParse(value);
  if (!result.success) {
    reply.code(400).send({ error: 'invalid_request' });
    return undefined;
  }
  return result.data;
}
