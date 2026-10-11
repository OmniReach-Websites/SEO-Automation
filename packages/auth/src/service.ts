import { randomUUID } from 'node:crypto';

import { decryptMfaSecret, encryptMfaSecret } from './secrets.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import { requiresMfa, type Role } from './roles.ts';
import { createOneTimeToken, digestToken } from './tokens.ts';
import { createMfaEnrollment, verifyTotp } from './mfa.ts';

export interface LoginTarget {
  blockedUntil?: Date;
  host: string;
  passwordHash: string;
  role: Role;
  siteId?: string;
  tenantId?: string;
  userId: string;
}

export interface MfaFactorRecord {
  encryptedSecret: Uint8Array;
  id: string;
  keyVersion: number;
}

export interface SessionRecord {
  createdAt: Date;
  expiresAt: Date;
  host: string;
  id: string;
  lastSeenAt: Date;
}

export interface AuthenticationRepository {
  acceptInvitation(input: {
    displayName: string;
    host: string;
    now: Date;
    passwordHash: string;
    verifyExistingPassword(passwordHash: string): Promise<boolean>;
    tokenHash: string;
    traceId: string;
  }): Promise<LoginTarget | undefined>;
  clearLoginFailures(userId: string): Promise<void>;
  completePasswordRecovery(input: {
    newPasswordHash: string;
    now: Date;
    traceId: string;
    tokenHash: string;
  }): Promise<boolean>;
  createPasswordRecovery(input: {
    expiresAt: Date;
    normalizedEmail: string;
    traceId: string;
    tokenHash: string;
  }): Promise<{ normalizedEmail: string } | undefined>;
  createSession(input: {
    expiresAt: Date;
    host: string;
    siteId?: string;
    tenantId?: string;
    tokenHash: string;
    traceId: string;
    userId: string;
    authenticationMethod: 'mfa' | 'password';
  }): Promise<void>;
  findLoginTarget(input: {
    host: string;
    normalizedEmail: string;
  }): Promise<LoginTarget | undefined>;
  findMfaFactor(userId: string): Promise<MfaFactorRecord | undefined>;
  findSessionOwner(tokenHash: string): Promise<{ userId: string } | undefined>;
  listSessions(userId: string): Promise<SessionRecord[]>;
  recordLoginFailure(input: { host: string; traceId: string; userId: string }): Promise<void>;
  revokeSession(input: {
    currentUserId: string;
    now: Date;
    sessionId: string;
    traceId: string;
  }): Promise<boolean>;
  revokeSessionByToken(input: { now: Date; tokenHash: string; traceId: string }): Promise<void>;
  useRecoveryCode(input: { codeHash: string; factorId: string; now: Date }): Promise<boolean>;
  verifyOwnerBootstrap(input: { now: Date; tokenHash: string }): Promise<boolean>;
  completeOwnerBootstrap(input: {
    displayName: string;
    encryptedMfaSecret: Uint8Array;
    keyVersion: number;
    normalizedEmail: string;
    now: Date;
    passwordHash: string;
    recoveryCodeHashes: string[];
    traceId: string;
    tokenHash: string;
  }): Promise<boolean>;
}

export interface MfaChallenge {
  host: string;
  siteId?: string;
  tenantId?: string;
  traceId: string;
  userId: string;
}

export interface MfaChallengeStore {
  consume(challengeId: string): Promise<MfaChallenge | undefined>;
  create(challenge: MfaChallenge, ttlSeconds: number): Promise<string>;
  read(challengeId: string): Promise<MfaChallenge | undefined>;
}

export interface PasswordRecoveryNotifier {
  send(input: { host: string; normalizedEmail: string; token: string }): Promise<void>;
}

export interface PendingOwnerBootstrap {
  encryptedMfaSecret: Uint8Array;
  normalizedEmail: string;
  recoveryCodeHashes: string[];
  tokenHash: string;
}

export interface OwnerBootstrapPendingStore {
  consume(setupId: string): Promise<PendingOwnerBootstrap | undefined>;
  create(value: PendingOwnerBootstrap, ttlSeconds: number): Promise<string>;
  read(setupId: string): Promise<PendingOwnerBootstrap | undefined>;
}

export type AuthenticationResult =
  | { kind: 'authenticated'; sessionToken: string }
  | { challengeId: string; kind: 'mfa-required' }
  | { kind: 'invalid' };

export class AuthenticationService {
  readonly #dummyPasswordHash: Promise<string>;

