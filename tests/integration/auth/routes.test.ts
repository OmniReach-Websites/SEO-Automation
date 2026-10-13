import { buildApiServer } from '@omnireach/api';
import type { WebAuthnEnrollmentPreparation } from '@omnireach/auth';
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
      method: 'totp' as const,
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
      host: 'admin.fictional.test',
      method: 'totp',
      networkIdentifier: '127.0.0.0/24',
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
        recoveryCodesAcknowledged: true,
        setupId: 'setup-a',
        token: 'bootstrap-token',
      },
      url: '/auth/owner-bootstrap/complete',
    });
    expect(completed.statusCode).toBe(204);
    expect(completeOwnerBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'Platform Owner',
        recoveryCodesAcknowledged: true,
        setupId: 'setup-a',
      }),
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
    expect(response.headers['referrer-policy']).toBe('same-origin');
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

    const rejectedForm = await server.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        host: 'admin.fictional.test',
        origin: 'https://attacker.test',
      },
      method: 'POST',
      payload: 'email=owner%40example.test&password=fictional-password',
      url: '/auth/login',
    });
    expect(rejectedForm.statusCode).toBe(403);
    expect(rejectedForm.headers['content-type']).toContain('text/html');
    expect(rejectedForm.body).toContain('Request blocked');
    expect(rejectedForm.body).not.toContain('origin_rejected');

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
      networkIdentifier: '127.0.0.0/24',
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

    const invalidForm = await server.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        host: 'admin.fictional.test',
        origin: 'https://admin.fictional.test',
      },
      method: 'POST',
      payload: 'email=owner%40example.test&password=incorrect-password',
      url: '/auth/login',
    });
    expect(invalidForm.statusCode).toBe(303);
    expect(invalidForm.headers.location).toBe('/login?error=credentials');

    const invalidPage = await server.inject({
      headers: { host: 'admin.fictional.test' },
      method: 'GET',
      url: '/login?error=credentials',
    });
    expect(invalidPage.statusCode).toBe(200);
    expect(invalidPage.body).toContain('email address or password was not accepted');
  });

  it('completes MFA before issuing a session and supports scoped session revocation', async () => {
    const verifyMfa = vi.fn(async () => ({
      audience: 'platform' as 'customer' | 'platform',
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
    expect(formChallenge.headers.location).toBe('/mfa');
    expect(formChallenge.headers['set-cookie']).toContain('__Host-omnireach_challenge=challenge-a');

    const mfaPage = await server.inject({
      cookies: { '__Host-omnireach_challenge': 'challenge-a' },
      headers: { host: 'admin.fictional.test' },
      method: 'GET',
      url: '/mfa',
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

    verifyMfa.mockResolvedValueOnce({
      audience: 'customer',
      kind: 'authenticated',
      sessionToken: 'fictional-customer-session-token',
    });
    const customerVerifiedForm = await server.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        host: 'admin.customer.test',
        origin: 'https://admin.customer.test',
      },
      method: 'POST',
      payload: 'challengeId=customer-challenge-a&code=12345678',
      url: '/auth/mfa/verify',
    });
    expect(customerVerifiedForm.statusCode).toBe(303);
    expect(customerVerifiedForm.headers.location).toBe('/');
    expect(customerVerifiedForm.headers['set-cookie']).toContain(
      'fictional-customer-session-token',
    );

    const revoked = await server.inject({
      cookies: { '__Host-omnireach_session': 'current-token' },
      headers: { host: 'admin.fictional.test', origin: 'https://admin.fictional.test' },
      method: 'DELETE',
      url: '/auth/sessions/00000000-0000-4000-8000-000000000001',
    });
    expect(revoked.statusCode).toBe(204);
    expect(revokeSession).toHaveBeenCalledWith({
      currentToken: 'current-token',
      host: 'admin.fictional.test',
      sessionId: '00000000-0000-4000-8000-000000000001',
      traceId: expect.any(String),
    });
  });

  it('supports customer email security changes and restricted recovery without issuing broad sessions', async () => {
    const prepareCustomerEmailCodePolicyChange = vi.fn(async () => ({
      challengeId: 'security-challenge-a',
    }));
    const completeCustomerEmailCodePolicyChange = vi.fn(async () => ({
      recoveryCodes: ['AAAA-BBBB-CCCC-DDDD'],
      sessionsRevoked: true as const,
    }));
    const completeCustomerRecovery = vi.fn(async () => ({
      recoveryCodes: ['EEEE-FFFF-0000-1111'],
      sessionsRevoked: true as const,
    }));
    const acceptInvitation = vi.fn(async () => ({
      challengeId: 'invitation-challenge-a',
      kind: 'mfa-required' as const,
      methods: ['email_code'],
    }));
    const server = buildApiServer({
      authService: {
        acceptInvitation,
        completeCustomerEmailCodePolicyChange,
        completeCustomerRecovery,
        completeOwnerBootstrap: vi.fn(async () => false),
        completePasswordRecovery: vi.fn(async () => false),
        listSessions: vi.fn(async () => []),
        login: vi.fn(async () => ({ kind: 'invalid' as const })),
        logout: vi.fn(async () => undefined),
        prepareCustomerEmailCodePolicyChange,
        prepareOwnerBootstrap: vi.fn(async () => undefined),
        requestPasswordRecovery: vi.fn(async () => undefined),
        revokeSession: vi.fn(async () => false),
        securitySettings: vi.fn(async () => ({
          emailCodeEnabled: false,
          emailPolicyChangeAllowed: true,
          secondStepRequired: false,
          totpEnabled: false,
          webauthnEnrollmentAvailable: false,
          webauthnEnabled: false,
        })),
        verifyMfa: vi.fn(async () => ({ kind: 'invalid' as const })),
      },
      logLevel: 'silent',
    });
    servers.push(server);

    const securityPage = await server.inject({
      cookies: { '__Host-omnireach_session': 'customer-session' },
      headers: { host: 'admin.alpha.test' },
      method: 'GET',
      url: '/security',
    });
    expect(securityPage.statusCode).toBe(200);
    expect(securityPage.body).toContain('Security settings');
    expect(securityPage.body).toContain('/auth/security/email/prepare');

    const prepared = await server.inject({
      cookies: { '__Host-omnireach_session': 'customer-session' },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        host: 'admin.alpha.test',
        origin: 'https://admin.alpha.test',
      },
      method: 'POST',
      payload: 'action=enable&currentPassword=fictional-password',
      url: '/auth/security/email/prepare',
    });
    expect(prepared.statusCode).toBe(303);
    expect(prepared.headers.location).toBe('/security/email?action=enable');
    expect(prepared.headers['set-cookie']).toContain(
      '__Host-omnireach_challenge=security-challenge-a',
    );
    expect(prepareCustomerEmailCodePolicyChange).toHaveBeenCalledWith({
      currentPassword: 'fictional-password',
      enabled: true,
      host: 'admin.alpha.test',
      networkIdentifier: '127.0.0.0/24',
      sessionToken: 'customer-session',
      traceId: expect.any(String),
    });

    const completed = await server.inject({
      cookies: { '__Host-omnireach_session': 'customer-session' },
      headers: { host: 'admin.alpha.test', origin: 'https://admin.alpha.test' },
      method: 'POST',
      payload: { challengeId: 'security-challenge-a', code: '12345678' },
      url: '/auth/security/email/complete',
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toEqual({
      recoveryCodes: ['AAAA-BBBB-CCCC-DDDD'],
      sessionsRevoked: true,
    });
    expect(completed.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('__Host-omnireach_session=;')]),
    );

    const recoveryPage = await server.inject({
      cookies: { '__Host-omnireach_session': 'restricted-session' },
      headers: { host: 'admin.alpha.test' },
      method: 'GET',
      url: '/security/recovery',
    });
    expect(recoveryPage.statusCode).toBe(200);
    expect(recoveryPage.body).toContain('Complete account recovery');
    expect(recoveryPage.body).toContain('name="currentPassword"');
    expect(recoveryPage.body).toContain('name="recoveryConfirmed"');

    const unconfirmedRecovery = await server.inject({
      cookies: { '__Host-omnireach_session': 'restricted-session' },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        host: 'admin.alpha.test',
        origin: 'https://admin.alpha.test',
      },
      method: 'POST',
      payload: 'currentPassword=fictional-secure-password',
      url: '/auth/security/recovery/complete',
    });
    expect(unconfirmedRecovery.statusCode).toBe(400);
    expect(completeCustomerRecovery).not.toHaveBeenCalled();

    const recoveryCompleted = await server.inject({
      cookies: { '__Host-omnireach_session': 'restricted-session' },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        host: 'admin.alpha.test',
        origin: 'https://admin.alpha.test',
      },
      method: 'POST',
      payload: 'currentPassword=fictional-secure-password&recoveryConfirmed=true',
      url: '/auth/security/recovery/complete',
    });
    expect(recoveryCompleted.statusCode).toBe(200);
    expect(recoveryCompleted.body).toContain('EEEE-FFFF-0000-1111');
    expect(String(recoveryCompleted.headers['set-cookie'])).toContain('__Host-omnireach_session=;');
    expect(completeCustomerRecovery).toHaveBeenCalledWith({
      currentPassword: 'fictional-secure-password',
      host: 'admin.alpha.test',
      networkIdentifier: '127.0.0.0/24',
      recoveryConfirmed: true,
      sessionToken: 'restricted-session',
      traceId: expect.any(String),
    });

    const invitation = await server.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        host: 'admin.alpha.test',
        origin: 'https://admin.alpha.test',
      },
      method: 'POST',
      payload: 'displayName=Customer&password=fictional-password&token=invitation-token',
      url: '/auth/invitations/accept',
    });
    expect(invitation.statusCode).toBe(303);
    expect(invitation.headers.location).toBe('/mfa?email=1');
    expect(invitation.headers['set-cookie']).toContain(
      '__Host-omnireach_challenge=invitation-challenge-a',
    );
  });

  it('renders privileged security settings inside the functional ORAP shell', async () => {
    const server = buildApiServer({
      authService: {
        acceptInvitation: vi.fn(async () => ({ kind: 'invalid' as const })),
        completeOwnerBootstrap: vi.fn(async () => false),
        completePasswordRecovery: vi.fn(async () => false),
        listSessions: vi.fn(async () => []),
        login: vi.fn(async () => ({ kind: 'invalid' as const })),
        logout: vi.fn(async () => undefined),
        prepareOwnerBootstrap: vi.fn(async () => undefined),
        requestPasswordRecovery: vi.fn(async () => undefined),
        revokeSession: vi.fn(async () => false),
        securitySettings: vi.fn(async () => ({
          emailCodeEnabled: true,
          emailPolicyChangeAllowed: false,
          secondStepRequired: true,
          totpEnabled: false,
          webauthnEnrollmentAvailable: false,
          webauthnEnabled: false,
        })),
        verifyMfa: vi.fn(async () => ({ kind: 'invalid' as const })),
      },
      logLevel: 'silent',
      resolvePlatformActor: vi.fn(async () => ({
        id: '40000000-0000-4000-8000-000000000001',
        role: 'platform_owner' as const,
        traceId: 'privileged-security-page',
      })),
    });
    servers.push(server);

    const page = await server.inject({
      cookies: { '__Host-omnireach_session': 'platform-session' },
      headers: { host: 'admin.omnireach.test' },
      method: 'GET',
      url: '/security',
    });

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('href="/assets/admin.css?v=orap-3"');
    expect(page.body).toContain('href="/assets/omnireach-logo.png"');
    expect(page.body).toContain('href="/orap/operations"');
    expect(page.body).toContain('href="/security" aria-current="page"');
    expect(page.body).toContain('Two-step verification is <strong>required</strong>');
  });

  it('serves exact-origin passkey enrollment UI and revokes the current cookie on completion', async () => {
    const prepareWebAuthnEnrollment = vi.fn(
      async () =>
        ({
          ceremonyId: 'fictional-ceremony',
          options: {
            attestation: 'none',
            authenticatorSelection: { userVerification: 'required' },
            challenge: 'fictional_challenge',
            excludeCredentials: [],
            pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
            rp: { id: 'admin.alpha.test', name: 'OmniReach' },
            timeout: 300_000,
            user: {
              displayName: 'Customer Owner',
              id: 'Bw',
              name: 'owner@example.test',
            },
          },
          recoveryCodes: ['AAAA-BBBB-CCCC-DDDD'],
        }) satisfies WebAuthnEnrollmentPreparation,
    );
    const completeWebAuthnEnrollment = vi.fn(async () => ({ sessionsRevoked: true as const }));
    const server = buildApiServer({
      authService: {
        acceptInvitation: vi.fn(async () => ({ kind: 'invalid' as const })),
        completeOwnerBootstrap: vi.fn(async () => false),
        completePasswordRecovery: vi.fn(async () => false),
        completeWebAuthnEnrollment,
        listSessions: vi.fn(async () => []),
        login: vi.fn(async () => ({ kind: 'invalid' as const })),
        logout: vi.fn(async () => undefined),
        prepareOwnerBootstrap: vi.fn(async () => undefined),
        prepareWebAuthnEnrollment,
        requestPasswordRecovery: vi.fn(async () => undefined),
        revokeSession: vi.fn(async () => false),
        securitySettings: vi.fn(async () => ({
          emailCodeEnabled: true,
          emailPolicyChangeAllowed: true,
          secondStepRequired: false,
          totpEnabled: false,
          webauthnEnabled: false,
          webauthnEnrollmentAvailable: true,
        })),
        verifyMfa: vi.fn(async () => ({ kind: 'invalid' as const })),
      },
      logLevel: 'silent',
    });
    servers.push(server);

    const page = await server.inject({
      cookies: { '__Host-omnireach_session': 'customer-session' },
      headers: { host: 'admin.alpha.test' },
      method: 'GET',
      url: '/security',
    });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('id="passkey-enrollment"');
    expect(page.body).toContain('/security/passkey.js');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect(page.headers['content-security-policy']).toContain("connect-src 'self'");

    const script = await server.inject({ method: 'GET', url: '/security/passkey.js' });
    expect(script.statusCode).toBe(200);
    expect(script.headers['content-type']).toContain('application/javascript');
    expect(script.body).toContain('navigator.credentials.create');
    expect(script.body).not.toContain('localStorage');

    const crossOrigin = await server.inject({
      cookies: { '__Host-omnireach_session': 'customer-session' },
      headers: { host: 'admin.alpha.test', origin: 'https://attacker.example' },
      method: 'POST',
      payload: { credentialName: 'Windows Hello', currentPassword: 'fictional-password' },
      url: '/auth/security/webauthn/prepare',
    });
    expect(crossOrigin.statusCode).toBe(403);
    expect(prepareWebAuthnEnrollment).not.toHaveBeenCalled();

    const prepared = await server.inject({
      cookies: { '__Host-omnireach_session': 'customer-session' },
      headers: { host: 'admin.alpha.test', origin: 'https://admin.alpha.test' },
      method: 'POST',
      payload: { credentialName: 'Windows Hello', currentPassword: 'fictional-password' },
      url: '/auth/security/webauthn/prepare',
    });
    expect(prepared.statusCode).toBe(200);
    expect(prepared.headers['cache-control']).toBe('no-store');
    expect(prepared.headers.pragma).toBe('no-cache');
    expect(prepareWebAuthnEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'admin.alpha.test',
        sessionToken: 'customer-session',
      }),
    );

    const completed = await server.inject({
      cookies: { '__Host-omnireach_session': 'customer-session' },
      headers: { host: 'admin.alpha.test', origin: 'https://admin.alpha.test' },
      method: 'POST',
      payload: {
        ceremonyId: 'fictional-ceremony',
        recoveryCodesAcknowledged: true,
        response: {
          clientExtensionResults: {},
          id: 'AQID',
          rawId: 'AQID',
          response: { attestationObject: 'AQ', clientDataJSON: 'AQ', transports: ['internal'] },
          type: 'public-key',
        },
      },
      url: '/auth/security/webauthn/complete',
    });
    expect(completed.statusCode).toBe(200);
    expect(String(completed.headers['set-cookie'])).toContain('__Host-omnireach_session=;');
    expect(completeWebAuthnEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'admin.alpha.test',
        recoveryCodesAcknowledged: true,
        sessionToken: 'customer-session',
      }),
    );
  });
});
