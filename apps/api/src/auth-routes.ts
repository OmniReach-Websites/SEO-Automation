import { normalizeEmail, sessionCookieOptions } from '@omnireach/auth';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireSameOrigin } from './request-security.ts';
import { readCookie } from './request-auth.ts';

export type LoginResult =
  | { kind: 'authenticated'; sessionToken: string }
  | { challengeId: string; kind: 'mfa-required' }
  | { kind: 'invalid' };

export interface AuthEndpointService {
  acceptInvitation(input: {
    displayName: string;
    host: string;
    password: string;
    token: string;
    traceId: string;
  }): Promise<LoginResult>;
  completeOwnerBootstrap(input: {
    code: string;
    displayName: string;
    newPassword: string;
    setupId: string;
    traceId: string;
    token: string;
  }): Promise<boolean>;
  completePasswordRecovery(input: {
    newPassword: string;
    token: string;
    traceId: string;
  }): Promise<boolean>;
  login(input: {
    email: string;
    host: string;
    password: string;
    traceId: string;
  }): Promise<LoginResult>;
  listSessions(sessionToken: string | undefined): Promise<unknown[]>;
  logout(sessionToken: string | undefined, traceId: string): Promise<void>;
  prepareOwnerBootstrap(input: {
    normalizedEmail: string;
    traceId: string;
    token: string;
  }): Promise<{ recoveryCodes: string[]; setupId: string; uri: string } | undefined>;
  requestPasswordRecovery(input: {
    host: string;
    normalizedEmail: string;
    traceId: string;
  }): Promise<void>;
  revokeSession(input: {
    currentToken: string | undefined;
    sessionId: string;
    traceId: string;
  }): Promise<boolean>;
  verifyMfa(input: {
    challengeId: string;
    code: string;
    host: string;
    traceId: string;
  }): Promise<LoginResult>;
}

