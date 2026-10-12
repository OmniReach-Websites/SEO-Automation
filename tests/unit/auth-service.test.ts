import {
  AuthenticationService,
  createMfaEnrollment,
  createVersionedSecretKeyring,
  digestToken,
  encryptMfaSecret,
  hashPassword,
  type AuthenticationRepository,
  type EmailCodeChallengeStore,
  type MfaChallenge,
  type MfaChallengeStore,
  type OwnerBootstrapPendingStore,
  type PendingOwnerBootstrap,
} from '@omnireach/auth';
import * as OTPAuth from 'otpauth';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const now = new Date('2026-10-10T12:00:00.000Z');
const mfaKey = 'fictional-dedicated-mfa-key-material-0001';
const traceId = 'trace-auth-test';
let passwordHash = '';

beforeAll(async () => {
  passwordHash = await hashPassword('fictional-secure-password');
});

function challengeStore(): MfaChallengeStore {
  const values = new Map<string, MfaChallenge>();
  return {
    consume: vi.fn(async (id) => {
      const value = values.get(id);
      values.delete(id);
      return value;
    }),
    create: vi.fn(async (value) => {
      values.set('challenge-1', structuredClone(value));
      return 'challenge-1';
    }),
    read: vi.fn(async (id) => values.get(id)),
    refresh: vi.fn(async (id, value) => {
      if (!values.has(id)) return false;
      values.set(id, structuredClone(value));
      return true;
    }),
  };
}

function repository(
  overrides: Partial<AuthenticationRepository> = {},
): AuthenticationRepository & { createdSessions: { tokenHash: string }[] } {
  const createdSessions: { tokenHash: string }[] = [];
  return {
    acceptInvitation: vi.fn(async () => undefined),
    clearLoginFailures: vi.fn(async () => undefined),
    consumeTotpCounter: vi.fn(async () => true),
    completeCustomerRecovery: vi.fn(async () => true),
    completePasswordRecovery: vi.fn(async () => true),
    completeOwnerBootstrap: vi.fn(async () => true),
    createPasswordRecovery: vi.fn(async ({ normalizedEmail }) => ({ normalizedEmail })),
    createSession: vi.fn(async (input) => {
      createdSessions.push({ tokenHash: input.tokenHash });
      return true;
    }),
    createdSessions,
    findAccountSecurityTarget: vi.fn(async () => ({
      emailCodeEnabled: false,
      hasTotp: false,
      host: 'admin.alpha.test',
      normalizedEmail: 'owner@alpha.example.test',
      passwordHash,
      role: 'customer_owner' as const,
      secondStepRequired: false,
      siteId: 'site-a',
      tenantId: 'tenant-a',
      userId: 'user-a',
    })),
    findLoginTarget: vi.fn(async () => ({
      authStateVersion: '1',
      emailCodeEnabled: false,
      hasRecoveryCodes: false,
      host: 'admin.alpha.test',
      normalizedEmail: 'owner@alpha.example.test',
      passwordHash,
      privilegedRecoveryRequired: false,
      role: 'customer_owner' as const,
      siteId: 'site-a',
      tenantId: 'tenant-a',
      userId: 'user-a',
      verificationRequired: false,
    })),
    findMfaFactor: vi.fn(async () => undefined),
    findSessionOwner: vi.fn(async () => ({ host: 'admin.alpha.test', userId: 'user-a' })),
    listSessions: vi.fn(async () => []),
    recordLoginFailure: vi.fn(async () => undefined),
    revokeSession: vi.fn(async () => true),
    revokeSessionByToken: vi.fn(async () => undefined),
    updateCustomerEmailCodePolicy: vi.fn(async () => true),
    checkRecoveryCode: vi.fn(async () => false),
    verifyOwnerBootstrap: vi.fn(async () => true),
    ...overrides,
  };
}

function service(repo: AuthenticationRepository, challenges = challengeStore()) {
  const notifier = { send: vi.fn(async () => undefined) };
  return {
    auth: new AuthenticationService(repo, challenges, notifier, {
      mfaEncryptionKey: mfaKey,
      now: () => now,
      orapHostname: 'admin.omnireach.test',
    }),
    notifier,
  };
}

function ownerBootstrapStore(): OwnerBootstrapPendingStore {
  const values = new Map<string, PendingOwnerBootstrap>();
  return {
    consume: vi.fn(async (id) => {
      const value = values.get(id);
      values.delete(id);
      return value;
    }),
    create: vi.fn(async (value) => {
      values.set('setup-1', structuredClone(value));
      return 'setup-1';
    }),
    read: vi.fn(async (id) => values.get(id)),
  };
}

