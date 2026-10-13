import {
  AuthenticationService,
  digestToken,
  hashPassword,
  type AuthenticationRateLimiter,
  type AuthenticationRepository,
  type MfaChallenge,
  type MfaChallengeStore,
} from '@omnireach/auth';
import { describe, expect, it, vi } from 'vitest';

function repository(overrides: Partial<AuthenticationRepository> = {}): AuthenticationRepository {
  return {
    acceptInvitation: vi.fn(async () => undefined),
    clearLoginFailures: vi.fn(async () => undefined),
    completeCustomerRecovery: vi.fn(async () => false),
    completeOwnerBootstrap: vi.fn(async () => false),
    completePasswordRecovery: vi.fn(async () => false),
    consumeTotpCounter: vi.fn(async () => false),
    createPasswordRecovery: vi.fn(async () => undefined),
    createSession: vi.fn(async () => true),
    findAccountSecurityTarget: vi.fn(async () => undefined),
    findLoginTarget: vi.fn(async () => undefined),
    findMfaFactor: vi.fn(async () => undefined),
    findSessionOwner: vi.fn(async () => undefined),
    listSessions: vi.fn(async () => []),
    recordLoginFailure: vi.fn(async () => undefined),
    revokeSession: vi.fn(async () => false),
    revokeSessionByToken: vi.fn(async () => undefined),
    updateCustomerEmailCodePolicy: vi.fn(async () => false),
    updateCustomerTotpPolicy: vi.fn(async () => false),
    checkRecoveryCode: vi.fn(async () => false),
    verifyOwnerBootstrap: vi.fn(async () => false),
    ...overrides,
  };
}

function challengeStore(challenge?: MfaChallenge): MfaChallengeStore {
  return {
    consume: vi.fn(async () => challenge),
    create: vi.fn(async () => 'challenge-a'),
    read: vi.fn(async () => challenge),
    refresh: vi.fn(async () => true),
  };
}

function service(
  repo: AuthenticationRepository,
  limiter: AuthenticationRateLimiter,
  challenges = challengeStore(),
  email = false,
) {
  return new AuthenticationService(
    repo,
    challenges,
    { send: vi.fn(async () => undefined) },
    {
      attemptLimiter: limiter,
      ...(email
        ? {
            emailCodeStore: {
              create: vi.fn(async () => undefined),
              remove: vi.fn(async () => undefined),
              replace: vi.fn(async () => 'updated' as const),
              verify: vi.fn(async () => 'invalid' as const),
            },
            verificationNotifier: { send: vi.fn(async () => undefined) },
          }
        : {}),
      mfaEncryptionKey: 'fictional-dedicated-mfa-key-material-0001',
      now: () => new Date('2026-10-11T12:00:00.000Z'),
      orapHostname: 'admin.omnireach.test',
    },
  );
}

