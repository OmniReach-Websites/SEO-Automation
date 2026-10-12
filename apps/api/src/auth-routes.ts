import {
  normalizeEmail,
  sessionCookieOptions,
  type AccountSecuritySettings,
  type EmailCodePolicyChangeResult,
  type WebAuthnEnrollmentPreparation,
  type WebAuthnRegistrationResponse,
} from '@omnireach/auth';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireSameOrigin } from './request-security.ts';
import { readCookie } from './request-auth.ts';
import { clientNetworkIdentifier } from './client-network.ts';

export type LoginResult =
  | {
      audience?: 'customer' | 'platform';
      kind: 'authenticated';
      recoveryRestricted?: true;
      sessionToken: string;
    }
  | { challengeId: string; kind: 'mfa-required'; methods?: string[] }
  | { kind: 'invalid' };

const challengeCookieName = '__Host-omnireach_challenge';
const base64UrlValue = z
  .string()
  .min(1)
  .max(32_768)
  .regex(/^[A-Za-z0-9_-]+$/u);
const webAuthnRegistrationResponseSchema = z
  .object({
    authenticatorAttachment: z.enum(['cross-platform', 'platform']).optional(),
    clientExtensionResults: z.record(z.string(), z.unknown()),
    id: base64UrlValue,
    rawId: base64UrlValue,
    response: z
      .object({
        attestationObject: base64UrlValue,
        authenticatorData: base64UrlValue.optional(),
        clientDataJSON: base64UrlValue,
        publicKey: base64UrlValue.optional(),
        publicKeyAlgorithm: z.number().int().optional(),
        transports: z.array(z.string().min(1).max(32)).max(8).optional(),
      })
      .strict(),
    type: z.literal('public-key'),
  })
  .strict();

