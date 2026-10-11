import {
  AuthenticationService,
  createMfaEnrollment,
  digestToken,
  encryptMfaSecret,
  hashPassword,
  type AuthenticationRepository,
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
  };
}

function repository(
  overrides: Partial<AuthenticationRepository> = {},
): AuthenticationRepository & { createdSessions: { tokenHash: string }[] } {
  const createdSessions: { tokenHash: string }[] = [];
  return {
    acceptInvitation: vi.fn(async () => undefined),
    clearLoginFailures: vi.fn(async () => undefined),
    completePasswordRecovery: vi.fn(async () => true),
    completeOwnerBootstrap: vi.fn(async () => true),
    createPasswordRecovery: vi.fn(async ({ normalizedEmail }) => ({ normalizedEmail })),
    createSession: vi.fn(
      async (input) => void createdSessions.push({ tokenHash: input.tokenHash }),
    ),
    createdSessions,
    findLoginTarget: vi.fn(async () => ({
      host: 'admin.alpha.test',
      passwordHash,
      role: 'customer_owner' as const,
      siteId: 'site-a',
      tenantId: 'tenant-a',
      userId: 'user-a',
    })),
    findMfaFactor: vi.fn(async () => undefined),
    findSessionOwner: vi.fn(async () => ({ userId: 'user-a' })),
    listSessions: vi.fn(async () => []),
    recordLoginFailure: vi.fn(async () => undefined),
    revokeSession: vi.fn(async () => true),
    revokeSessionByToken: vi.fn(async () => undefined),
    useRecoveryCode: vi.fn(async () => false),
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
      host: 'admin.alpha.test',
      passwordHash,
      role: 'customer_owner' as const,
      siteId: 'site-a',
      tenantId: 'tenant-a',
      userId: 'user-invited',
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
        host: 'admin.omnireach.test',
        passwordHash,
        role: 'platform_admin' as const,
        userId: 'staff-a',
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
    expect(login).toEqual({ challengeId: 'challenge-1', kind: 'mfa-required' });
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
      expect.objectContaining({ tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/u) }),
    );
    await expect(
      auth.revokeSession({ currentToken: 'current-session', sessionId: 'session-a', traceId }),
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

  it('creates the first platform owner only after one-time token and TOTP verification', async () => {
    const repo = repository();
    const pending = ownerBootstrapStore();
    const auth = new AuthenticationService(
      repo,
      challengeStore(),
      { send: vi.fn() },
      {
        mfaEncryptionKey: mfaKey,
        now: () => now,
        ownerBootstrapStore: pending,
      },
    );
    const prepared = await auth.prepareOwnerBootstrap({
      normalizedEmail: 'owner@example.test',
      traceId,
      token: 'fictional-one-time-bootstrap-token',
    });
    expect(prepared).toEqual({
      recoveryCodes: expect.arrayContaining([
        expect.stringMatching(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/u),
      ]),
      setupId: 'setup-1',
      uri: expect.stringMatching(/^otpauth:\/\/totp\//u),
    });
    if (!prepared) throw new Error('Expected bootstrap enrollment');
    const code = (OTPAuth.URI.parse(prepared.uri) as OTPAuth.TOTP).generate({
      timestamp: now.getTime(),
    });
    await expect(
      auth.completeOwnerBootstrap({
        code,
        displayName: 'Platform Owner',
        newPassword: 'fictional-owner-password',
        setupId: prepared.setupId,
        traceId,
        token: 'fictional-one-time-bootstrap-token',
      }),
    ).resolves.toBe(true);
    expect(repo.completeOwnerBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'Platform Owner',
        encryptedMfaSecret: expect.any(Uint8Array),
        normalizedEmail: 'owner@example.test',
        recoveryCodeHashes: expect.arrayContaining([expect.stringMatching(/^[a-f0-9]{64}$/u)]),
        tokenHash: digestToken('fictional-one-time-bootstrap-token'),
      }),
    );
    await expect(
      auth.completeOwnerBootstrap({
        code,
        displayName: 'Platform Owner',
        newPassword: 'fictional-owner-password',
        setupId: prepared.setupId,
        traceId,
        token: 'fictional-one-time-bootstrap-token',
      }),
    ).resolves.toBe(false);
  });
});