  constructor(
    private readonly repository: AuthenticationRepository,
    private readonly challenges: MfaChallengeStore,
    private readonly recoveryNotifier: PasswordRecoveryNotifier,
    private readonly options: {
      mfaEncryptionKey: string;
      now?: () => Date;
      recoveryTtlMs?: number;
      sessionTtlMs?: number;
      ownerBootstrapStore?: OwnerBootstrapPendingStore;
    },
  ) {
    this.#dummyPasswordHash = hashPassword(`missing-${randomUUID()}-credential`);
  }

  async login(input: {
    email: string;
    host: string;
    password: string;
    traceId: string;
  }): Promise<AuthenticationResult> {
    const target = await this.repository.findLoginTarget({
      host: input.host,
      normalizedEmail: input.email,
    });
    const passwordHash = target?.passwordHash ?? (await this.#dummyPasswordHash);
    const passwordValid = await verifyPassword(passwordHash, input.password);
    const now = this.now();
    if (!target || !passwordValid || (target.blockedUntil && target.blockedUntil > now)) {
      if (target) {
        await this.repository.recordLoginFailure({
          host: target.host,
          traceId: input.traceId,
          userId: target.userId,
        });
      }
      return { kind: 'invalid' };
    }
    await this.repository.clearLoginFailures(target.userId);
    if (requiresMfa(target.role)) {
      const factor = await this.repository.findMfaFactor(target.userId);
      if (!factor) return { kind: 'invalid' };
      const challengeId = await this.challenges.create(challengeFor(target, input.traceId), 300);
      return { challengeId, kind: 'mfa-required' };
    }
    return this.createSession(target, input.traceId, 'password');
  }

  async acceptInvitation(input: {
    displayName: string;
    host: string;
    password: string;
    token: string;
    traceId: string;
  }): Promise<AuthenticationResult> {
    const target = await this.repository.acceptInvitation({
      displayName: input.displayName.trim(),
      host: input.host,
      now: this.now(),
      passwordHash: await hashPassword(input.password),
      verifyExistingPassword: (passwordHash) => verifyPassword(passwordHash, input.password),
      tokenHash: digestToken(input.token),
      traceId: input.traceId,
    });
    return target ? this.createSession(target, input.traceId, 'password') : { kind: 'invalid' };
  }

  async verifyMfa(input: {
    challengeId: string;
    code: string;
    host: string;
    traceId: string;
  }): Promise<AuthenticationResult> {
    const challenge = await this.challenges.read(input.challengeId);
    if (!challenge || challenge.host !== input.host) return { kind: 'invalid' };
    const factor = await this.repository.findMfaFactor(challenge.userId);
    if (!factor) return { kind: 'invalid' };
    const compactCode = input.code.replace(/[\s-]/gu, '').toUpperCase();
    let valid = false;
    if (/^\d{6}$/u.test(compactCode)) {
      const secret = decryptMfaSecret(factor.encryptedSecret, this.options.mfaEncryptionKey);
      valid = verifyTotp(secret, compactCode, this.now().getTime());
    } else if (/^[A-F0-9]{16}$/u.test(compactCode)) {
      valid = await this.repository.useRecoveryCode({
        codeHash: digestToken(formatRecoveryCode(compactCode)),
        factorId: factor.id,
        now: this.now(),
      });
    }
    if (!valid) return { kind: 'invalid' };
    const consumed = await this.challenges.consume(input.challengeId);
    if (!consumed || consumed.userId !== challenge.userId || consumed.host !== challenge.host) {
      return { kind: 'invalid' };
    }
    return this.createSession(challenge, input.traceId, 'mfa');
  }

  async requestPasswordRecovery(input: {
    host: string;
    normalizedEmail: string;
    traceId: string;
  }): Promise<void> {
    const token = createOneTimeToken();
    const target = await this.repository.createPasswordRecovery({
      expiresAt: new Date(this.now().getTime() + (this.options.recoveryTtlMs ?? 30 * 60_000)),
      normalizedEmail: input.normalizedEmail,
      traceId: input.traceId,
      tokenHash: token.digest,
    });
    if (target) {
      await this.recoveryNotifier.send({
        host: input.host,
        normalizedEmail: target.normalizedEmail,
        token: token.token,
      });
    }
  }

  async prepareOwnerBootstrap(input: {
    normalizedEmail: string;
    traceId: string;
    token: string;
  }): Promise<{ recoveryCodes: string[]; setupId: string; uri: string } | undefined> {
    const pendingStore = this.options.ownerBootstrapStore;
    if (!pendingStore) throw new Error('Owner bootstrap is unavailable');
    const tokenHash = digestToken(input.token);
    if (!(await this.repository.verifyOwnerBootstrap({ now: this.now(), tokenHash }))) {
      return undefined;
    }
    const enrollment = createMfaEnrollment(input.normalizedEmail);
    const setupId = await pendingStore.create(
      {
        encryptedMfaSecret: encryptMfaSecret(enrollment.secret, this.options.mfaEncryptionKey),
        normalizedEmail: input.normalizedEmail,
        recoveryCodeHashes: enrollment.recoveryDigests,
        tokenHash,
      },
      10 * 60,
    );
    return { recoveryCodes: enrollment.recoveryCodes, setupId, uri: enrollment.uri };
  }

  async completeOwnerBootstrap(input: {
    code: string;
    displayName: string;
    newPassword: string;
    setupId: string;
    traceId: string;
    token: string;
  }): Promise<boolean> {
    const pendingStore = this.options.ownerBootstrapStore;
    if (!pendingStore) throw new Error('Owner bootstrap is unavailable');
    const pending = await pendingStore.read(input.setupId);
    const tokenHash = digestToken(input.token);
    if (!pending || pending.tokenHash !== tokenHash) return false;
    const secret = decryptMfaSecret(pending.encryptedMfaSecret, this.options.mfaEncryptionKey);
    if (!verifyTotp(secret, input.code, this.now().getTime())) return false;
    const completed = await this.repository.completeOwnerBootstrap({
      displayName: input.displayName.trim(),
      encryptedMfaSecret: pending.encryptedMfaSecret,
      keyVersion: 1,
      normalizedEmail: pending.normalizedEmail,
      now: this.now(),
      passwordHash: await hashPassword(input.newPassword),
      recoveryCodeHashes: pending.recoveryCodeHashes,
      traceId: input.traceId,
      tokenHash,
    });
    if (!completed) return false;
    await pendingStore.consume(input.setupId);
    return true;
  }

  async completePasswordRecovery(input: {
    newPassword: string;
    token: string;
    traceId: string;
  }): Promise<boolean> {
    const newPasswordHash = await hashPassword(input.newPassword);
    return this.repository.completePasswordRecovery({
      newPasswordHash,
      now: this.now(),
      traceId: input.traceId,
      tokenHash: digestToken(input.token),
    });
  }

  async logout(sessionToken: string | undefined, traceId: string): Promise<void> {
    if (!sessionToken) return;
    await this.repository.revokeSessionByToken({
      now: this.now(),
      tokenHash: digestToken(sessionToken),
      traceId,
    });
  }

  async listSessions(sessionToken: string | undefined): Promise<SessionRecord[]> {
    if (!sessionToken) return [];
    const owner = await this.repository.findSessionOwner(digestToken(sessionToken));
    return owner ? this.repository.listSessions(owner.userId) : [];
  }

  async revokeSession(input: {
    currentToken: string | undefined;
    sessionId: string;
    traceId: string;
  }): Promise<boolean> {
    if (!input.currentToken) return false;
    const owner = await this.repository.findSessionOwner(digestToken(input.currentToken));
    if (!owner) return false;
    return this.repository.revokeSession({
      currentUserId: owner.userId,
      now: this.now(),
      sessionId: input.sessionId,
      traceId: input.traceId,
    });
  }

  private async createSession(
    target: { host: string; siteId?: string; tenantId?: string; userId: string },
    traceId: string,
    authenticationMethod: 'mfa' | 'password',
  ): Promise<AuthenticationResult> {
    const token = createOneTimeToken();
    await this.repository.createSession({
      expiresAt: new Date(this.now().getTime() + (this.options.sessionTtlMs ?? 8 * 60 * 60_000)),
      host: target.host,
      ...(target.siteId ? { siteId: target.siteId } : {}),
      ...(target.tenantId ? { tenantId: target.tenantId } : {}),
      tokenHash: token.digest,
      traceId,
      userId: target.userId,
      authenticationMethod,
    });
    return { kind: 'authenticated', sessionToken: token.token };
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

function challengeFor(target: LoginTarget, traceId: string): MfaChallenge {
  return {
    host: target.host,
    ...(target.siteId ? { siteId: target.siteId } : {}),
    ...(target.tenantId ? { tenantId: target.tenantId } : {}),
    traceId,
    userId: target.userId,
  };
}

function formatRecoveryCode(compactCode: string): string {
  return compactCode.match(/.{1,4}/gu)?.join('-') ?? compactCode;
}