export interface AuthEndpointService {
  acceptInvitation(input: {
    displayName: string;
    host: string;
    networkIdentifier?: string;
    password: string;
    token: string;
    traceId: string;
  }): Promise<LoginResult>;
  completeOwnerBootstrap(input: {
    code: string;
    displayName: string;
    host: string;
    networkIdentifier?: string;
    newPassword: string;
    recoveryCodesAcknowledged: boolean;
    setupId: string;
    traceId: string;
    token: string;
  }): Promise<boolean>;
  completePasswordRecovery(input: {
    host: string;
    networkIdentifier?: string;
    newPassword: string;
    token: string;
    traceId: string;
  }): Promise<boolean>;
  login(input: {
    email: string;
    host: string;
    networkIdentifier?: string;
    password: string;
    traceId: string;
  }): Promise<LoginResult>;
  listSessions(sessionToken: string | undefined, host: string): Promise<unknown[]>;
  logout(sessionToken: string | undefined, host: string, traceId: string): Promise<void>;
  prepareOwnerBootstrap(input: {
    host: string;
    method?: 'email_code' | 'totp';
    networkIdentifier?: string;
    normalizedEmail: string;
    traceId: string;
    token: string;
  }): Promise<
    | {
        method: 'email_code' | 'totp';
        recoveryCodes: string[];
        setupId: string;
        uri?: string;
      }
    | undefined
  >;
  prepareCustomerEmailCodePolicyChange?(input: {
    currentPassword: string;
    enabled: boolean;
    host: string;
    networkIdentifier?: string;
    sessionToken: string | undefined;
    traceId: string;
  }): Promise<{ challengeId: string } | undefined>;
  prepareWebAuthnEnrollment?(input: {
    credentialName: string;
    currentPassword: string;
    host: string;
    networkIdentifier?: string;
    sessionToken: string | undefined;
    traceId: string;
  }): Promise<WebAuthnEnrollmentPreparation | undefined>;
  requestPasswordRecovery(input: {
    host: string;
    networkIdentifier?: string;
    normalizedEmail: string;
    traceId: string;
  }): Promise<void>;
  revokeSession(input: {
    currentToken: string | undefined;
    host: string;
    sessionId: string;
    traceId: string;
  }): Promise<boolean>;
  completeCustomerEmailCodePolicyChange?(input: {
    challengeId: string;
    code: string;
    host: string;
    networkIdentifier?: string;
    sessionToken: string | undefined;
    traceId: string;
  }): Promise<EmailCodePolicyChangeResult>;
  completeCustomerRecovery?(input: {
    currentPassword: string;
    host: string;
    networkIdentifier?: string;
    recoveryConfirmed: boolean;
    sessionToken: string | undefined;
    traceId: string;
  }): Promise<{ recoveryCodes: string[]; sessionsRevoked: true } | undefined>;
  completeWebAuthnEnrollment?(input: {
    ceremonyId: string;
    host: string;
    networkIdentifier?: string;
    recoveryCodesAcknowledged: boolean;
    response: WebAuthnRegistrationResponse;
    sessionToken: string | undefined;
    traceId: string;
  }): Promise<{ sessionsRevoked: true } | undefined>;
  resendEmailCode?(input: {
    challengeId: string;
    host: string;
    networkIdentifier?: string;
    sessionToken?: string;
  }): Promise<'cooldown' | 'sent' | 'unavailable'>;
  securitySettings?(
    sessionToken: string | undefined,
    host: string,
  ): Promise<AccountSecuritySettings | undefined>;
  verifyMfa(input: {
    challengeId: string;
    code: string;
    host: string;
    networkIdentifier?: string;
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
        networkIdentifier: clientNetworkIdentifier(request.ip),
        password: body.password,
        token: body.token,
        traceId: String(request.id),
      });
      if (result.kind === 'invalid') {
        return reply.code(400).send({ error: 'invalid_or_expired_invitation' });
      }
      if (result.kind === 'mfa-required') {
        if (isFormSubmission(request)) {
          return reply
            .setCookie(challengeCookieName, result.challengeId, sessionCookieOptions(300))
            .code(303)
            .redirect(mfaLocation(result.methods));
        }
        return reply.code(202).send({ challengeId: result.challengeId, status: result.kind });
      }
      const authenticated = reply.setCookie(
        '__Host-omnireach_session',
        result.sessionToken,
        sessionCookieOptions(),
      );
      return isFormSubmission(request)
        ? authenticated.code(303).redirect('/')
        : authenticated.code(201).send({ status: 'accepted' });
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
        networkIdentifier: clientNetworkIdentifier(request.ip),
        password: request.body.password,
        traceId: String(request.id),
      });
      if (result.kind === 'invalid') return reply.code(401).send({ error: 'invalid_credentials' });
      if (result.kind === 'mfa-required') {
        if (isFormSubmission(request)) {
          return reply
            .setCookie(challengeCookieName, result.challengeId, sessionCookieOptions(300))
            .code(303)
            .redirect(mfaLocation(result.methods));
        }
        return reply.code(202).send({ challengeId: result.challengeId, status: result.kind });
      }
      const authenticated = reply.setCookie(
        '__Host-omnireach_session',
        result.sessionToken,
        sessionCookieOptions(),
      );
      if (isFormSubmission(request)) {
        authenticated.clearCookie(challengeCookieName, sessionCookieOptions(300));
      }
      return isFormSubmission(request)
        ? authenticated.code(303).redirect('/')
        : authenticated.code(200).send({ status: result.kind });
    },
  );

  server.post<{ Body: { email?: string; method?: string; token?: string } }>(
    '/auth/owner-bootstrap/prepare',
    { config: { rateLimit: { max: 3, timeWindow: '15 minutes' } }, preHandler: requireSameOrigin },
    async (request, reply) => {
      if (typeof request.body?.email !== 'string' || typeof request.body.token !== 'string') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      try {
        const method = request.body.method ?? 'totp';
        if (method !== 'email_code' && method !== 'totp') {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const prepared = await service.prepareOwnerBootstrap({
          host: request.hostname,
          method,
          networkIdentifier: clientNetworkIdentifier(request.ip),
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
      recoveryCodesAcknowledged?: boolean;
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
        body.recoveryCodesAcknowledged !== true ||
        typeof body.setupId !== 'string' ||
        typeof body.token !== 'string'
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      try {
        const completed = await service.completeOwnerBootstrap({
          code: body.code,
          displayName: body.displayName,
          host: request.hostname,
          networkIdentifier: clientNetworkIdentifier(request.ip),
          newPassword: body.newPassword,
          recoveryCodesAcknowledged: body.recoveryCodesAcknowledged,
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
      await service.logout(sessionToken(request), request.hostname, String(request.id));
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
        networkIdentifier: clientNetworkIdentifier(request.ip),
        traceId: String(request.id),
      });
      if (result.kind !== 'authenticated') {
        return reply.code(401).send({ error: 'invalid_challenge' });
      }
      const authenticated = reply.setCookie(
        '__Host-omnireach_session',
        result.sessionToken,
        sessionCookieOptions(),
      );
      return isFormSubmission(request)
        ? authenticated
            .code(303)
            .redirect(
              result.recoveryRestricted
                ? '/security/recovery'
                : result.audience === 'platform'
                  ? '/orap/sites'
                  : '/',
            )
        : authenticated.code(200).send({ status: 'authenticated' });
    },
  );

  server.post<{
    Body: { currentPassword?: string; recoveryConfirmed?: boolean | string };
  }>(
    '/auth/security/recovery/complete',
    { config: { rateLimit: { max: 3, timeWindow: '15 minutes' } }, preHandler: requireSameOrigin },
    async (request, reply) => {
      if (!service.completeCustomerRecovery) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const recoveryConfirmed =
        request.body?.recoveryConfirmed === true ||
        request.body?.recoveryConfirmed === 'true' ||
        request.body?.recoveryConfirmed === 'on';
      if (
        typeof request.body?.currentPassword !== 'string' ||
        request.body.currentPassword.length < 1 ||
        request.body.currentPassword.length > 128 ||
        !recoveryConfirmed
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const result = await service.completeCustomerRecovery({
        currentPassword: request.body.currentPassword,
        host: request.hostname,
        networkIdentifier: clientNetworkIdentifier(request.ip),
        recoveryConfirmed,
        sessionToken: sessionToken(request),
        traceId: String(request.id),
      });
      if (!result) return reply.code(403).send({ error: 'recovery_not_allowed' });
      const cleared = reply.clearCookie('__Host-omnireach_session', sessionCookieOptions());
      return isFormSubmission(request)
        ? cleared
            .type('text/html; charset=utf-8')
            .code(200)
            .send(renderCustomerRecoveryCompletion(result.recoveryCodes))
        : cleared.code(200).send(result);
    },
  );

  server.post<{ Body: { challengeId?: string } }>(
    '/auth/mfa/email/resend',
    { config: { rateLimit: { max: 3, timeWindow: '15 minutes' } }, preHandler: requireSameOrigin },
    async (request, reply) => {
      if (typeof request.body?.challengeId !== 'string' || !service.resendEmailCode) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const currentSessionToken = sessionToken(request);
      const result = await service.resendEmailCode({
        challengeId: request.body.challengeId,
        host: request.hostname,
        networkIdentifier: clientNetworkIdentifier(request.ip),
        ...(currentSessionToken ? { sessionToken: currentSessionToken } : {}),
      });
      if (result === 'cooldown') return reply.code(429).send({ error: 'resend_limited' });
      return result === 'sent'
        ? reply.code(202).send({ status: 'accepted' })
        : reply.code(400).send({ error: 'invalid_challenge' });
    },
  );

  server.get('/auth/security', async (request, reply) => {
    if (!service.securitySettings) return reply.code(404).send({ error: 'not_found' });
    const settings = await service.securitySettings(sessionToken(request), request.hostname);
    return settings
      ? reply.code(200).send({ settings })
      : reply.code(401).send({ error: 'authentication_required' });
  });

  server.post<{
    Body: { credentialName?: string; currentPassword?: string };
  }>(
    '/auth/security/webauthn/prepare',
    { config: { rateLimit: { max: 3, timeWindow: '15 minutes' } }, preHandler: requireSameOrigin },
    async (request, reply) => {
      if (
        !service.prepareWebAuthnEnrollment ||
        typeof request.body?.currentPassword !== 'string' ||
        typeof request.body.credentialName !== 'string' ||
        request.body.currentPassword.length < 1 ||
        request.body.currentPassword.length > 128 ||
        request.body.credentialName.length < 1 ||
        request.body.credentialName.length > 80
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const prepared = await service.prepareWebAuthnEnrollment({
        credentialName: request.body.credentialName,
        currentPassword: request.body.currentPassword,
        host: request.hostname,
        networkIdentifier: clientNetworkIdentifier(request.ip),
        sessionToken: sessionToken(request),
        traceId: String(request.id),
      });
      return prepared
        ? reply
            .header('Cache-Control', 'no-store')
            .header('Pragma', 'no-cache')
            .code(200)
            .send(prepared)
        : reply.code(403).send({ error: 'webauthn_enrollment_unavailable' });
    },
  );

  server.post<{
    Body: {
      ceremonyId?: string;
      recoveryCodesAcknowledged?: boolean;
      response?: unknown;
    };
  }>(
    '/auth/security/webauthn/complete',
    {
      bodyLimit: 65_536,
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      preHandler: requireSameOrigin,
    },
    async (request, reply) => {
      const response = webAuthnRegistrationResponseSchema.safeParse(request.body?.response);
      if (
        !service.completeWebAuthnEnrollment ||
        typeof request.body?.ceremonyId !== 'string' ||
        request.body.ceremonyId.length > 512 ||
        request.body.recoveryCodesAcknowledged !== true ||
        !response.success
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const completed = await service.completeWebAuthnEnrollment({
        ceremonyId: request.body.ceremonyId,
        host: request.hostname,
        networkIdentifier: clientNetworkIdentifier(request.ip),
        recoveryCodesAcknowledged: true,
        response: response.data as WebAuthnRegistrationResponse,
        sessionToken: sessionToken(request),
        traceId: String(request.id),
      });
      if (!completed) return reply.code(403).send({ error: 'webauthn_enrollment_failed' });
      return reply
        .clearCookie('__Host-omnireach_session', sessionCookieOptions())
        .code(200)
        .send(completed);
    },
  );

  server.post<{
    Body: { action?: string; currentPassword?: string; enabled?: boolean | string };
  }>(
    '/auth/security/email/prepare',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }, preHandler: requireSameOrigin },
    async (request, reply) => {
      if (!service.prepareCustomerEmailCodePolicyChange) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const enabled = parseEmailPolicyChoice(request.body);
      if (enabled === undefined || typeof request.body?.currentPassword !== 'string') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const prepared = await service.prepareCustomerEmailCodePolicyChange({
        currentPassword: request.body.currentPassword,
        enabled,
        host: request.hostname,
        networkIdentifier: clientNetworkIdentifier(request.ip),
        sessionToken: sessionToken(request),
        traceId: String(request.id),
      });
      if (!prepared) return reply.code(400).send({ error: 'verification_not_started' });
      if (isFormSubmission(request)) {
        const action = enabled ? 'enable' : 'disable';
        return reply
          .setCookie(challengeCookieName, prepared.challengeId, sessionCookieOptions(300))
          .code(303)
          .redirect(`/security/email?action=${action}`);
      }
      return reply
        .code(202)
        .send({ challengeId: prepared.challengeId, status: 'verification_sent' });
    },
  );

  server.post<{ Body: { challengeId?: string; code?: string } }>(
    '/auth/security/email/complete',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }, preHandler: requireSameOrigin },
    async (request, reply) => {
      if (
        !service.completeCustomerEmailCodePolicyChange ||
        typeof request.body?.challengeId !== 'string' ||
        typeof request.body.code !== 'string'
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const result = await service.completeCustomerEmailCodePolicyChange({
        challengeId: request.body.challengeId,
        code: request.body.code,
        host: request.hostname,
        networkIdentifier: clientNetworkIdentifier(request.ip),
        sessionToken: sessionToken(request),
        traceId: String(request.id),
      });
      if (!result) return reply.code(400).send({ error: 'invalid_or_expired_verification' });
      const cleared = reply
        .clearCookie('__Host-omnireach_session', sessionCookieOptions())
        .clearCookie(challengeCookieName, sessionCookieOptions(300));
      return isFormSubmission(request)
        ? cleared
            .type('text/html; charset=utf-8')
            .code(200)
            .send(renderEmailPolicyChangeCompletion(result.recoveryCodes))
        : cleared.code(200).send(result);
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
            networkIdentifier: clientNetworkIdentifier(request.ip),
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
        host: request.hostname,
        networkIdentifier: clientNetworkIdentifier(request.ip),
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
    const sessions = await service.listSessions(sessionToken(request), request.hostname);
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
        host: request.hostname,
        sessionId: sessionId.data,
        traceId: String(request.id),
      });
      return revoked ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
    },
  );
}

function isFormSubmission(request: FastifyRequest): boolean {
  return String(request.headers['content-type'] ?? '')
    .toLowerCase()
    .startsWith('application/x-www-form-urlencoded');
}

function sessionToken(request: FastifyRequest): string | undefined {
  return readCookie(request, '__Host-omnireach_session');
}

function mfaLocation(methods: string[] | undefined): string {
  const parameters = new URLSearchParams();
  if (methods?.includes('email_code')) parameters.set('email', '1');
  const query = parameters.toString();
  return query ? `/mfa?${query}` : '/mfa';
}

function parseEmailPolicyChoice(
  body: { action?: string; enabled?: boolean | string } | undefined,
): boolean | undefined {
  if (body?.action === 'enable') return true;
  if (body?.action === 'disable') return false;
  if (body?.enabled === true || body?.enabled === 'true') return true;
  if (body?.enabled === false || body?.enabled === 'false') return false;
  return undefined;
}

function renderEmailPolicyChangeCompletion(recoveryCodes: string[]): string {
  const result = recoveryCodes.length
    ? `<p>Email verification is enabled. Save these recovery codes now. They will not be shown again.</p><ul>${recoveryCodes.map((code) => `<li><code>${escapeHtml(code)}</code></li>`).join('')}</ul>`
    : '<p>Email verification is disabled. Your other sessions have been signed out.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>Security updated | OmniReach</title></head><body><main><h1>Security updated</h1>${result}<p><a href="/login">Sign in again</a></p></main></body></html>`;
}

function renderCustomerRecoveryCompletion(recoveryCodes: string[]): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>Recovery completed | OmniReach</title></head><body><main><h1>Recovery completed</h1><p>Optional two-step methods and passkeys were disabled, every active session was signed out, and password-reset links were invalidated. Save these replacement recovery codes now. They will not be shown again.</p><ul>${recoveryCodes.map((code) => `<li><code>${escapeHtml(code)}</code></li>`).join('')}</ul><p><a href="/login">Sign in again with your password</a></p></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}
