import { createTraceId } from '@omnireach/observability';
import {
  ProtectedFieldError,
  PublicationPendingError,
  RevisionConflictError,
} from '@omnireach/content';
import { SitePolicyDeniedError } from '@omnireach/tenant';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerAuthRoutes, type AuthEndpointService } from './auth-routes.ts';
import {
  registerContactRoutes,
  type ContactEndpointService,
  type ResolveContactSite,
} from './contact-routes.ts';
import {
  registerCustomerRoutes,
  type CustomerEndpointService,
  type ResolveCustomerPrincipal,
} from './customer-routes.ts';
import {
  registerOrapRoutes,
  type OrapAdministrationEndpointService,
  type ResolvePlatformActor,
} from './orap-routes.ts';
import { registerUiRoutes } from './ui-routes.ts';
import {
  registerIntegrationRoutes,
  type IntegrationEndpointService,
} from './integration-routes.ts';

export type {
  CustomerEndpointService,
  CustomerPrincipal,
  ResolveCustomerPrincipal,
} from './customer-routes.ts';
export type {
  ContactEndpointService,
  ContactSiteContext,
  ResolveContactSite,
} from './contact-routes.ts';
export type { OrapAdministrationEndpointService, ResolvePlatformActor } from './orap-routes.ts';
export type { IntegrationEndpointService } from './integration-routes.ts';
export { PostgresRequestContextResolver, type ContextQueryPool } from './postgres-context.ts';
export {
  PostgresContactService,
  decodeContactEncryptionKey,
  decryptContactPayload,
} from './postgres-contact.ts';
export { PostgresCustomerService, type CustomerPreviewAdapter } from './customer-service.ts';
export { PostgresOrapService, type InvitationNotifier } from './postgres-orap.ts';

export interface DependencyCheck {
  check(): Promise<void>;
  name: string;
}

export interface ApiServerOptions {
  authService?: AuthEndpointService;
  contactService?: ContactEndpointService;
  customerService?: CustomerEndpointService;
  dependencies?: DependencyCheck[];
  logLevel?: string;
  integrationService?: IntegrationEndpointService;
  orapService?: OrapAdministrationEndpointService;
  resolvePlatformActor?: ResolvePlatformActor;
  resolveCustomerPrincipal?: ResolveCustomerPrincipal;
  resolveContactSite?: ResolveContactSite;
  trustedProxyCidrs?: string[];
}

export function buildApiServer(options: ApiServerOptions = {}) {
  const dependencies = options.dependencies ?? [];
  const server: FastifyInstance = Fastify({
    genReqId: (request) => createTraceId(headerValue(request.headers['x-request-id'])),
    logger: {
      base: null,
      level: options.logLevel ?? 'info',
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.code',
        'req.body.challengeId',
        'req.body.ceremonyId',
        'req.body.currentPassword',
        'req.body.newPassword',
        'req.body.password',
        'req.body.response',
        'req.body.token',
        'req.query.code',
        'req.query.token',
        'req.url',
        'res.headers.set-cookie',
      ],
    },
    trustProxy:
      options.trustedProxyCidrs && options.trustedProxyCidrs.length > 0
        ? options.trustedProxyCidrs
        : false,
  });

  void server.register(cookie);
  void server.register(rateLimit, { global: false });
  server.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      const values = new URLSearchParams(typeof body === 'string' ? body : body.toString('utf8'));
      done(null, Object.fromEntries(values.entries()));
    },
  );

  server.addHook('onSend', async (_request, reply) => {
    if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    if (!reply.hasHeader('Content-Security-Policy')) {
      reply.header(
        'Content-Security-Policy',
        "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
      );
    }
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
  });

  server.setErrorHandler((error, request, reply) => {
    if (error instanceof PublicationPendingError) {
      return reply.code(409).send({ error: 'publication_pending' });
    }
    if (error instanceof RevisionConflictError) {
      return reply.code(409).send({ error: 'revision_conflict' });
    }
    if (error instanceof ProtectedFieldError) {
      return reply.code(403).send({ error: 'field_protected' });
    }
    if (error instanceof SitePolicyDeniedError) {
      return reply.code(403).send({ error: 'site_policy_denied' });
    }
    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number(error.statusCode)
        : 0;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: 'invalid_request' });
    }
    request.log.error({ error }, 'Request failed');
    return reply.code(500).send({ error: 'internal_error', traceId: String(request.id) });
  });

  server.get('/health/live', async (_request, reply) => {
    return reply.code(200).send({ status: 'alive' });
  });

  server.get('/health/ready', async (_request, reply) => {
    const results = await Promise.allSettled(dependencies.map(async ({ check }) => check()));
    const failed = results.flatMap((result, index) =>
      result.status === 'rejected' ? [dependencies[index]?.name ?? `dependency-${index}`] : [],
    );
    if (failed.length > 0) {
      return reply.code(503).send({ failed, status: 'degraded' });
    }
    return reply.code(200).send({
      authContract: 3,
      dependencies: dependencies.map(({ name }) => name),
      status: 'ready',
    });
  });

  if (options.authService) registerAuthRoutes(server, options.authService);
  if (options.contactService && options.resolveContactSite) {
    registerContactRoutes(server, options.contactService, options.resolveContactSite);
  }
  if (options.customerService && options.resolveCustomerPrincipal) {
    registerCustomerRoutes(server, options.customerService, options.resolveCustomerPrincipal);
  }
  if (options.orapService && options.resolvePlatformActor) {
    registerOrapRoutes(server, options.orapService, options.resolvePlatformActor);
  }
  if (options.integrationService && options.resolvePlatformActor) {
    registerIntegrationRoutes(server, options.integrationService, options.resolvePlatformActor);
  }
  registerUiRoutes(server, options);

  return server;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