describe('authentication account and network attempt limits', () => {
  it('fails a denied login before looking up an account', async () => {
    const repo = repository();
    const limiter = { consume: vi.fn(async () => false) };
    const auth = service(repo, limiter);

    await expect(
      auth.login({
        email: 'person@example.test',
        host: 'admin.example.test',
        networkIdentifier: '198.51.100.0/24',
        password: 'fictional-password',
        traceId: 'trace-a',
      }),
    ).resolves.toEqual({ kind: 'invalid' });
    expect(repo.findLoginTarget).not.toHaveBeenCalled();
    expect(limiter.consume).toHaveBeenCalledWith({
      accountIdentifier: 'admin.example.test\0person@example.test',
      accountLimit: 10,
      networkIdentifier: '198.51.100.0/24',
      networkLimit: 50,
      scope: 'login_attempt',
      windowSeconds: 900,
    });
  });

  it('rejects invitation acceptance before Argon2 work or repository access when limited', async () => {
    const acceptInvitation = vi.fn(async () => undefined);
    const repo = repository({ acceptInvitation });
    const limiter = { consume: vi.fn(async () => false) };
    const auth = service(repo, limiter);

    await expect(
      auth.acceptInvitation({
        displayName: 'Invited User',
        host: 'admin.example.test',
        networkIdentifier: '198.51.100.0/24',
        password: 'fictional-password',
        token: 'fictional-invitation-token',
        traceId: 'trace-invitation',
      }),
    ).resolves.toEqual({ kind: 'invalid' });
    expect(acceptInvitation).not.toHaveBeenCalled();
    expect(limiter.consume).toHaveBeenCalledWith({
      accountIdentifier: `admin.example.test\0${digestToken('fictional-invitation-token')}`,
      accountLimit: 5,
      networkIdentifier: '198.51.100.0/24',
      networkLimit: 20,
      scope: 'invitation_acceptance',
      windowSeconds: 900,
    });
  });

  it('rejects password-reset completion before Argon2 work or repository access when limited', async () => {
    const completePasswordRecovery = vi.fn(async () => true);
    const repo = repository({ completePasswordRecovery });
    const limiter = { consume: vi.fn(async () => false) };
    const auth = service(repo, limiter);

    await expect(
      auth.completePasswordRecovery({
        host: 'admin.example.test',
        networkIdentifier: '198.51.100.0/24',
        newPassword: 'fictional-replacement-password',
        token: 'fictional-recovery-token',
        traceId: 'trace-recovery-completion',
      }),
    ).resolves.toBe(false);
    expect(completePasswordRecovery).not.toHaveBeenCalled();
    expect(limiter.consume).toHaveBeenCalledWith({
      accountIdentifier: `admin.example.test\0${digestToken('fictional-recovery-token')}`,
      accountLimit: 5,
      networkIdentifier: '198.51.100.0/24',
      networkLimit: 20,
      scope: 'password_recovery_completion',
      windowSeconds: 900,
    });
  });

  it('rejects restricted customer recovery before password work when limited', async () => {
    const completeCustomerRecovery = vi.fn(async () => true);
    const repo = repository({ completeCustomerRecovery });
    const limiter = { consume: vi.fn(async () => false) };
    const auth = service(repo, limiter);

    await expect(
      auth.completeCustomerRecovery({
        currentPassword: 'fictional-password',
        host: 'admin.example.test',
        networkIdentifier: '198.51.100.0/24',
        recoveryConfirmed: true,
        sessionToken: 'fictional-restricted-session',
        traceId: 'trace-customer-recovery',
      }),
    ).resolves.toBeUndefined();
    expect(completeCustomerRecovery).not.toHaveBeenCalled();
    expect(limiter.consume).toHaveBeenCalledWith({
      accountIdentifier: expect.stringMatching(/^admin\.example\.test\0[a-f0-9]{64}$/u),
      accountLimit: 3,
      networkIdentifier: '198.51.100.0/24',
      networkLimit: 10,
      scope: 'customer_recovery_completion',
      windowSeconds: 900,
    });
  });

  it('fails closed before issuing email when the cross-challenge issuance limit is reached', async () => {
    const passwordHash = await hashPassword('fictional-password');
    const repo = repository({
      findLoginTarget: vi.fn(async () => ({
        authStateVersion: '1',
        emailCodeEnabled: true,
        hasRecoveryCodes: false,
        host: 'admin.example.test',
        normalizedEmail: 'person@example.test',
        passwordHash,
        privilegedRecoveryRequired: true,
        role: 'platform_admin' as const,
        userId: 'user-a',
        verificationRequired: true,
      })),
    });
    const limiter = {
      consume: vi.fn(
        async (input: Parameters<AuthenticationRateLimiter['consume']>[0]) =>
          input.scope === 'login_attempt',
      ),
    };
    const auth = service(repo, limiter, challengeStore(), true);

    await expect(
      auth.login({
        email: 'person@example.test',
        host: 'admin.example.test',
        networkIdentifier: '198.51.100.0/24',
        password: 'fictional-password',
        traceId: 'trace-a',
      }),
    ).resolves.toEqual({ kind: 'invalid' });
    expect(limiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        accountIdentifier: 'admin.example.test\0user-a',
        accountLimit: 5,
        networkIdentifier: '198.51.100.0/24',
        networkLimit: 20,
        scope: 'email_code_issue',
      }),
    );
  });

  it('limits verification across challenges by user and network before checking a code', async () => {
    const challenge: MfaChallenge = {
      authStateDigest: 'a'.repeat(64),
      host: 'admin.example.test',
      methods: ['email_code'],
      normalizedEmail: 'person@example.test',
      purpose: 'login',
      traceId: 'trace-a',
      userId: 'user-a',
    };
    const repo = repository();
    const limiter = { consume: vi.fn(async () => false) };
    const auth = service(repo, limiter, challengeStore(challenge), true);

    await expect(
      auth.verifyMfa({
        challengeId: 'challenge-a',
        code: '12345678',
        host: 'admin.example.test',
        networkIdentifier: '198.51.100.0/24',
        traceId: 'trace-b',
      }),
    ).resolves.toEqual({ kind: 'invalid' });
    expect(repo.findLoginTarget).not.toHaveBeenCalled();
    expect(limiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        accountIdentifier: 'admin.example.test\0user-a',
        scope: 'verification_attempt',
      }),
    );
  });

  it('silently suppresses password-recovery delivery when either limiter is exhausted', async () => {
    const createPasswordRecovery = vi.fn(async () => ({
      normalizedEmail: 'person@example.test',
    }));
    const repo = repository({ createPasswordRecovery });
    const limiter = { consume: vi.fn(async () => false) };
    const auth = service(repo, limiter);

    await expect(
      auth.requestPasswordRecovery({
        host: 'admin.example.test',
        networkIdentifier: '198.51.100.0/24',
        normalizedEmail: 'person@example.test',
        traceId: 'trace-a',
      }),
    ).resolves.toBeUndefined();
    expect(createPasswordRecovery).not.toHaveBeenCalled();
    expect(limiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        accountLimit: 3,
        networkLimit: 20,
        scope: 'password_recovery_issue',
        windowSeconds: 3600,
      }),
    );
  });
});