export function registerAuthRoutes(server: FastifyInstance, service: AuthEndpointService): void {
  server.post<{
    Body: { displayName?: string; password?: string; token?: string };
  }>(
    '/auth/invitations/accept',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }, preHandler: requireSameOrigin },
    async (request, reply) => {
      const body = request.body;
      if (
        typeof body?.displayName !== 'string' ||
        !body.displayName.trim() ||
        body.displayName.length > 160 ||
        typeof body.password !== 'string' ||
        typeof body.token !== 'string'
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const result = await service.acceptInvitation({
        displayName: body.displayName,
        host: request.hostname,
        password: body.password,
        token: body.token,
        traceId: String(request.id),
      });
      if (result.kind !== 'authenticated') {
        return reply.code(400).send({ error: 'invalid_or_expired_invitation' });
      }
      return reply
        .setCookie('__Host-omnireach_session', result.sessionToken, sessionCookieOptions())
        .code(201)
        .send({ status: 'accepted' });
    },
  );

  server.post<{ Body: { email?: string; password?: string } }>(
    '/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, preHandler: requireSameOrigin },
    async (request, reply) => {
      if (typeof request.body?.email !== 'string' || typeof request.body.password !== 'string') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      let email: string;
      try {
        email = normalizeEmail(request.body.email);
      } catch {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      const result = await service.login({
        email,
        host: request.hostname,
        password: request.body.password,
        traceId: String(request.id),
      });
      if (result.kind === 'invalid') return reply.code(401).send({ error: 'invalid_credentials' });
      if (result.kind === 'mfa-required') {
        return reply.code(202).send({ challengeId: result.challengeId, status: result.kind });
      }
      return reply
        .setCookie('__Host-omnireach_session', result.sessionToken, sessionCookieOptions())
        .code(200)
        .send({ status: result.kind });
    },
  );

  server.post<{ Body: { email?: string; token?: string } }>(
    '/auth/owner-bootstrap/prepare',
    { config: { rateLimit: { max: 3, timeWindow: '15 minutes' } }, preHandler: requireSameOrigin },
    async (request, reply) => {
      if (typeof request.body?.email !== 'string' || typeof request.body.token !== 'string') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      try {
        const prepared = await service.prepareOwnerBootstrap({
          normalizedEmail: normalizeEmail(request.body.email),
          traceId: String(request.id),
          token: request.body.token,
        });
        return prepared
          ? reply.code(200).send(prepared)
          : reply.code(400).send({ error: 'invalid_or_expired_bootstrap' });
      } catch {
        return reply.code(400).send({ error: 'invalid_or_expired_bootstrap' });
      }
    },
  );

  server.post<{
    Body: {
      code?: string;
      displayName?: string;
      newPassword?: string;
      setupId?: string;
      token?: string;
    };
  }>(
    '/auth/owner-bootstrap/complete',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }, preHandler: requireSameOrigin },
    async (request, reply) => {
      const body = request.body;
      if (
        typeof body?.code !== 'string' ||
        typeof body.displayName !== 'string' ||
        !body.displayName.trim() ||
        body.displayName.length > 160 ||
        typeof body.newPassword !== 'string' ||
        typeof body.setupId !== 'string' ||
        typeof body.token !== 'string'
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      try {
        const completed = await service.completeOwnerBootstrap({
          code: body.code,
          displayName: body.displayName,
          newPassword: body.newPassword,
          setupId: body.setupId,
          traceId: String(request.id),
          token: body.token,
        });
        return completed
          ? reply.code(204).send()
          : reply.code(400).send({ error: 'invalid_or_expired_bootstrap' });
      } catch {
        return reply.code(400).send({ error: 'invalid_or_expired_bootstrap' });
      }
    },
  );

  server.post(
    '/auth/logout',
    { preHandler: requireSameOrigin },
    async (request: FastifyRequest, reply) => {
      await service.logout(sessionToken(request), String(request.id));
      return reply.clearCookie('__Host-omnireach_session', sessionCookieOptions()).code(204).send();
    },
  );

  server.post<{ Body: { challengeId?: string; code?: string } }>(
    '/auth/mfa/verify',
    { config: { rateLimit: { max: 5, timeWindow: '5 minutes' } }, preHandler: requireSameOrigin },
    async (request, reply) => {
      if (typeof request.body?.challengeId !== 'string' || typeof request.body.code !== 'string') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const result = await service.verifyMfa({
        challengeId: request.body.challengeId,
        code: request.body.code,
        host: request.hostname,
        traceId: String(request.id),
      });
      if (result.kind !== 'authenticated') {
        return reply.code(401).send({ error: 'invalid_challenge' });
      }
      return reply
        .setCookie('__Host-omnireach_session', result.sessionToken, sessionCookieOptions())
        .code(200)
        .send({ status: 'authenticated' });
    },
  );

  server.post<{ Body: { email?: string } }>(
    '/auth/recovery',
    { config: { rateLimit: { max: 3, timeWindow: '15 minutes' } }, preHandler: requireSameOrigin },
    async (request, reply) => {
      try {
        if (typeof request.body?.email === 'string') {
          await service.requestPasswordRecovery({
            host: request.hostname,
            normalizedEmail: normalizeEmail(request.body.email),
            traceId: String(request.id),
          });
        }
      } catch {
        // Recovery is deliberately non-enumerating.
      }
      return reply.code(202).send({ status: 'accepted' });
    },
  );

  server.post<{ Body: { newPassword?: string; token?: string } }>(
    '/auth/recovery/complete',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }, preHandler: requireSameOrigin },
    async (request, reply) => {
      if (typeof request.body?.newPassword !== 'string' || typeof request.body.token !== 'string') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const completed = await service.completePasswordRecovery({
        newPassword: request.body.newPassword,
        token: request.body.token,
        traceId: String(request.id),
      });
      return completed
        ? reply.code(204).send()
        : reply.code(400).send({ error: 'invalid_or_expired_recovery' });
    },
  );

  server.get('/auth/sessions', async (request, reply) => {
    const sessions = await service.listSessions(sessionToken(request));
    return reply.code(200).send({ sessions });
  });

  server.delete<{ Params: { sessionId?: string } }>(
    '/auth/sessions/:sessionId',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const sessionId = z.string().uuid().safeParse(request.params?.sessionId);
      if (!sessionId.success) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const revoked = await service.revokeSession({
        currentToken: sessionToken(request),
        sessionId: sessionId.data,
        traceId: String(request.id),
      });
      return revoked ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
    },
  );
}

function sessionToken(request: FastifyRequest): string | undefined {
  return readCookie(request, '__Host-omnireach_session');
}