describe('authentication service', () => {
  it('accepts a one-time invitation into an exact-host customer session without storing plaintext', async () => {
    const acceptInvitation = vi.fn(async () => ({
      authStateVersion: '1',
      emailCodeEnabled: false,
      hasRecoveryCodes: false,
      host: 'admin.alpha.test',
      normalizedEmail: 'owner@alpha.example.test',
      passwordHash,
      privilegedRecoveryRequired: false,
      role: 'customer_owner' as const,
      siteId: 'site-a',
      tenantId: 'tenant-a',
      userId: 'user-invited',
      verificationRequired: false,
    }));
    const repo = repository({ acceptInvitation });
    const { auth } = service(repo);
    const result = await auth.acceptInvitation({
      displayName: 'Invited Owner',
      host: 'admin.alpha.test',
      password: 'fictional-invited-password',
      token: 'fictional-invitation-token',
      traceId,
    });
    expect(result.kind).toBe('authenticated');
    expect(acceptInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'admin.alpha.test',
        passwordHash: expect.stringContaining('$argon2id$'),
        tokenHash: digestToken('fictional-invitation-token'),
        traceId,
      }),
    );
    expect(JSON.stringify(acceptInvitation.mock.calls)).not.toContain('fictional-invited-password');
    expect(repo.createdSessions).toHaveLength(1);
  });

  it('issues only a hashed, exact-host customer session after a valid password', async () => {
    const repo = repository();
    const { auth } = service(repo);
    const result = await auth.login({
      email: 'owner@alpha.example.test',
      host: 'admin.alpha.test',
      password: 'fictional-secure-password',
      traceId,
    });
    expect(result.kind).toBe('authenticated');
    if (result.kind !== 'authenticated') throw new Error('Expected authenticated result');
    expect(result.audience).toBe('customer');
    expect(repo.createdSessions).toHaveLength(1);
    expect(repo.createdSessions[0]?.tokenHash).toBe(digestToken(result.sessionToken));
    expect(repo.createdSessions[0]?.tokenHash).not.toContain(result.sessionToken);
    expect(repo.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'admin.alpha.test', siteId: 'site-a', tenantId: 'tenant-a' }),
    );
  });

  it('requires and consumes MFA before issuing a platform session', async () => {
    const enrollment = createMfaEnrollment('staff@example.test');
    const repo = repository({
      findLoginTarget: vi.fn(async () => ({
        authStateVersion: '1',
        emailCodeEnabled: false,
        hasRecoveryCodes: true,
        host: 'admin.omnireach.test',
        normalizedEmail: 'staff@example.test',
        passwordHash,
        privilegedRecoveryRequired: true,
        role: 'platform_admin' as const,
        userId: 'staff-a',
        verificationRequired: true,
      })),
      findMfaFactor: vi.fn(async () => ({
        encryptedSecret: encryptMfaSecret(enrollment.secret, mfaKey),
        id: 'factor-a',
        keyVersion: 1,
      })),
    });
    const challenges = challengeStore();
    const { auth } = service(repo, challenges);
    const login = await auth.login({
      email: 'staff@example.test',
      host: 'admin.omnireach.test',
      password: 'fictional-secure-password',
      traceId,
    });
    expect(login).toEqual({
      challengeId: 'challenge-1',
      kind: 'mfa-required',
      methods: ['totp'],
    });
    expect(repo.createdSessions).toHaveLength(0);

    const totp = OTPAuth.URI.parse(enrollment.uri) as OTPAuth.TOTP;
    const code = totp.generate({ timestamp: now.getTime() });
    const verified = await auth.verifyMfa({
      challengeId: 'challenge-1',
      code,
      host: 'admin.omnireach.test',
      traceId,
    });
    expect(verified.kind).toBe('authenticated');
    if (verified.kind !== 'authenticated') throw new Error('Expected authenticated result');
    expect(verified.audience).toBe('platform');
    expect(repo.createdSessions).toHaveLength(1);
    await expect(
      auth.verifyMfa({
        challengeId: 'challenge-1',
        code,
        host: 'admin.omnireach.test',
        traceId,
      }),
    ).resolves.toEqual({ kind: 'invalid' });
  });

  it('does not allow an ordinary recovery code to authenticate a privileged account', async () => {
    const enrollment = createMfaEnrollment('staff@example.test');
    const repo = repository({
      findLoginTarget: vi.fn(async () => ({
        authStateVersion: '1',
        emailCodeEnabled: false,
        hasRecoveryCodes: true,
        host: 'admin.omnireach.test',
        normalizedEmail: 'staff@example.test',
        passwordHash,
        privilegedRecoveryRequired: true,
        role: 'platform_admin' as const,
        userId: 'staff-a',
        verificationRequired: true,
      })),
      findMfaFactor: vi.fn(async () => ({
        encryptedSecret: encryptMfaSecret(enrollment.secret, mfaKey),
        id: 'factor-a',
        keyVersion: 1,
      })),
      checkRecoveryCode: vi.fn(async () => true),
    });
    const { auth } = service(repo);
    const login = await auth.login({
      email: 'staff@example.test',
      host: 'admin.omnireach.test',
      password: 'fictional-secure-password',
      traceId,
    });
    if (login.kind !== 'mfa-required') throw new Error('Expected a verification challenge');
    const verified = await auth.verifyMfa({
      challengeId: login.challengeId,
      code: 'AAAA-BBBB-CCCC-DDDD',
      host: 'admin.omnireach.test',
      traceId,
    });
    expect(verified).toEqual({ kind: 'invalid' });
    expect(repo.checkRecoveryCode).not.toHaveBeenCalled();
    expect(repo.createSession).not.toHaveBeenCalled();
  });

  it('rejects a TOTP counter already consumed by a separate challenge', async () => {
    const enrollment = createMfaEnrollment('staff@example.test');
    const consumeTotpCounter = vi
      .fn<AuthenticationRepository['consumeTotpCounter']>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const repo = repository({
      consumeTotpCounter,
      findLoginTarget: vi.fn(async () => ({
        authStateVersion: '1',
        emailCodeEnabled: false,
        hasRecoveryCodes: false,
        host: 'admin.omnireach.test',
        normalizedEmail: 'staff@example.test',
        passwordHash,
        privilegedRecoveryRequired: true,
        role: 'platform_admin' as const,
        userId: 'staff-a',
        verificationRequired: true,
      })),
      findMfaFactor: vi.fn(async () => ({
        encryptedSecret: encryptMfaSecret(enrollment.secret, mfaKey),
        id: 'factor-a',
        keyVersion: 1,
      })),
    });
    const values = new Map<string, MfaChallenge>();
    let sequence = 0;
    const challenges: MfaChallengeStore = {
      consume: vi.fn(async (id) => {
        const value = values.get(id);
        values.delete(id);
        return value;
      }),
      create: vi.fn(async (value) => {
        const id = `challenge-${++sequence}`;
        values.set(id, structuredClone(value));
        return id;
      }),
      read: vi.fn(async (id) => values.get(id)),
      refresh: vi.fn(async (id, value) => {
        if (!values.has(id)) return false;
        values.set(id, structuredClone(value));
        return true;
      }),
    };
    const { auth } = service(repo, challenges);
    const first = await auth.login({
      email: 'staff@example.test',
      host: 'admin.omnireach.test',
      password: 'fictional-secure-password',
      traceId,
    });
    const second = await auth.login({
      email: 'staff@example.test',
      host: 'admin.omnireach.test',
      password: 'fictional-secure-password',
      traceId,
    });
    if (first.kind !== 'mfa-required' || second.kind !== 'mfa-required') {
      throw new Error('Expected two MFA challenges');
    }
    const code = (OTPAuth.URI.parse(enrollment.uri) as OTPAuth.TOTP).generate({
      timestamp: now.getTime(),
    });

    await expect(
      auth.verifyMfa({
        challengeId: first.challengeId,
        code,
        host: 'admin.omnireach.test',
        traceId,
      }),
    ).resolves.toMatchObject({ kind: 'authenticated' });
    await expect(
      auth.verifyMfa({
        challengeId: second.challengeId,
        code,
        host: 'admin.omnireach.test',
        traceId,
      }),
    ).resolves.toEqual({ kind: 'invalid' });
    expect(consumeTotpCounter).toHaveBeenCalledTimes(2);
    expect(repo.createdSessions).toHaveLength(1);
  });

  it('domain-separates and shortens a restricted recovery session', async () => {
    const repo = repository({
      findLoginTarget: vi.fn(async () => ({
        authStateVersion: '1',
        emailCodeEnabled: true,
        hasRecoveryCodes: true,
        host: 'admin.alpha.test',
        normalizedEmail: 'owner@alpha.example.test',
        passwordHash,
        privilegedRecoveryRequired: false,
        role: 'customer_owner' as const,
        siteId: 'site-a',
        tenantId: 'tenant-a',
        userId: 'user-a',
        verificationRequired: true,
      })),
      checkRecoveryCode: vi.fn(async () => true),
    });
    const emailCodeStore: EmailCodeChallengeStore = {
      create: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      replace: vi.fn(async () => 'updated' as const),
      verify: vi.fn(async () => 'invalid' as const),
    };
    const auth = new AuthenticationService(
      repo,
      challengeStore(),
      { send: vi.fn() },
      {
        emailCodeStore,
        mfaEncryptionKey: mfaKey,
        now: () => now,
        orapHostname: 'admin.omnireach.test',
        verificationNotifier: { send: vi.fn(async () => undefined) },
      },
    );
    const login = await auth.login({
      email: 'owner@alpha.example.test',
      host: 'admin.alpha.test',
      password: 'fictional-secure-password',
      traceId,
    });
    if (login.kind !== 'mfa-required') throw new Error('Expected an MFA challenge');
    const result = await auth.verifyMfa({
      challengeId: login.challengeId,
      code: 'AAAA-BBBB-CCCC-DDDD',
      host: 'admin.alpha.test',
      traceId,
    });
    expect(result).toMatchObject({
      audience: 'customer',
      kind: 'authenticated',
      recoveryRestricted: true,
    });
    if (result.kind !== 'authenticated') throw new Error('Expected a restricted session');
    const created = vi.mocked(repo.createSession).mock.calls[0]?.[0];
    expect(created).toMatchObject({
      assuranceLevel: 'recovery',
      authenticationMethod: 'recovery_code',
      expiresAt: new Date(now.getTime() + 15 * 60_000),
      recoveryRestricted: true,
    });
    expect(created?.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(created?.tokenHash).not.toBe(digestToken(result.sessionToken));
  });

  it('keeps recovery non-enumerating and revokes sessions only for the current user', async () => {
    const repo = repository();
    const { auth, notifier } = service(repo);
    await auth.requestPasswordRecovery({
      host: 'admin.omnireach.test',
      normalizedEmail: 'owner@example.test',
      traceId,
    });
    expect(notifier.send).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'admin.omnireach.test',
        normalizedEmail: 'owner@example.test',
        token: expect.any(String),
      }),
    );
    expect(repo.createPasswordRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'admin.omnireach.test',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    await expect(
      auth.revokeSession({
        currentToken: 'current-session',
        host: 'admin.alpha.test',
        sessionId: 'session-a',
        traceId,
      }),
    ).resolves.toBe(true);
    expect(repo.revokeSession).toHaveBeenCalledWith(
      expect.objectContaining({ currentUserId: 'user-a', sessionId: 'session-a' }),
    );

    const missingRepo = repository({ createPasswordRecovery: vi.fn(async () => undefined) });
    const missing = service(missingRepo);
    await expect(
      missing.auth.requestPasswordRecovery({
        host: 'admin.omnireach.test',
        normalizedEmail: 'missing@example.test',
        traceId,
      }),
    ).resolves.toBeUndefined();
    expect(missing.notifier.send).not.toHaveBeenCalled();
  });

  it('requires password and an exact-host email code before changing customer policy', async () => {
    const repo = repository();
    const challenges = challengeStore();
    const emailDigests = new Map<string, string>();
    const emailCodeStore: EmailCodeChallengeStore = {
      create: vi.fn(async (input) => void emailDigests.set(input.challengeId, input.codeDigest)),
      remove: vi.fn(async (challengeId) => void emailDigests.delete(challengeId)),
      replace: vi.fn(async () => 'updated' as const),
      verify: vi.fn(async (input) => {
        if (emailDigests.get(input.challengeId) !== input.codeDigest) return 'invalid' as const;
        emailDigests.delete(input.challengeId);
        return 'verified' as const;
      }),
    };
    const sentCodes: string[] = [];
    const verificationNotifier = {
      send: vi.fn(
        async (input: { code: string; expiresAt: Date; host: string; normalizedEmail: string }) =>
          void sentCodes.push(input.code),
      ),
    };
    const auth = new AuthenticationService(
      repo,
      challenges,
      { send: vi.fn() },
      {
        emailCodeStore,
        mfaEncryptionKey: mfaKey,
        now: () => now,
        orapHostname: 'admin.omnireach.test',
        verificationNotifier,
      },
    );

    await expect(
      auth.prepareCustomerEmailCodePolicyChange({
        currentPassword: 'wrong-password',
        enabled: true,
        host: 'admin.alpha.test',
        sessionToken: 'customer-session',
        traceId,
      }),
    ).resolves.toBeUndefined();
    const prepared = await auth.prepareCustomerEmailCodePolicyChange({
      currentPassword: 'fictional-secure-password',
      enabled: true,
      host: 'admin.alpha.test',
      sessionToken: 'customer-session',
      traceId,
    });
    expect(prepared).toEqual({ challengeId: 'challenge-1' });
    const code = sentCodes[0];
    if (!code) throw new Error('Expected an email verification code');

    await expect(
      auth.verifyMfa({
        challengeId: 'challenge-1',
        code,
        host: 'admin.alpha.test',
        traceId,
      }),
    ).resolves.toEqual({ kind: 'invalid' });
    const completed = await auth.completeCustomerEmailCodePolicyChange({
      challengeId: 'challenge-1',
      code,
      host: 'admin.alpha.test',
      sessionToken: 'customer-session',
      traceId,
    });
    expect(completed).toEqual({
      recoveryCodes: expect.arrayContaining([
        expect.stringMatching(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/u),
      ]),
      sessionsRevoked: true,
    });
    const updateCustomerEmailCodePolicy = vi.mocked(repo.updateCustomerEmailCodePolicy);
    expect(updateCustomerEmailCodePolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        host: 'admin.alpha.test',
        recoveryCodeHashes: expect.arrayContaining([expect.stringMatching(/^[a-f0-9]{64}$/u)]),
        sessionTokenHash: digestToken('customer-session'),
        userId: 'user-a',
      }),
    );
    expect(JSON.stringify(updateCustomerEmailCodePolicy.mock.calls)).not.toContain(code);
  });

  it('does not offer email verification when delivery is unavailable and rejects platform policy changes', async () => {
    const enrollment = createMfaEnrollment('staff@example.test');
    const repo = repository({
      findAccountSecurityTarget: vi.fn(async () => ({
        emailCodeEnabled: true,
        hasTotp: true,
        host: 'admin.omnireach.test',
        normalizedEmail: 'staff@example.test',
        passwordHash,
        role: 'platform_admin' as const,
        secondStepRequired: true,
        userId: 'staff-a',
      })),
      findLoginTarget: vi.fn(async () => ({
        authStateVersion: '1',
        emailCodeEnabled: true,
        hasRecoveryCodes: false,
        host: 'admin.omnireach.test',
        normalizedEmail: 'staff@example.test',
        passwordHash,
        privilegedRecoveryRequired: true,
        role: 'platform_admin' as const,
        userId: 'staff-a',
        verificationRequired: true,
      })),
      findMfaFactor: vi.fn(async () => ({
        encryptedSecret: encryptMfaSecret(enrollment.secret, mfaKey),
        id: 'factor-a',
        keyVersion: 1,
      })),
    });
    const { auth } = service(repo);
    await expect(
      auth.login({
        email: 'staff@example.test',
        host: 'admin.omnireach.test',
        password: 'fictional-secure-password',
        traceId,
      }),
    ).resolves.toEqual({
      challengeId: 'challenge-1',
      kind: 'mfa-required',
      methods: ['totp'],
    });
    await expect(
      auth.prepareCustomerEmailCodePolicyChange({
        currentPassword: 'fictional-secure-password',
        enabled: false,
        host: 'admin.omnireach.test',
        sessionToken: 'platform-session',
        traceId,
      }),
    ).resolves.toBeUndefined();
  });

  it('falls back to a fresh TOTP-only challenge when live email delivery fails', async () => {
    const enrollment = createMfaEnrollment('staff@example.test');
    const repo = repository({
      findLoginTarget: vi.fn(async () => ({
        authStateVersion: '1',
        emailCodeEnabled: true,
        hasRecoveryCodes: false,
        host: 'admin.omnireach.test',
        normalizedEmail: 'staff@example.test',
        passwordHash,
        privilegedRecoveryRequired: true,
        role: 'platform_admin' as const,
        userId: 'staff-a',
        verificationRequired: true,
      })),
      findMfaFactor: vi.fn(async () => ({
        encryptedSecret: encryptMfaSecret(enrollment.secret, mfaKey),
        id: 'factor-a',
        keyVersion: 1,
      })),
    });
    const challenges = challengeStore();
    const auth = new AuthenticationService(
      repo,
      challenges,
      { send: vi.fn() },
      {
        emailCodeStore: {
          create: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
          replace: vi.fn(async () => 'updated' as const),
          verify: vi.fn(async () => 'invalid' as const),
        },
        mfaEncryptionKey: mfaKey,
        now: () => now,
        orapHostname: 'admin.omnireach.test',
        verificationNotifier: { send: vi.fn(async () => Promise.reject(new Error('offline'))) },
      },
    );
    await expect(
      auth.login({
        email: 'staff@example.test',
        host: 'admin.omnireach.test',
        password: 'fictional-secure-password',
        traceId,
      }),
    ).resolves.toEqual({
      challengeId: 'challenge-1',
      kind: 'mfa-required',
      methods: ['totp'],
    });
    const createChallenge = vi.mocked(challenges.create);
    expect(createChallenge).toHaveBeenCalledTimes(2);
    expect(createChallenge.mock.calls[0]?.[0].methods).toEqual(['email_code', 'totp']);
    expect(createChallenge.mock.calls[1]?.[0].methods).toEqual(['totp']);
  });

  it('preserves TOTP verification when an email resend delivery fails', async () => {
    const enrollment = createMfaEnrollment('staff@example.test');
    const repo = repository({
      findLoginTarget: vi.fn(async () => ({
        authStateVersion: '1',
        emailCodeEnabled: true,
        hasRecoveryCodes: false,
        host: 'admin.omnireach.test',
        normalizedEmail: 'staff@example.test',
        passwordHash,
        privilegedRecoveryRequired: true,
        role: 'platform_admin' as const,
        userId: 'staff-a',
        verificationRequired: true,
      })),
      findMfaFactor: vi.fn(async () => ({
        encryptedSecret: encryptMfaSecret(enrollment.secret, mfaKey),
        id: 'factor-a',
        keyVersion: 1,
      })),
    });
    const challenges = challengeStore();
    const remove = vi.fn(async () => undefined);
    let deliveries = 0;
    const auth = new AuthenticationService(
      repo,
      challenges,
      { send: vi.fn() },
      {
        emailCodeStore: {
          create: vi.fn(async () => undefined),
          remove,
          replace: vi.fn(async () => 'updated' as const),
          verify: vi.fn(async () => 'invalid' as const),
        },
        mfaEncryptionKey: mfaKey,
        now: () => now,
        orapHostname: 'admin.omnireach.test',
        verificationNotifier: {
          send: vi.fn(async () => {
            deliveries += 1;
            if (deliveries > 1) throw new Error('offline');
          }),
        },
      },
    );
    const login = await auth.login({
      email: 'staff@example.test',
      host: 'admin.omnireach.test',
      password: 'fictional-secure-password',
      traceId,
    });
    expect(login).toMatchObject({
      challengeId: 'challenge-1',
      kind: 'mfa-required',
      methods: ['email_code', 'totp'],
    });
    await expect(
      auth.resendEmailCode({
        challengeId: 'challenge-1',
        host: 'admin.omnireach.test',
      }),
    ).resolves.toBe('unavailable');
    expect(remove).toHaveBeenCalledWith('challenge-1');
    await expect(challenges.read('challenge-1')).resolves.toMatchObject({
      methods: ['email_code', 'totp'],
      purpose: 'login',
    });
  });

  it('preserves customer recovery-code access when an email resend delivery fails', async () => {
    const repo = repository({
      findLoginTarget: vi.fn(async () => ({
        authStateVersion: '1',
        emailCodeEnabled: true,
        hasRecoveryCodes: true,
        host: 'admin.alpha.test',
        normalizedEmail: 'owner@alpha.example.test',
        passwordHash,
        privilegedRecoveryRequired: false,
        role: 'customer_owner' as const,
        siteId: 'site-a',
        tenantId: 'tenant-a',
        userId: 'user-a',
        verificationRequired: true,
      })),
      checkRecoveryCode: vi.fn(async () => true),
    });
    const challenges = challengeStore();
    let deliveries = 0;
    const auth = new AuthenticationService(
      repo,
      challenges,
      { send: vi.fn() },
      {
        emailCodeStore: {
          create: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
          replace: vi.fn(async () => 'updated' as const),
          verify: vi.fn(async () => 'invalid' as const),
        },
        mfaEncryptionKey: mfaKey,
        now: () => now,
        orapHostname: 'admin.omnireach.test',
        verificationNotifier: {
          send: vi.fn(async () => {
            deliveries += 1;
            if (deliveries > 1) throw new Error('offline');
          }),
        },
      },
    );
    const login = await auth.login({
      email: 'owner@alpha.example.test',
      host: 'admin.alpha.test',
      password: 'fictional-secure-password',
      traceId,
    });
    if (login.kind !== 'mfa-required') throw new Error('Expected a verification challenge');

    await expect(
      auth.resendEmailCode({
        challengeId: login.challengeId,
        host: 'admin.alpha.test',
      }),
    ).resolves.toBe('unavailable');
    await expect(challenges.read(login.challengeId)).resolves.toMatchObject({
      recoveryCodeAllowed: true,
    });
    await expect(
      auth.verifyMfa({
        challengeId: login.challengeId,
        code: 'AAAA-BBBB-CCCC-DDDD',
        host: 'admin.alpha.test',
        traceId,
      }),
    ).resolves.toMatchObject({
      audience: 'customer',
      kind: 'authenticated',
      recoveryRestricted: true,
    });
  });

  it('rejects a login challenge after password-backed authentication state changes', async () => {
    const enrollment = createMfaEnrollment('staff@example.test');
    let activePasswordHash = passwordHash;
    const repo = repository({
      findLoginTarget: vi.fn(async () => ({
        authStateVersion: '1',
        emailCodeEnabled: false,
        hasRecoveryCodes: false,
        host: 'admin.omnireach.test',
        normalizedEmail: 'staff@example.test',
        passwordHash: activePasswordHash,
        privilegedRecoveryRequired: true,
        role: 'platform_admin' as const,
        userId: 'staff-a',
        verificationRequired: true,
      })),
      findMfaFactor: vi.fn(async () => ({
        encryptedSecret: encryptMfaSecret(enrollment.secret, mfaKey),
        id: 'factor-a',
        keyVersion: 1,
      })),
    });
    const { auth } = service(repo);
    const login = await auth.login({
      email: 'staff@example.test',
      host: 'admin.omnireach.test',
      password: 'fictional-secure-password',
      traceId,
    });
    expect(login.kind).toBe('mfa-required');
    activePasswordHash = await hashPassword('fictional-replacement-password');
    await expect(
      auth.verifyMfa({
        challengeId: 'challenge-1',
        code: '123456',
        host: 'admin.omnireach.test',
        traceId,
      }),
    ).resolves.toEqual({ kind: 'invalid' });
    expect(repo.createdSessions).toHaveLength(0);
  });

  it('rejects an outstanding challenge after the account authentication version changes', async () => {
    const enrollment = createMfaEnrollment('staff@example.test');
    let authStateVersion = '11';
    const consumeTotpCounter = vi.fn(async () => true);
    const repo = repository({
      consumeTotpCounter,
      findLoginTarget: vi.fn(async () => ({
        authStateVersion,
        emailCodeEnabled: false,
        hasRecoveryCodes: false,
        host: 'admin.omnireach.test',
        normalizedEmail: 'staff@example.test',
        passwordHash,
        privilegedRecoveryRequired: true,
        role: 'platform_admin' as const,
        userId: 'staff-a',
        verificationRequired: true,
      })),
      findMfaFactor: vi.fn(async () => ({
        encryptedSecret: encryptMfaSecret(enrollment.secret, mfaKey),
        id: 'factor-a',
        keyVersion: 1,
      })),
    });
    const { auth } = service(repo);
    const login = await auth.login({
      email: 'staff@example.test',
      host: 'admin.omnireach.test',
      password: 'fictional-secure-password',
      traceId,
    });
    if (login.kind !== 'mfa-required') throw new Error('Expected a verification challenge');
    authStateVersion = '12';
    const code = (OTPAuth.URI.parse(enrollment.uri) as OTPAuth.TOTP).generate({
      timestamp: now.getTime(),
    });

    await expect(
      auth.verifyMfa({
        challengeId: login.challengeId,
        code,
        host: 'admin.omnireach.test',
        traceId,
      }),
    ).resolves.toEqual({ kind: 'invalid' });
    expect(consumeTotpCounter).not.toHaveBeenCalled();
    expect(repo.createSession).not.toHaveBeenCalled();
  });

  it('finishes a customer recovery session by replacing codes without exposing hashes', async () => {
    const repo = repository({
      completeCustomerRecovery: vi.fn(
        async (input) => input.confirmed && input.verifyCurrentPassword(passwordHash),
      ),
    });
    const { auth } = service(repo);
    const result = await auth.completeCustomerRecovery({
      currentPassword: 'fictional-secure-password',
      host: 'admin.alpha.test',
      recoveryConfirmed: true,
      sessionToken: 'recovery-session',
      traceId,
    });
    expect(result).toEqual({
      recoveryCodes: expect.arrayContaining([
        expect.stringMatching(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/u),
      ]),
      sessionsRevoked: true,
    });
    const completeCustomerRecovery = vi.mocked(repo.completeCustomerRecovery);
    expect(completeCustomerRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmed: true,
        host: 'admin.alpha.test',
        recoveryCodeHashes: expect.arrayContaining([expect.stringMatching(/^[a-f0-9]{64}$/u)]),
        sessionTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        verifyCurrentPassword: expect.any(Function),
      }),
    );
    expect(completeCustomerRecovery.mock.calls[0]?.[0].sessionTokenHash).not.toBe(
      digestToken('recovery-session'),
    );
    expect(JSON.stringify(completeCustomerRecovery.mock.calls)).not.toContain(
      result?.recoveryCodes[0] ?? 'missing',
    );
    expect(repo.createSession).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation and the current password for customer recovery', async () => {
    const completeCustomerRecovery = vi.fn(async (input) =>
      input.verifyCurrentPassword(passwordHash),
    );
    const repo = repository({ completeCustomerRecovery });
    const { auth } = service(repo);

    await expect(
      auth.completeCustomerRecovery({
        currentPassword: 'fictional-secure-password',
        host: 'admin.alpha.test',
        recoveryConfirmed: false,
        sessionToken: 'recovery-session',
        traceId,
      }),
    ).resolves.toBeUndefined();
    expect(completeCustomerRecovery).not.toHaveBeenCalled();

    await expect(
      auth.completeCustomerRecovery({
        currentPassword: 'wrong-password',
        host: 'admin.alpha.test',
        recoveryConfirmed: true,
        sessionToken: 'recovery-session',
        traceId,
      }),
    ).resolves.toBeUndefined();
    expect(completeCustomerRecovery).toHaveBeenCalledOnce();

    await expect(
      auth.completeCustomerRecovery({
        currentPassword: 'fictional-secure-password',
        host: 'admin.omnireach.test',
        recoveryConfirmed: true,
        sessionToken: 'recovery-session',
        traceId,
      }),
    ).resolves.toBeUndefined();
    expect(completeCustomerRecovery).toHaveBeenCalledOnce();
  });

  it('creates the first platform owner only after one-time token and TOTP verification', async () => {
    const repo = repository();
    const pending = ownerBootstrapStore();
    const activeMfaKey = 'fictional-dedicated-mfa-key-material-0002';
    const auth = new AuthenticationService(
      repo,
      challengeStore(),
      { send: vi.fn() },
      {
        mfaEncryptionKeyring: createVersionedSecretKeyring({
          activeVersion: 2,
          keys: { 1: mfaKey, 2: activeMfaKey },
        }),
        now: () => now,
        orapHostname: 'admin.omnireach.test',
        ownerBootstrapStore: pending,
      },
    );
    await expect(
      auth.prepareOwnerBootstrap({
        host: 'admin.customer.test',
        normalizedEmail: 'owner@example.test',
        traceId,
        token: 'fictional-one-time-bootstrap-token',
      }),
    ).rejects.toThrow('Owner bootstrap is unavailable');
    expect(repo.verifyOwnerBootstrap).not.toHaveBeenCalled();
    const prepared = await auth.prepareOwnerBootstrap({
      host: 'admin.omnireach.test',
      normalizedEmail: 'owner@example.test',
      traceId,
      token: 'fictional-one-time-bootstrap-token',
    });
    expect(prepared).toEqual({
      method: 'totp',
      recoveryCodes: expect.arrayContaining([
        expect.stringMatching(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/u),
      ]),
      setupId: 'setup-1',
      uri: expect.stringMatching(/^otpauth:\/\/totp\//u),
    });
    if (!prepared?.uri) throw new Error('Expected bootstrap enrollment');
    const code = (OTPAuth.URI.parse(prepared.uri) as OTPAuth.TOTP).generate({
      timestamp: now.getTime(),
    });
    await expect(
      auth.completeOwnerBootstrap({
        code,
        displayName: 'Platform Owner',
        host: 'admin.omnireach.test',
        newPassword: 'fictional-owner-password',
        recoveryCodesAcknowledged: false,
        setupId: prepared.setupId,
        traceId,
        token: 'fictional-one-time-bootstrap-token',
      }),
    ).resolves.toBe(false);
    expect(repo.completeOwnerBootstrap).not.toHaveBeenCalled();
    await expect(
      auth.completeOwnerBootstrap({
        code,
        displayName: 'Platform Owner',
        host: 'admin.omnireach.test',
        newPassword: 'fictional-owner-password',
        recoveryCodesAcknowledged: true,
        setupId: prepared.setupId,
        traceId,
        token: 'fictional-one-time-bootstrap-token',
      }),
    ).resolves.toBe(true);
    expect(repo.completeOwnerBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'Platform Owner',
        encryptedMfaSecret: expect.any(Uint8Array),
        keyVersion: 2,
        normalizedEmail: 'owner@example.test',
        recoveryCodeHashes: expect.arrayContaining([expect.stringMatching(/^[a-f0-9]{64}$/u)]),
        tokenHash: digestToken('fictional-one-time-bootstrap-token'),
      }),
    );
    await expect(
      auth.completeOwnerBootstrap({
        code,
        displayName: 'Platform Owner',
        host: 'admin.omnireach.test',
        newPassword: 'fictional-owner-password',
        recoveryCodesAcknowledged: true,
        setupId: prepared.setupId,
        traceId,
        token: 'fictional-one-time-bootstrap-token',
      }),
    ).resolves.toBe(false);
  });
});
