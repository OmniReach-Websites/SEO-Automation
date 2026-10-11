import { buildApiServer } from '@omnireach/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

const servers = [] as ReturnType<typeof buildApiServer>[];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe('authentication route safety', () => {
  it('accepts an invitation only on its same-origin admin host and issues a host-only cookie', async () => {
    const acceptInvitation = vi.fn(async () => ({
      kind: 'authenticated' as const,
      sessionToken: 'invited-session-token',
    }));
    const server = buildApiServer({
      authService: {
        acceptInvitation,
        completeOwnerBootstrap: vi.fn(async () => false),
        completePasswordRecovery: vi.fn(async () => false),
        listSessions: vi.fn(async () => []),
        login: vi.fn(async () => ({ kind: 'invalid' as const })),
        logout: vi.fn(async () => undefined),
        prepareOwnerBootstrap: vi.fn(async () => undefined),
        requestPasswordRecovery: vi.fn(async () => undefined),
        revokeSession: vi.fn(async () => false),
        verifyMfa: vi.fn(async () => ({ kind: 'invalid' as const })),
      },
      logLevel: 'silent',
    });
    servers.push(server);
    const response = await server.inject({
      headers: { host: 'admin.alpha.test', origin: 'https://admin.alpha.test' },
      method: 'POST',
      payload: {
        displayName: 'Invited Owner',
        password: 'fictional-invited-password',
        token: 'fictional-invitation-token',
      },
      url: '/auth/invitations/accept',
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers['set-cookie']).toContain(
      '__Host-omnireach_session=invited-session-token',
    );
    expect(response.headers['set-cookie']).not.toContain('Domain=');
    expect(acceptInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'admin.alpha.test', traceId: expect.any(String) }),
    );
  });

  it('requires same-origin one-time owner setup before accepting the first owner', async () => {
    const prepareOwnerBootstrap = vi.fn(async () => ({
      recoveryCodes: ['AAAA-BBBB-CCCC-DDDD'],
      setupId: 'setup-a',
      uri: 'otpauth://totp/OmniReach%3Aowner%40example.test?secret=FICTIONAL',
    }));
    const completeOwnerBootstrap = vi.fn(async () => true);
    const server = buildApiServer({
      authService: {
        acceptInvitation: vi.fn(async () => ({ kind: 'invalid' as const })),
        completeOwnerBootstrap,
        completePasswordRecovery: vi.fn(async () => true),
        login: vi.fn(async () => ({ kind: 'invalid' as const })),
        listSessions: vi.fn(async () => []),
        logout: vi.fn(async () => undefined),
        prepareOwnerBootstrap,
        requestPasswordRecovery: vi.fn(async () => undefined),
        revokeSession: vi.fn(async () => false),
        verifyMfa: vi.fn(async () => ({ kind: 'invalid' as const })),
      },
      logLevel: 'silent',
    });
    servers.push(server);
    const prepared = await server.inject({
      headers: { host: 'admin.fictional.test', origin: 'https://admin.fictional.test' },
      method: 'POST',
      payload: { email: 'OWNER@EXAMPLE.TEST', token: 'bootstrap-token' },
      url: '/auth/owner-bootstrap/prepare',
    });
    expect(prepared.statusCode).toBe(200);
    expect(prepareOwnerBootstrap).toHaveBeenCalledWith({
      normalizedEmail: 'owner@example.test',
      token: 'bootstrap-token',
      traceId: expect.any(String),
    });

    const completed = await server.inject({
      headers: { host: 'admin.fictional.test', origin: 'https://admin.fictional.test' },
      method: 'POST',
      payload: {
        code: '123456',
        displayName: 'Platform Owner',
        newPassword: 'fictional-owner-password',
        setupId: 'setup-a',
        token: 'bootstrap-token',
      },
      url: '/auth/owner-bootstrap/complete',
    });
    expect(completed.statusCode).toBe(204);
    expect(completeOwnerBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Platform Owner', setupId: 'setup-a' }),
    );

    const crossOrigin = await server.inject({
      headers: { host: 'admin.fictional.test', origin: 'https://attacker.test' },
      method: 'POST',
      payload: { email: 'owner@example.test', token: 'bootstrap-token' },
      url: '/auth/owner-bootstrap/prepare',
    });
    expect(crossOrigin.statusCode).toBe(403);
  });

  it('sets a secure host-only session cookie after successful login', async () => {
    const server = buildApiServer({
      authService: {
        acceptInvitation: vi.fn(async () => ({ kind: 'invalid' as const })),
        completeOwnerBootstrap: vi.fn(async () => true),
        completePasswordRecovery: vi.fn(async () => true),
        login: vi.fn(async () => ({
          kind: 'authenticated' as const,
          sessionToken: 'fictional-session-token',
        })),
        listSessions: vi.fn(async () => []),
        logout: vi.fn(async () => undefined),
        prepareOwnerBootstrap: vi.fn(async () => undefined),
        requestPasswordRecovery: vi.fn(async () => undefined),
        revokeSession: vi.fn(async () => true),
        verifyMfa: vi.fn(async () => ({
          kind: 'authenticated' as const,
          sessionToken: 'fictional-mfa-session-token',
        })),
      },
    });
    servers.push(server);
    const response = await server.inject({
      headers: { host: 'admin.fictional.test', origin: 'https://admin.fictional.test' },
      method: 'POST',
      payload: { email: 'OWNER@EXAMPLE.TEST', password: 'fictional-password' },
      url: '/auth/login',
    });
    expect(response.statusCode).toBe(200);
    const cookie = response.headers['set-cookie'];
    expect(cookie).toContain('__Host-omnireach_session=fictional-session-token');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Domain=');
  });

  it('rejects cross-origin login and keeps recovery responses non-enumerating', async () => {
    const service = {
      acceptInvitation: vi.fn(async () => ({ kind: 'invalid' as const })),
      completeOwnerBootstrap: vi.fn(async () => false),
      completePasswordRecovery: vi.fn(async () => false),
      login: vi.fn(async () => ({ kind: 'invalid' as const })),
      listSessions: vi.fn(async () => []),
      logout: vi.fn(async () => undefined),
      prepareOwnerBootstrap: vi.fn(async () => undefined),
      requestPasswordRecovery: vi.fn(async () => Promise.reject(new Error('missing user'))),
      revokeSession: vi.fn(async () => false),
      verifyMfa: vi.fn(async () => ({ kind: 'invalid' as const })),
    };
    const server = buildApiServer({ authService: service });
    servers.push(server);
    const rejected = await server.inject({
      headers: { host: 'admin.fictional.test', origin: 'https://attacker.test' },
      method: 'POST',
      payload: { email: 'owner@example.test', password: 'fictional-password' },
      url: '/auth/login',
    });
    expect(rejected.statusCode).toBe(403);
    expect(service.login).not.toHaveBeenCalled();

    const recovery = await server.inject({
      headers: { host: 'admin.fictional.test', origin: 'https://admin.fictional.test' },
      method: 'POST',
      payload: { email: 'missing@example.test' },
      url: '/auth/recovery',
    });
    expect(recovery.statusCode).toBe(202);
    expect(recovery.json()).toEqual({ status: 'accepted' });
    expect(service.requestPasswordRecovery).toHaveBeenCalledWith({
      host: 'admin.fictional.test',
      normalizedEmail: 'missing@example.test',
      traceId: expect.any(String),
    });

    const recoveryPage = await server.inject({
      headers: { host: 'admin.fictional.test' },
      method: 'GET',
      url: `/auth/recovery?token=${'A'.repeat(43)}`,
    });
    expect(recoveryPage.statusCode).toBe(200);
    expect(recoveryPage.body).toContain('Choose a new password');
    expect(recoveryPage.body).toContain(`value="${'A'.repeat(43)}"`);
    expect(recoveryPage.headers['content-security-policy']).toContain("form-action 'self'");

    const invitationPage = await server.inject({
      headers: { host: 'admin.fictional.test' },
      method: 'GET',
      url: `/auth/invitations/accept?token=${'B'.repeat(43)}`,
    });
    expect(invitationPage.statusCode).toBe(200);
    expect(invitationPage.body).toContain('Accept your invitation');
    expect(invitationPage.body).toContain(`value="${'B'.repeat(43)}"`);

    const missingOrigin = await server.inject({
      headers: { host: 'admin.fictional.test' },
      method: 'POST',
      payload: { email: 'owner@example.test', password: 'fictional-password' },
      url: '/auth/login',
    });
    expect(missingOrigin.statusCode).toBe(403);
    expect(service.login).not.toHaveBeenCalled();
  });

  it('completes MFA before issuing a session and supports scoped session revocation', async () => {
    const verifyMfa = vi.fn(async () => ({
      kind: 'authenticated' as const,
      sessionToken: 'fictional-mfa-session-token',
    }));
    const revokeSession = vi.fn(async () => true);
    const server = buildApiServer({
      authService: {
        acceptInvitation: vi.fn(async () => ({ kind: 'invalid' as const })),
        completeOwnerBootstrap: vi.fn(async () => true),
        completePasswordRecovery: vi.fn(async () => true),
        listSessions: vi.fn(async () => [{ createdAt: '2026-10-10T00:00:00Z', id: 'session-a' }]),
        login: vi.fn(async () => ({ challengeId: 'challenge-a', kind: 'mfa-required' as const })),
        logout: vi.fn(async () => undefined),
        prepareOwnerBootstrap: vi.fn(async () => undefined),
        requestPasswordRecovery: vi.fn(async () => undefined),
        revokeSession,
        verifyMfa,
      },
      logLevel: 'silent',
    });
    servers.push(server);
    const challenge = await server.inject({
      headers: { host: 'admin.fictional.test', origin: 'https://admin.fictional.test' },
      method: 'POST',
      payload: { email: 'owner@example.test', password: 'fictional-password' },
      url: '/auth/login',
    });
    expect(challenge.statusCode).toBe(202);
    expect(challenge.headers['set-cookie']).toBeUndefined();

    const formChallenge = await server.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        host: 'admin.fictional.test',
        origin: 'https://admin.fictional.test',
      },
      method: 'POST',
      payload: 'email=owner%40example.test&password=fictional-password',
      url: '/auth/login',
    });
    expect(formChallenge.statusCode).toBe(303);
    expect(formChallenge.headers.location).toBe('/mfa?challengeId=challenge-a');

    const mfaPage = await server.inject({
      headers: { host: 'admin.fictional.test' },
      method: 'GET',
      url: '/mfa?challengeId=challenge-a',
    });
    expect(mfaPage.body).toContain('action="/auth/mfa/verify"');
    expect(mfaPage.body).toContain('value="challenge-a"');

    const verified = await server.inject({
      headers: { host: 'admin.fictional.test', origin: 'https://admin.fictional.test' },
      method: 'POST',
      payload: { challengeId: 'challenge-a', code: '123456' },
      url: '/auth/mfa/verify',
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.headers['set-cookie']).toContain('fictional-mfa-session-token');

    const verifiedForm = await server.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        host: 'admin.fictional.test',
        origin: 'https://admin.fictional.test',
      },
      method: 'POST',
      payload: 'challengeId=challenge-a&code=123456',
      url: '/auth/mfa/verify',
    });
    expect(verifiedForm.statusCode).toBe(303);
    expect(verifiedForm.headers.location).toBe('/orap/sites');
    expect(verifiedForm.headers['set-cookie']).toContain('fictional-mfa-session-token');

    const revoked = await server.inject({
      cookies: { '__Host-omnireach_session': 'current-token' },
      headers: { host: 'admin.fictional.test', origin: 'https://admin.fictional.test' },
      method: 'DELETE',
      url: '/auth/sessions/00000000-0000-4000-8000-000000000001',
    });
    expect(revoked.statusCode).toBe(204);
    expect(revokeSession).toHaveBeenCalledWith({
      currentToken: 'current-token',
      sessionId: '00000000-0000-4000-8000-000000000001',
      traceId: expect.any(String),
    });
  });
});
