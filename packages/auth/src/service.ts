import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { createEmailVerificationCode, digestEmailVerificationCode } from './email-code.ts';
import { createMfaEnrollment, createRecoveryCodes, verifyTotpCounter } from './mfa.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import type { Role } from './roles.ts';
import {
  activeSecretKey,
  decryptMfaSecret,
  encryptMfaSecret,
  parseVersionedSecretKeyring,
  secretKeyForVersion,
  type VersionedSecretKeyring,
} from './secrets.ts';
import { createOneTimeToken, digestToken } from './tokens.ts';
import {
  createWebAuthnAuthenticationOptions,
  createWebAuthnRegistrationOptions,
  resolveWebAuthnRelyingParty,
  verifyExactHostWebAuthnAuthentication,
  verifyExactHostWebAuthnRegistration,
  type WebAuthnAuthenticationPreparation,
  type WebAuthnAuthenticationResponse,
  type WebAuthnCeremonyStore,
  type WebAuthnEnrollmentPreparation,
  type WebAuthnEnrollmentRepository,
  type WebAuthnRegistrationResponse,
} from './webauthn.ts';

export type VerificationMethod = 'email_code' | 'totp' | 'webauthn';
export type SessionAuthenticationMethod =
  'email_code' | 'password' | 'recovery_code' | 'totp' | 'webauthn';
export type AuthenticationAssurance = 'baseline' | 'basic' | 'recovery' | 'strong';
export type AuthenticationRateLimitScope =
  | 'customer_recovery_completion'
  | 'email_code_issue'
  | 'invitation_acceptance'
  | 'login_attempt'
  | 'password_recovery_completion'
  | 'password_recovery_issue'
  | 'totp_enrollment'
  | 'verification_attempt'
  | 'webauthn_authentication'
  | 'webauthn_enrollment';

export interface AuthenticationRateLimiter {
  consume(input: {
    accountIdentifier: string;
    accountLimit: number;
    networkIdentifier: string;
    networkLimit: number;
    scope: AuthenticationRateLimitScope;
    windowSeconds: number;
  }): Promise<boolean>;
}

export interface LoginTarget {
  authStateVersion: string;
  blockedUntil?: Date;
  emailCodeEnabled: boolean;
  hasRecoveryCodes: boolean;
  host: string;
  normalizedEmail: string;
  passwordHash: string;
  preferredMethod?: VerificationMethod;
  privilegedRecoveryRequired: boolean;
  role: Role;
  siteId?: string;
  tenantId?: string;
  userId: string;
  verificationRequired: boolean;
}

export interface MfaFactorRecord {
  encryptedSecret: Uint8Array;
  id: string;
  keyVersion: number;
}

export interface SessionRecord {
  assuranceLevel?: AuthenticationAssurance;
  authenticationMethod?: SessionAuthenticationMethod;
  createdAt: Date;
  expiresAt: Date;
  host: string;
  id: string;
  lastSeenAt: Date;
}

export interface SessionOwner {
  host: string;
  siteId?: string;
  tenantId?: string;
  userId: string;
}

export interface AccountSecurityTarget {
  emailCodeEnabled: boolean;
  hasTotp: boolean;
  hasWebAuthn: boolean;
  host: string;
  normalizedEmail: string;
  passwordHash: string;
  role: Role;
  secondStepRequired: boolean;
  siteId?: string;
  tenantId?: string;
  userId: string;
}

export interface AccountSecuritySettings {
  emailCodeEnabled: boolean;
  emailPolicyChangeAllowed: boolean;
  secondStepRequired: boolean;
  totpEnabled: boolean;
  webauthnEnrollmentAvailable: boolean;
  webauthnEnabled: boolean;
  webauthnCredentials?: {
    backedUp: boolean;
    createdAt: Date;
    deviceType: string;
    id: string;
    lastUsedAt?: Date;
    name: string;
  }[];
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
  consumeTotpCounter(input: { counter: number; factorId: string }): Promise<boolean>;
  completePasswordRecovery(input: {
    host: string;
    newPasswordHash: string;
    now: Date;
    traceId: string;
    tokenHash: string;
  }): Promise<boolean>;
  completeCustomerRecovery(input: {
    confirmed: boolean;
    host: string;
    now: Date;
    recoveryCodeHashes: string[];
    sessionTokenHash: string;
    traceId: string;
    verifyCurrentPassword(passwordHash: string): Promise<boolean>;
  }): Promise<boolean>;
  createPasswordRecovery(input: {
    expiresAt: Date;
    host: string;
    normalizedEmail: string;
    traceId: string;
    tokenHash: string;
  }): Promise<{ normalizedEmail: string } | undefined>;
  createSession(input: {
    assuranceLevel: AuthenticationAssurance;
    authenticationMethod: SessionAuthenticationMethod;
    expectedAuthStateVersion: string;
    expectedPasswordHash: string;
    expiresAt: Date;
    factorId?: string;
    host: string;
    recoveryRestricted: boolean;
    recoveryCodeHash?: string;
    role: Role;
    siteId?: string;
    tenantId?: string;
    tokenHash: string;
    traceId: string;
    userId: string;
    verifiedAt?: Date;
  }): Promise<boolean>;
  findLoginTarget(input: {
    host: string;
    normalizedEmail: string;
  }): Promise<LoginTarget | undefined>;
  findMfaFactor(userId: string): Promise<MfaFactorRecord | undefined>;
  findAccountSecurityTarget(input: {
    host: string;
    tokenHash: string;
  }): Promise<AccountSecurityTarget | undefined>;
  findSessionOwner(input: { host: string; tokenHash: string }): Promise<SessionOwner | undefined>;
  listSessions(owner: SessionOwner): Promise<SessionRecord[]>;
  recordLoginFailure(input: { host: string; traceId: string; userId: string }): Promise<void>;
  revokeSession(input: {
    currentUserId: string;
    host: string;
    now: Date;
    sessionId: string;
    siteId?: string;
    tenantId?: string;
    traceId: string;
  }): Promise<boolean>;
  revokeSessionByToken(input: {
    host: string;
    now: Date;
    tokenHash: string;
    traceId: string;
  }): Promise<void>;
  updateCustomerEmailCodePolicy(input: {
    enabled: boolean;
    host: string;
    now: Date;
    recoveryCodeHashes: string[];
    sessionTokenHash: string;
    traceId: string;
    userId: string;
  }): Promise<boolean>;
  updateCustomerTotpPolicy(input: {
    enabled: boolean;
    encryptedSecret?: Uint8Array;
    host: string;
    keyVersion?: number;
    lastUsedCounter?: number;
    now: Date;
    recoveryCodeHashes: string[];
    sessionTokenHash: string;
    traceId: string;
    userId: string;
  }): Promise<boolean>;
  checkRecoveryCode(input: { codeHash: string; userId: string }): Promise<boolean>;
  verifyOwnerBootstrap(input: { now: Date; tokenHash: string }): Promise<boolean>;
  completeOwnerBootstrap(input: {
    displayName: string;
    encryptedMfaSecret?: Uint8Array;
    keyVersion?: number;
    lastUsedCounter?: number;
    method: 'email_code' | 'totp';
    normalizedEmail: string;
    now: Date;
    passwordHash: string;
    recoveryCodeHashes: string[];
    traceId: string;
    tokenHash: string;
  }): Promise<boolean>;
}

export interface MfaChallenge {
  authStateDigest?: string;
  host: string;
  methods: VerificationMethod[];
  normalizedEmail: string;
  policyChange?: 'disable_email_code' | 'enable_email_code';
  purpose?: 'email_policy_change' | 'login';
  recoveryCodeAllowed?: boolean;
  sessionTokenHash?: string;
  siteId?: string;
  tenantId?: string;
  traceId: string;
  userId: string;
}

export interface MfaChallengeStore {
  consume(challengeId: string): Promise<MfaChallenge | undefined>;
  create(challenge: MfaChallenge, ttlSeconds: number): Promise<string>;
  read(challengeId: string): Promise<MfaChallenge | undefined>;
  refresh(challengeId: string, challenge: MfaChallenge, ttlSeconds: number): Promise<boolean>;
}

export type EmailCodeVerificationResult = 'exhausted' | 'invalid' | 'missing' | 'verified';
export type EmailCodeResendResult = 'cooldown' | 'exhausted' | 'missing' | 'updated';

export interface EmailCodeChallengeStore {
  create(input: {
    challengeId: string;
    codeDigest: string;
    host: string;
    now: Date;
    ttlSeconds: number;
    userId: string;
  }): Promise<void>;
  remove(challengeId: string): Promise<void>;
  replace(input: {
    challengeId: string;
    codeDigest: string;
    cooldownSeconds: number;
    host: string;
    maxSends: number;
    now: Date;
    ttlSeconds: number;
    userId: string;
  }): Promise<EmailCodeResendResult>;
  verify(input: {
    challengeId: string;
    codeDigest: string;
    host: string;
    maxAttempts: number;
    now: Date;
    userId: string;
  }): Promise<EmailCodeVerificationResult>;
}

export interface VerificationCodeNotifier {
  send(input: {
    code: string;
    expiresAt: Date;
    host: string;
    normalizedEmail: string;
  }): Promise<void>;
}

export interface PasswordRecoveryNotifier {
  send(input: { host: string; normalizedEmail: string; token: string }): Promise<void>;
}

export interface PendingOwnerBootstrap {
  encryptedMfaSecret?: Uint8Array;
  keyVersion?: number;
  method: 'email_code' | 'totp';
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
  | {
      audience: 'customer' | 'platform';
      kind: 'authenticated';
      recoveryRestricted?: true;
      sessionToken: string;
    }
  | { challengeId: string; kind: 'mfa-required'; methods?: VerificationMethod[] }
  | { kind: 'invalid' };

export type EmailCodePolicyChangeResult =
  { recoveryCodes: string[]; sessionsRevoked: true } | undefined;

export class AuthenticationService {
  readonly #dummyPasswordHash: Promise<string>;
  readonly #mfaKeyring: VersionedSecretKeyring;
  readonly #authenticationPepper: string;

  constructor(
    private readonly repository: AuthenticationRepository,
    private readonly challenges: MfaChallengeStore,
    private readonly recoveryNotifier: PasswordRecoveryNotifier,
    private readonly options: {
      attemptLimiter?: AuthenticationRateLimiter;
      authenticationPepper?: string;
      emailCodeStore?: EmailCodeChallengeStore;
      factorEnrollmentStore?: OwnerBootstrapPendingStore;
      mfaEncryptionKey?: string;
      mfaEncryptionKeyring?: VersionedSecretKeyring;
      now?: () => Date;
      orapHostname: string;
      ownerBootstrapStore?: OwnerBootstrapPendingStore;
      recoveryTtlMs?: number;
      sessionTtlMs?: number;
      verificationNotifier?: VerificationCodeNotifier;
      verifyWebAuthnAuthentication?: typeof verifyExactHostWebAuthnAuthentication;
      verifyWebAuthnRegistration?: typeof verifyExactHostWebAuthnRegistration;
      webAuthnAuthenticationEnabled?: boolean;
      webAuthnCeremonies?: WebAuthnCeremonyStore;
      webAuthnRepository?: WebAuthnEnrollmentRepository;
    },
  ) {
    this.#mfaKeyring =
      options.mfaEncryptionKeyring ??
      parseVersionedSecretKeyring(undefined, options.mfaEncryptionKey);
    this.#authenticationPepper =
      options.authenticationPepper ?? activeSecretKey(this.#mfaKeyring).keyMaterial;
    if (this.#authenticationPepper.length < 32) {
      throw new Error('Authentication pepper is too short');
    }
    this.#dummyPasswordHash = hashPassword(`missing-${randomUUID()}-credential`);
  }

  async login(input: {
    email: string;
    host: string;
    networkIdentifier?: string;
    password: string;
    traceId: string;
  }): Promise<AuthenticationResult> {
    if (
      !(await this.allowAttempt(
        'login_attempt',
        `${rateLimitHost(input.host)}\0${input.email}`,
        input.networkIdentifier,
        10,
        50,
        15 * 60,
      ))
    ) {
      return { kind: 'invalid' };
    }
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
    return this.continueAfterPassword(target, input.traceId, input.networkIdentifier);
  }

  async acceptInvitation(input: {
    displayName: string;
    host: string;
    networkIdentifier?: string;
    password: string;
    token: string;
    traceId: string;
  }): Promise<AuthenticationResult> {
    const tokenHash = digestToken(input.token);
    if (
      !(await this.allowAttempt(
        'invitation_acceptance',
        `${rateLimitHost(input.host)}\0${tokenHash}`,
        input.networkIdentifier,
        5,
        20,
        15 * 60,
      ))
    ) {
      return { kind: 'invalid' };
    }
    const target = await this.repository.acceptInvitation({
      displayName: input.displayName.trim(),
      host: input.host,
      now: this.now(),
      passwordHash: await hashPassword(input.password),
      verifyExistingPassword: (passwordHash) => verifyPassword(passwordHash, input.password),
      tokenHash,
      traceId: input.traceId,
    });
    return target
      ? this.continueAfterPassword(target, input.traceId, input.networkIdentifier)
      : { kind: 'invalid' };
  }

  async resendEmailCode(input: {
    challengeId: string;
    host: string;
    networkIdentifier?: string;
    sessionToken?: string;
  }): Promise<'cooldown' | 'sent' | 'unavailable'> {
    const challenge = await this.challenges.read(input.challengeId);
    if (
      !challenge ||
      challenge.host !== input.host ||
      !challenge.methods.includes('email_code') ||
      (challenge.sessionTokenHash !== undefined &&
        digestToken(input.sessionToken ?? '') !== challenge.sessionTokenHash)
    ) {
      return 'unavailable';
    }
    const store = this.options.emailCodeStore;
    const notifier = this.options.verificationNotifier;
    if (!store || !notifier) return 'unavailable';
    if (
      !(await this.allowAttempt(
        'email_code_issue',
        `${challenge.host}\0${challenge.userId}`,
        input.networkIdentifier,
        5,
        20,
        15 * 60,
      ))
    ) {
      return 'unavailable';
    }
    const code = createEmailVerificationCode();
    const now = this.now();
    const result = await store.replace({
      challengeId: input.challengeId,
      codeDigest: this.emailCodeDigest(input.challengeId, challenge, code),
      cooldownSeconds: 60,
      host: challenge.host,
      maxSends: 3,
      now,
      ttlSeconds: 300,
      userId: challenge.userId,
    });
    if (result === 'cooldown') return 'cooldown';
    if (result !== 'updated') return 'unavailable';
    if (!(await this.challenges.refresh(input.challengeId, challenge, 300))) {
      await store.remove(input.challengeId);
      return 'unavailable';
    }
    try {
      await notifier.send({
        code,
        expiresAt: new Date(now.getTime() + 5 * 60_000),
        host: challenge.host,
        normalizedEmail: challenge.normalizedEmail,
      });
      return 'sent';
    } catch {
      await store.remove(input.challengeId);
      if (
        !challenge.recoveryCodeAllowed &&
        !challenge.methods.some((method) => method !== 'email_code')
      ) {
        await this.challenges.consume(input.challengeId);
      }
      return 'unavailable';
    }
  }

  async verifyMfa(input: {
    challengeId: string;
    code: string;
    host: string;
    networkIdentifier?: string;
    traceId: string;
  }): Promise<AuthenticationResult> {
    const challenge = await this.challenges.read(input.challengeId);
    if (
      !challenge ||
      challenge.host !== input.host ||
      (challenge.purpose !== undefined && challenge.purpose !== 'login') ||
      challenge.policyChange !== undefined ||
      challenge.sessionTokenHash !== undefined ||
      !challenge.authStateDigest
    ) {
      return { kind: 'invalid' };
    }
    if (
      !(await this.allowAttempt(
        'verification_attempt',
        `${challenge.host}\0${challenge.userId}`,
        input.networkIdentifier,
        10,
        50,
        15 * 60,
      ))
    ) {
      return { kind: 'invalid' };
    }
    const currentTarget = await this.repository.findLoginTarget({
      host: challenge.host,
      normalizedEmail: challenge.normalizedEmail,
    });
    if (
      !currentTarget ||
      currentTarget.userId !== challenge.userId ||
      currentTarget.siteId !== challenge.siteId ||
      currentTarget.tenantId !== challenge.tenantId
    ) {
      return { kind: 'invalid' };
    }
    const currentFactor = await this.repository.findMfaFactor(challenge.userId);
    if (
      !safeDigestEqual(
        challenge.authStateDigest,
        this.authStateDigest(currentTarget, currentFactor?.id, challenge.methods),
      )
    ) {
      return { kind: 'invalid' };
    }
    const compactCode = input.code.replace(/[\s-]/gu, '').toUpperCase();
    let method: SessionAuthenticationMethod | undefined;
    let recoveryCodeHash: string | undefined;
    if (/^\d{8}$/u.test(compactCode) && challenge.methods.includes('email_code')) {
      const result = await this.options.emailCodeStore?.verify({
        challengeId: input.challengeId,
        codeDigest: this.emailCodeDigest(input.challengeId, challenge, compactCode),
        host: challenge.host,
        maxAttempts: 5,
        now: this.now(),
        userId: challenge.userId,
      });
      if (result === 'verified') method = 'email_code';
    } else if (/^\d{6}$/u.test(compactCode) && challenge.methods.includes('totp')) {
      if (currentFactor) {
        const keyMaterial = secretKeyForVersion(this.#mfaKeyring, currentFactor.keyVersion);
        if (!keyMaterial) return { kind: 'invalid' };
        let secret: string;
        try {
          secret = decryptMfaSecret(currentFactor.encryptedSecret, keyMaterial);
        } catch {
          return { kind: 'invalid' };
        }
        const counter = verifyTotpCounter(secret, compactCode, this.now().getTime());
        if (
          counter !== undefined &&
          (await this.repository.consumeTotpCounter({ counter, factorId: currentFactor.id }))
        ) {
          method = 'totp';
        }
      }
    } else if (challenge.recoveryCodeAllowed && /^[A-F0-9]{16}$/u.test(compactCode)) {
      recoveryCodeHash = digestToken(formatRecoveryCode(compactCode));
      const valid = await this.repository.checkRecoveryCode({
        codeHash: recoveryCodeHash,
        userId: challenge.userId,
      });
      if (valid) method = 'recovery_code';
    }
    if (!method) return { kind: 'invalid' };
    const consumed = await this.challenges.consume(input.challengeId);
    if (!consumed || consumed.userId !== challenge.userId || consumed.host !== challenge.host) {
      return { kind: 'invalid' };
    }
    return this.createSession(
      currentTarget,
      input.traceId,
      method,
      method === 'totp' ? currentFactor?.id : undefined,
      recoveryCodeHash,
    );
  }

  async requestPasswordRecovery(input: {
    host: string;
    networkIdentifier?: string;
    normalizedEmail: string;
    traceId: string;
  }): Promise<void> {
    if (
      !(await this.allowAttempt(
        'password_recovery_issue',
        `${rateLimitHost(input.host)}\0${input.normalizedEmail}`,
        input.networkIdentifier,
        3,
        20,
        60 * 60,
      ))
    ) {
      return;
    }
    const token = createOneTimeToken();
    const target = await this.repository.createPasswordRecovery({
      expiresAt: new Date(this.now().getTime() + (this.options.recoveryTtlMs ?? 30 * 60_000)),
      host: input.host,
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
  > {
    const pendingStore = this.options.ownerBootstrapStore;
    if (!pendingStore || !this.isOrapHost(input.host)) {
      throw new Error('Owner bootstrap is unavailable');
    }
    const tokenHash = digestToken(input.token);
    if (!(await this.repository.verifyOwnerBootstrap({ now: this.now(), tokenHash }))) {
      return undefined;
    }
    const method = input.method ?? 'totp';
    if (method === 'totp') {
      const enrollment = createMfaEnrollment(input.normalizedEmail);
      const activeKey = activeSecretKey(this.#mfaKeyring);
      const setupId = await pendingStore.create(
        {
          encryptedMfaSecret: encryptMfaSecret(enrollment.secret, activeKey.keyMaterial),
          keyVersion: activeKey.keyVersion,
          method,
          normalizedEmail: input.normalizedEmail,
          recoveryCodeHashes: enrollment.recoveryDigests,
          tokenHash,
        },
        10 * 60,
      );
      return {
        method,
        recoveryCodes: enrollment.recoveryCodes,
        setupId,
        uri: enrollment.uri,
      };
    }
    const recovery = createRecoveryCodes();
    const setupId = await pendingStore.create(
      {
        method,
        normalizedEmail: input.normalizedEmail,
        recoveryCodeHashes: recovery.recoveryDigests,
        tokenHash,
      },
      10 * 60,
    );
    const bootstrapChallenge: MfaChallenge = {
      host: input.host,
      methods: ['email_code'],
      normalizedEmail: input.normalizedEmail,
      traceId: input.traceId,
      userId: bootstrapUserId(tokenHash),
    };
    try {
      await this.issueEmailCode(setupId, bootstrapChallenge, input.networkIdentifier);
    } catch {
      await pendingStore.consume(setupId);
      return undefined;
    }
    return { method, recoveryCodes: recovery.recoveryCodes, setupId };
  }

  async completeOwnerBootstrap(input: {
    code: string;
    displayName: string;
    host: string;
    networkIdentifier?: string;
    newPassword: string;
    recoveryCodesAcknowledged: boolean;
    setupId: string;
    traceId: string;
    token: string;
  }): Promise<boolean> {
    const pendingStore = this.options.ownerBootstrapStore;
    if (!pendingStore || !this.isOrapHost(input.host)) {
      throw new Error('Owner bootstrap is unavailable');
    }
    if (input.recoveryCodesAcknowledged !== true) return false;
    const pending = await pendingStore.read(input.setupId);
    const tokenHash = digestToken(input.token);
    if (!pending || pending.tokenHash !== tokenHash) return false;
    if (
      !(await this.allowAttempt(
        'verification_attempt',
        `${rateLimitHost(input.host)}\0${bootstrapUserId(tokenHash)}`,
        input.networkIdentifier,
        10,
        50,
        15 * 60,
      ))
    ) {
      return false;
    }
    let lastUsedCounter: number | undefined;
    if (pending.method === 'totp') {
      if (!pending.encryptedMfaSecret) return false;
      const keyMaterial = secretKeyForVersion(this.#mfaKeyring, pending.keyVersion ?? 1);
      if (!keyMaterial) return false;
      let secret: string;
      try {
        secret = decryptMfaSecret(pending.encryptedMfaSecret, keyMaterial);
      } catch {
        return false;
      }
      lastUsedCounter = verifyTotpCounter(secret, input.code, this.now().getTime());
      if (lastUsedCounter === undefined) return false;
    } else {
      const code = input.code.replace(/\s/gu, '');
      if (!/^\d{8}$/u.test(code)) return false;
      const challenge: MfaChallenge = {
        host: input.host,
        methods: ['email_code'],
        normalizedEmail: pending.normalizedEmail,
        traceId: input.traceId,
        userId: bootstrapUserId(tokenHash),
      };
      const verified = await this.options.emailCodeStore?.verify({
        challengeId: input.setupId,
        codeDigest: this.emailCodeDigest(input.setupId, challenge, code),
        host: input.host,
        maxAttempts: 5,
        now: this.now(),
        userId: challenge.userId,
      });
      if (verified !== 'verified') return false;
    }
    const completed = await this.repository.completeOwnerBootstrap({
      displayName: input.displayName.trim(),
      ...(pending.encryptedMfaSecret
        ? {
            encryptedMfaSecret: pending.encryptedMfaSecret,
            keyVersion: pending.keyVersion ?? 1,
            ...(lastUsedCounter === undefined ? {} : { lastUsedCounter }),
          }
        : {}),
      method: pending.method,
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
    host: string;
    networkIdentifier?: string;
    newPassword: string;
    token: string;
    traceId: string;
  }): Promise<boolean> {
    const tokenHash = digestToken(input.token);
    if (
      !(await this.allowAttempt(
        'password_recovery_completion',
        `${rateLimitHost(input.host)}\0${tokenHash}`,
        input.networkIdentifier,
        5,
        20,
        15 * 60,
      ))
    ) {
      return false;
    }
    const newPasswordHash = await hashPassword(input.newPassword);
    return this.repository.completePasswordRecovery({
      host: input.host,
      newPasswordHash,
      now: this.now(),
      traceId: input.traceId,
      tokenHash,
    });
  }

  async completeCustomerRecovery(input: {
    currentPassword: string;
    host: string;
    networkIdentifier?: string;
    recoveryConfirmed: boolean;
    sessionToken: string | undefined;
    traceId: string;
  }): Promise<{ recoveryCodes: string[]; sessionsRevoked: true } | undefined> {
    if (
      !input.sessionToken ||
      input.recoveryConfirmed !== true ||
      input.currentPassword.length < 1 ||
      input.currentPassword.length > 128 ||
      this.isOrapHost(input.host)
    ) {
      return undefined;
    }
    const sessionTokenHash = this.recoverySessionTokenDigest(input.sessionToken);
    if (
      !(await this.allowAttempt(
        'customer_recovery_completion',
        `${rateLimitHost(input.host)}\0${sessionTokenHash}`,
        input.networkIdentifier,
        3,
        10,
        15 * 60,
      ))
    ) {
      return undefined;
    }
    const recovery = createRecoveryCodes();
    const completed = await this.repository.completeCustomerRecovery({
      confirmed: true,
      host: input.host,
      now: this.now(),
      recoveryCodeHashes: recovery.recoveryDigests,
      sessionTokenHash,
      traceId: input.traceId,
      verifyCurrentPassword: (passwordHash) => verifyPassword(passwordHash, input.currentPassword),
    });
    return completed ? { recoveryCodes: recovery.recoveryCodes, sessionsRevoked: true } : undefined;
  }

  async logout(sessionToken: string | undefined, host: string, traceId: string): Promise<void> {
    if (!sessionToken) return;
    await this.repository.revokeSessionByToken({
      host,
      now: this.now(),
      tokenHash: digestToken(sessionToken),
      traceId,
    });
    // Recovery sessions use a keyed, domain-separated digest. That deliberately makes
    // them unreadable to a pre-policy application rollback, while still allowing an
    // explicit logout to revoke one when this release is active.
    await this.repository.revokeSessionByToken({
      host,
      now: this.now(),
      tokenHash: this.recoverySessionTokenDigest(sessionToken),
      traceId,
    });
  }

  async listSessions(sessionToken: string | undefined, host: string): Promise<SessionRecord[]> {
    if (!sessionToken) return [];
    const owner = await this.repository.findSessionOwner({
      host,
      tokenHash: digestToken(sessionToken),
    });
    return owner ? this.repository.listSessions(owner) : [];
  }

  async revokeSession(input: {
    currentToken: string | undefined;
    host: string;
    sessionId: string;
    traceId: string;
  }): Promise<boolean> {
    if (!input.currentToken) return false;
    const owner = await this.repository.findSessionOwner({
      host: input.host,
      tokenHash: digestToken(input.currentToken),
    });
    if (!owner) return false;
    return this.repository.revokeSession({
      currentUserId: owner.userId,
      host: owner.host,
      now: this.now(),
      sessionId: input.sessionId,
      ...(owner.siteId ? { siteId: owner.siteId } : {}),
      ...(owner.tenantId ? { tenantId: owner.tenantId } : {}),
      traceId: input.traceId,
    });
  }

  async securitySettings(
    sessionToken: string | undefined,
    host: string,
  ): Promise<AccountSecuritySettings | undefined> {
    if (!sessionToken) return undefined;
    const target = await this.repository.findAccountSecurityTarget({
      host,
      tokenHash: digestToken(sessionToken),
    });
    if (!target) return undefined;
    const webauthnCredentials = this.options.webAuthnRepository?.listActiveCredentials
      ? await this.options.webAuthnRepository.listActiveCredentials({
          host: target.host,
          ...(target.siteId ? { siteId: target.siteId } : {}),
          ...(target.tenantId ? { tenantId: target.tenantId } : {}),
          userId: target.userId,
        })
      : [];
    return {
      emailCodeEnabled: target.emailCodeEnabled,
      emailPolicyChangeAllowed: target.role.startsWith('customer_'),
      secondStepRequired: target.secondStepRequired,
      totpEnabled: target.hasTotp,
      webauthnEnabled: target.hasWebAuthn,
      webauthnEnrollmentAvailable: this.webAuthnEnrollmentAvailable(),
      webauthnCredentials: webauthnCredentials.map((credential) => ({
        backedUp: credential.backedUp,
        createdAt: credential.createdAt,
        deviceType: credential.deviceType,
        id: credential.id,
        ...(credential.lastUsedAt ? { lastUsedAt: credential.lastUsedAt } : {}),
        name: credential.name,
      })),
    };
  }

  async prepareCustomerTotpEnrollment(input: {
    currentPassword: string;
    host: string;
    networkIdentifier?: string;
    sessionToken: string | undefined;
    traceId: string;
  }): Promise<{ recoveryCodes: string[]; setupId: string; uri: string } | undefined> {
    const store = this.options.factorEnrollmentStore;
    if (!store || !input.sessionToken || this.isOrapHost(input.host)) return undefined;
    if (input.currentPassword.length < 1 || input.currentPassword.length > 128) return undefined;
    const sessionTokenHash = digestToken(input.sessionToken);
    const target = await this.repository.findAccountSecurityTarget({
      host: input.host,
      tokenHash: sessionTokenHash,
    });
    if (
      !target ||
      !target.role.startsWith('customer_') ||
      target.hasTotp ||
      !(await verifyPassword(target.passwordHash, input.currentPassword)) ||
      !(await this.allowAttempt(
        'totp_enrollment',
        `${rateLimitHost(input.host)}\0${target.userId}`,
        input.networkIdentifier,
        5,
        20,
        15 * 60,
      ))
    ) {
      return undefined;
    }
    const enrollment = createMfaEnrollment(target.normalizedEmail);
    const activeKey = activeSecretKey(this.#mfaKeyring);
    const setupId = await store.create(
      {
        encryptedMfaSecret: encryptMfaSecret(enrollment.secret, activeKey.keyMaterial),
        keyVersion: activeKey.keyVersion,
        method: 'totp',
        normalizedEmail: target.normalizedEmail,
        recoveryCodeHashes: enrollment.recoveryDigests,
        tokenHash: sessionTokenHash,
      },
      10 * 60,
    );
    return { recoveryCodes: enrollment.recoveryCodes, setupId, uri: enrollment.uri };
  }

  async completeCustomerTotpEnrollment(input: {
    code: string;
    host: string;
    networkIdentifier?: string;
    recoveryCodesAcknowledged: boolean;
    sessionToken: string | undefined;
    setupId: string;
    traceId: string;
  }): Promise<{ sessionsRevoked: true } | undefined> {
    const store = this.options.factorEnrollmentStore;
    if (
      !store ||
      !input.sessionToken ||
      !input.recoveryCodesAcknowledged ||
      this.isOrapHost(input.host)
    ) {
      return undefined;
    }
    const sessionTokenHash = digestToken(input.sessionToken);
    const pending = await store.read(input.setupId);
    const target = await this.repository.findAccountSecurityTarget({
      host: input.host,
      tokenHash: sessionTokenHash,
    });
    if (
      !pending?.encryptedMfaSecret ||
      pending.method !== 'totp' ||
      pending.tokenHash !== sessionTokenHash ||
      !target ||
      !target.role.startsWith('customer_') ||
      target.hasTotp ||
      target.normalizedEmail !== pending.normalizedEmail ||
      !(await this.allowAttempt(
        'totp_enrollment',
        `${rateLimitHost(input.host)}\0${target.userId}`,
        input.networkIdentifier,
        10,
        50,
        15 * 60,
      ))
    ) {
      return undefined;
    }
    const keyVersion = pending.keyVersion ?? 1;
    const keyMaterial = secretKeyForVersion(this.#mfaKeyring, keyVersion);
    if (!keyMaterial) return undefined;
    let secret: string;
    try {
      secret = decryptMfaSecret(pending.encryptedMfaSecret, keyMaterial);
    } catch {
      return undefined;
    }
    const counter = verifyTotpCounter(secret, input.code.replace(/\s/gu, ''), this.now().getTime());
    if (counter === undefined) return undefined;
    const updated = await this.repository.updateCustomerTotpPolicy({
      enabled: true,
      encryptedSecret: pending.encryptedMfaSecret,
      host: input.host,
      keyVersion,
      lastUsedCounter: counter,
      now: this.now(),
      recoveryCodeHashes: pending.recoveryCodeHashes,
      sessionTokenHash,
      traceId: input.traceId,
      userId: target.userId,
    });
    if (!updated) return undefined;
    await store.consume(input.setupId);
    return { sessionsRevoked: true };
  }

  async disableCustomerTotp(input: {
    confirmed: boolean;
    currentPassword: string;
    host: string;
    sessionToken: string | undefined;
    traceId: string;
  }): Promise<{ sessionsRevoked: true } | undefined> {
    if (
      !input.sessionToken ||
      !input.confirmed ||
      input.currentPassword.length < 1 ||
      input.currentPassword.length > 128 ||
      this.isOrapHost(input.host)
    ) {
      return undefined;
    }
    const sessionTokenHash = digestToken(input.sessionToken);
    const target = await this.repository.findAccountSecurityTarget({
      host: input.host,
      tokenHash: sessionTokenHash,
    });
    if (
      !target ||
      !target.role.startsWith('customer_') ||
      !target.hasTotp ||
      !(await verifyPassword(target.passwordHash, input.currentPassword))
    ) {
      return undefined;
    }
    const updated = await this.repository.updateCustomerTotpPolicy({
      enabled: false,
      host: input.host,
      now: this.now(),
      recoveryCodeHashes: [],
      sessionTokenHash,
      traceId: input.traceId,
      userId: target.userId,
    });
    return updated ? { sessionsRevoked: true } : undefined;
  }

  async prepareWebAuthnEnrollment(input: {
    credentialName: string;
    currentPassword: string;
    host: string;
    networkIdentifier?: string;
    sessionToken: string | undefined;
    traceId: string;
  }): Promise<WebAuthnEnrollmentPreparation | undefined> {
    const repository = this.options.webAuthnRepository;
    const ceremonies = this.options.webAuthnCeremonies;
    if (!this.webAuthnEnrollmentAvailable() || !repository || !ceremonies || !input.sessionToken) {
      return undefined;
    }
    const credentialName = input.credentialName.trim();
    if (
      input.currentPassword.length < 1 ||
      input.currentPassword.length > 128 ||
      credentialName.length < 1 ||
      credentialName.length > 80 ||
      /[\u0000-\u001f\u007f]/u.test(credentialName)
    ) {
      return undefined;
    }
    const sessionTokenHash = digestToken(input.sessionToken);
    const target = await repository.findEnrollmentTarget({
      host: input.host,
      now: this.now(),
      sessionTokenHash,
    });
    if (
      !target ||
      target.activeCredentialCount >= 10 ||
      (!target.emailCodeEnabled && !target.hasTotp && !target.hasWebAuthn) ||
      !(await this.allowAttempt(
        'webauthn_enrollment',
        `${rateLimitHost(input.host)}\0${target.userId}`,
        input.networkIdentifier,
        5,
        20,
        15 * 60,
      )) ||
      !(await verifyPassword(target.passwordHash, input.currentPassword))
    ) {
      return undefined;
    }
    const relyingParty = resolveWebAuthnRelyingParty(target.host);
    if (target.rpId !== relyingParty.id) return undefined;
    const options = await createWebAuthnRegistrationOptions({
      credentials: target.credentials,
      displayName: target.displayName,
      relyingParty,
      userHandle: target.userHandle,
      userName: target.normalizedEmail,
    });
    const recovery = createRecoveryCodes();
    const ceremonyId = await ceremonies.create({
      authStateVersion: target.authStateVersion,
      challenge: options.challenge,
      credentialName,
      credentialStateDigest: this.webAuthnCredentialStateDigest(target.passwordHash),
      host: relyingParty.id,
      origin: relyingParty.origin,
      purpose: 'registration',
      recoveryCodeHashes: recovery.recoveryDigests,
      rpId: relyingParty.id,
      scopeId: target.id,
      sessionTokenHash,
      ...(target.siteId ? { siteId: target.siteId } : {}),
      ...(target.tenantId ? { tenantId: target.tenantId } : {}),
      traceId: input.traceId,
      userHandle: Buffer.from(target.userHandle).toString('base64url'),
      userId: target.userId,
    });
    return { ceremonyId, options, recoveryCodes: recovery.recoveryCodes };
  }

  async completeWebAuthnEnrollment(input: {
    ceremonyId: string;
    host: string;
    networkIdentifier?: string;
    recoveryCodesAcknowledged: boolean;
    response: WebAuthnRegistrationResponse;
    sessionToken: string | undefined;
    traceId: string;
  }): Promise<{ sessionsRevoked: true } | undefined> {
    const repository = this.options.webAuthnRepository;
    const ceremonies = this.options.webAuthnCeremonies;
    if (
      !this.webAuthnEnrollmentAvailable() ||
      !repository ||
      !ceremonies ||
      !input.sessionToken ||
      !input.recoveryCodesAcknowledged ||
      !input.ceremonyId
    ) {
      return undefined;
    }
    const sessionTokenHash = digestToken(input.sessionToken);
    const ceremony = await ceremonies.consume(input.ceremonyId);
    if (
      !ceremony ||
      ceremony.purpose !== 'registration' ||
      ceremony.host !== rateLimitHost(input.host) ||
      ceremony.sessionTokenHash !== sessionTokenHash ||
      !(await this.allowAttempt(
        'webauthn_enrollment',
        `${ceremony.host}\0${ceremony.userId}`,
        input.networkIdentifier,
        5,
        20,
        15 * 60,
      ))
    ) {
      return undefined;
    }
    let verification: Awaited<ReturnType<typeof verifyExactHostWebAuthnRegistration>>;
    try {
      verification = await (
        this.options.verifyWebAuthnRegistration ?? verifyExactHostWebAuthnRegistration
      )({
        challenge: ceremony.challenge,
        relyingParty: {
          id: ceremony.rpId,
          name: 'OmniReach',
          origin: ceremony.origin,
        },
        response: input.response,
      });
    } catch {
      return undefined;
    }
    if (
      !verification.verified ||
      !verification.registrationInfo.userVerified ||
      verification.registrationInfo.origin !== ceremony.origin ||
      (verification.registrationInfo.rpID !== undefined &&
        verification.registrationInfo.rpID !== ceremony.rpId)
    ) {
      return undefined;
    }
    const credential = verification.registrationInfo.credential;
    const credentialId = new Uint8Array(Buffer.from(credential.id, 'base64url'));
    const publicKey = new Uint8Array(credential.publicKey);
    const signCount = credential.counter;
    const transports = normalizeWebAuthnTransports(input.response.response.transports);
    if (
      credentialId.byteLength < 1 ||
      credentialId.byteLength > 1023 ||
      publicKey.byteLength < 1 ||
      publicKey.byteLength > 4096 ||
      !Number.isSafeInteger(signCount) ||
      signCount < 0 ||
      signCount > 4_294_967_295 ||
      !transports
    ) {
      return undefined;
    }
    const completed = await repository.completeEnrollment({
      backedUp: verification.registrationInfo.credentialBackedUp,
      backupEligible: verification.registrationInfo.credentialDeviceType === 'multiDevice',
      credentialId,
      credentialName: ceremony.credentialName,
      credentialStateDigest: ceremony.credentialStateDigest,
      deviceType: verification.registrationInfo.credentialDeviceType,
      expectedAuthStateVersion: ceremony.authStateVersion,
      host: ceremony.host,
      now: this.now(),
      publicKey,
      recoveryCodeHashes: ceremony.recoveryCodeHashes,
      scopeId: ceremony.scopeId,
      sessionTokenHash,
      signCount,
      ...(ceremony.siteId ? { siteId: ceremony.siteId } : {}),
      ...(ceremony.tenantId ? { tenantId: ceremony.tenantId } : {}),
      traceId: input.traceId,
      transports,
      userHandle: new Uint8Array(Buffer.from(ceremony.userHandle, 'base64url')),
      userId: ceremony.userId,
      verifyCredentialState: (passwordHash, expectedDigest) =>
        safeDigestEqual(this.webAuthnCredentialStateDigest(passwordHash), expectedDigest),
    });
    return completed ? { sessionsRevoked: true } : undefined;
  }

  async prepareWebAuthnAuthentication(input: {
    challengeId: string;
    host: string;
    networkIdentifier?: string;
  }): Promise<WebAuthnAuthenticationPreparation | undefined> {
    const repository = this.options.webAuthnRepository;
    const ceremonies = this.options.webAuthnCeremonies;
    if (
      !this.webAuthnEnrollmentAvailable() ||
      !repository?.findScope ||
      !repository.listActiveCredentials ||
      !ceremonies
    ) {
      return undefined;
    }
    const challenge = await this.challenges.read(input.challengeId);
    if (
      !challenge ||
      challenge.host !== rateLimitHost(input.host) ||
      challenge.purpose !== 'login' ||
      !challenge.methods.includes('webauthn') ||
      !challenge.authStateDigest ||
      !(await this.allowAttempt(
        'webauthn_authentication',
        `${challenge.host}\0${challenge.userId}`,
        input.networkIdentifier,
        10,
        50,
        15 * 60,
      ))
    ) {
      return undefined;
    }
    const currentTarget = await this.repository.findLoginTarget({
      host: challenge.host,
      normalizedEmail: challenge.normalizedEmail,
    });
    const currentFactor = await this.repository.findMfaFactor(challenge.userId);
    if (
      !currentTarget ||
      currentTarget.userId !== challenge.userId ||
      currentTarget.siteId !== challenge.siteId ||
      currentTarget.tenantId !== challenge.tenantId ||
      !safeDigestEqual(
        challenge.authStateDigest,
        this.authStateDigest(currentTarget, currentFactor?.id, challenge.methods),
      )
    ) {
      return undefined;
    }
    const target = {
      host: challenge.host,
      ...(challenge.siteId ? { siteId: challenge.siteId } : {}),
      ...(challenge.tenantId ? { tenantId: challenge.tenantId } : {}),
      userId: challenge.userId,
    };
    const [scope, credentials] = await Promise.all([
      repository.findScope(target),
      repository.listActiveCredentials(target),
    ]);
    if (!scope || credentials.length === 0) return undefined;
    const relyingParty = resolveWebAuthnRelyingParty(challenge.host);
    const options = await createWebAuthnAuthenticationOptions({ credentials, relyingParty });
    const ceremonyId = await ceremonies.create({
      authStateVersion: currentTarget.authStateVersion,
      baseChallengeDigest: this.webAuthnBaseChallengeDigest(
        input.challengeId,
        challenge.authStateDigest,
      ),
      challenge: options.challenge,
      host: challenge.host,
      origin: relyingParty.origin,
      purpose: 'authentication',
      rpId: relyingParty.id,
      scopeId: scope.id,
      ...(challenge.siteId ? { siteId: challenge.siteId } : {}),
      ...(challenge.tenantId ? { tenantId: challenge.tenantId } : {}),
      traceId: challenge.traceId,
      userHandle: Buffer.from(scope.userHandle).toString('base64url'),
      userId: challenge.userId,
    });
    return { ceremonyId, options };
  }

  async completeWebAuthnAuthentication(input: {
    challengeId: string;
    ceremonyId: string;
    host: string;
    networkIdentifier?: string;
    response: WebAuthnAuthenticationResponse;
    traceId: string;
  }): Promise<AuthenticationResult> {
    const repository = this.options.webAuthnRepository;
    const ceremonies = this.options.webAuthnCeremonies;
    if (
      !this.webAuthnEnrollmentAvailable() ||
      !repository?.findActiveCredential ||
      !repository.completeAuthentication ||
      !ceremonies
    ) {
      return { kind: 'invalid' };
    }
    const ceremony = await ceremonies.consume(input.ceremonyId);
    const challenge = await this.challenges.read(input.challengeId);
    if (
      !ceremony ||
      ceremony.purpose !== 'authentication' ||
      ceremony.host !== rateLimitHost(input.host) ||
      !challenge ||
      challenge.host !== ceremony.host ||
      challenge.userId !== ceremony.userId ||
      challenge.purpose !== 'login' ||
      !challenge.methods.includes('webauthn') ||
      !challenge.authStateDigest ||
      !safeDigestEqual(
        ceremony.baseChallengeDigest,
        this.webAuthnBaseChallengeDigest(input.challengeId, challenge.authStateDigest),
      ) ||
      !(await this.allowAttempt(
        'webauthn_authentication',
        `${ceremony.host}\0${ceremony.userId}`,
        input.networkIdentifier,
        10,
        50,
        15 * 60,
      ))
    ) {
      return { kind: 'invalid' };
    }
    const currentTarget = await this.repository.findLoginTarget({
      host: challenge.host,
      normalizedEmail: challenge.normalizedEmail,
    });
    const currentFactor = await this.repository.findMfaFactor(challenge.userId);
    if (
      !currentTarget ||
      currentTarget.userId !== ceremony.userId ||
      currentTarget.authStateVersion !== ceremony.authStateVersion ||
      currentTarget.siteId !== ceremony.siteId ||
      currentTarget.tenantId !== ceremony.tenantId ||
      !safeDigestEqual(
        challenge.authStateDigest,
        this.authStateDigest(currentTarget, currentFactor?.id, challenge.methods),
      )
    ) {
      return { kind: 'invalid' };
    }
    let credentialId: Uint8Array;
    try {
      credentialId = new Uint8Array(Buffer.from(input.response.id, 'base64url'));
    } catch {
      return { kind: 'invalid' };
    }
    const target = {
      host: ceremony.host,
      ...(ceremony.siteId ? { siteId: ceremony.siteId } : {}),
      ...(ceremony.tenantId ? { tenantId: ceremony.tenantId } : {}),
      userId: ceremony.userId,
    };
    const credential = await repository.findActiveCredential({ credentialId, target });
    if (!credential) return { kind: 'invalid' };
    let verification: Awaited<ReturnType<typeof verifyExactHostWebAuthnAuthentication>>;
    try {
      verification = await (
        this.options.verifyWebAuthnAuthentication ?? verifyExactHostWebAuthnAuthentication
      )({
        challenge: ceremony.challenge,
        credential,
        relyingParty: { id: ceremony.rpId, name: 'OmniReach', origin: ceremony.origin },
        response: input.response,
      });
    } catch {
      return { kind: 'invalid' };
    }
    if (
      !verification.verified ||
      !verification.authenticationInfo.userVerified ||
      verification.authenticationInfo.origin !== ceremony.origin ||
      verification.authenticationInfo.rpID !== ceremony.rpId
    ) {
      return { kind: 'invalid' };
    }
    const consumed = await this.challenges.consume(input.challengeId);
    if (!consumed || consumed.userId !== challenge.userId || consumed.host !== challenge.host) {
      return { kind: 'invalid' };
    }
    const token = createOneTimeToken();
    const now = this.now();
    const created = await repository.completeAuthentication({
      credentialId,
      expectedAuthStateVersion: currentTarget.authStateVersion,
      expectedPasswordHash: currentTarget.passwordHash,
      expectedSignCount: credential.signCount,
      expiresAt: new Date(now.getTime() + (this.options.sessionTtlMs ?? 8 * 60 * 60_000)),
      host: ceremony.host,
      newSignCount: verification.authenticationInfo.newCounter,
      now,
      role: currentTarget.role,
      sessionTokenHash: token.digest,
      ...(ceremony.siteId ? { siteId: ceremony.siteId } : {}),
      ...(ceremony.tenantId ? { tenantId: ceremony.tenantId } : {}),
      traceId: input.traceId,
      userId: ceremony.userId,
    });
    return created
      ? {
          audience: currentTarget.tenantId && currentTarget.siteId ? 'customer' : 'platform',
          kind: 'authenticated',
          sessionToken: token.token,
        }
      : { kind: 'invalid' };
  }

  async renameWebAuthnCredential(input: {
    credentialId: string;
    currentPassword: string;
    host: string;
    name: string;
    sessionToken: string | undefined;
    traceId: string;
  }): Promise<boolean> {
    const repository = this.options.webAuthnRepository;
    const name = input.name.trim();
    if (
      !repository?.renameCredential ||
      !input.sessionToken ||
      name.length < 1 ||
      name.length > 80 ||
      /[\u0000-\u001f\u007f]/u.test(name)
    ) {
      return false;
    }
    const sessionTokenHash = digestToken(input.sessionToken);
    const target = await this.repository.findAccountSecurityTarget({
      host: input.host,
      tokenHash: sessionTokenHash,
    });
    if (!target || !(await verifyPassword(target.passwordHash, input.currentPassword))) {
      return false;
    }
    return repository.renameCredential({
      credentialId: input.credentialId,
      expectedPasswordHash: target.passwordHash,
      host: target.host,
      name,
      now: this.now(),
      sessionTokenHash,
      ...(target.siteId ? { siteId: target.siteId } : {}),
      ...(target.tenantId ? { tenantId: target.tenantId } : {}),
      traceId: input.traceId,
      userId: target.userId,
    });
  }

  async revokeWebAuthnCredential(input: {
    confirmed: boolean;
    credentialId: string;
    currentPassword: string;
    host: string;
    sessionToken: string | undefined;
    traceId: string;
  }): Promise<{ sessionsRevoked: true } | undefined> {
    const repository = this.options.webAuthnRepository;
    if (!repository?.revokeCredential || !input.sessionToken || !input.confirmed) {
      return undefined;
    }
    const sessionTokenHash = digestToken(input.sessionToken);
    const target = await this.repository.findAccountSecurityTarget({
      host: input.host,
      tokenHash: sessionTokenHash,
    });
    if (!target || !(await verifyPassword(target.passwordHash, input.currentPassword))) {
      return undefined;
    }
    const revoked = await repository.revokeCredential({
      credentialId: input.credentialId,
      expectedPasswordHash: target.passwordHash,
      host: target.host,
      now: this.now(),
      sessionTokenHash,
      ...(target.siteId ? { siteId: target.siteId } : {}),
      ...(target.tenantId ? { tenantId: target.tenantId } : {}),
      traceId: input.traceId,
      userId: target.userId,
    });
    return revoked ? { sessionsRevoked: true } : undefined;
  }

  async prepareCustomerEmailCodePolicyChange(input: {
    currentPassword: string;
    enabled: boolean;
    host: string;
    networkIdentifier?: string;
    sessionToken: string | undefined;
    traceId: string;
  }): Promise<{ challengeId: string } | undefined> {
    if (!input.sessionToken) return undefined;
    const sessionTokenHash = digestToken(input.sessionToken);
    const target = await this.repository.findAccountSecurityTarget({
      host: input.host,
      tokenHash: sessionTokenHash,
    });
    if (
      !target ||
      !target.role.startsWith('customer_') ||
      target.emailCodeEnabled === input.enabled
    ) {
      return undefined;
    }
    if (
      !(await this.allowAttempt(
        'login_attempt',
        `${target.host}\0${target.userId}`,
        input.networkIdentifier,
        10,
        50,
        15 * 60,
      )) ||
      !(await verifyPassword(target.passwordHash, input.currentPassword))
    ) {
      return undefined;
    }
    const challenge: MfaChallenge = {
      host: target.host,
      methods: ['email_code'],
      normalizedEmail: target.normalizedEmail,
      policyChange: input.enabled ? 'enable_email_code' : 'disable_email_code',
      purpose: 'email_policy_change',
      sessionTokenHash,
      ...(target.siteId ? { siteId: target.siteId } : {}),
      ...(target.tenantId ? { tenantId: target.tenantId } : {}),
      traceId: input.traceId,
      userId: target.userId,
    };
    const challengeId = await this.challenges.create(challenge, 300);
    try {
      await this.issueEmailCode(challengeId, challenge, input.networkIdentifier);
    } catch {
      await this.challenges.consume(challengeId);
      return undefined;
    }
    return { challengeId };
  }

  async completeCustomerEmailCodePolicyChange(input: {
    challengeId: string;
    code: string;
    host: string;
    networkIdentifier?: string;
    sessionToken: string | undefined;
    traceId: string;
  }): Promise<EmailCodePolicyChangeResult> {
    if (!input.sessionToken) return undefined;
    const sessionTokenHash = digestToken(input.sessionToken);
    const challenge = await this.challenges.read(input.challengeId);
    if (
      !challenge ||
      challenge.host !== input.host ||
      challenge.purpose !== 'email_policy_change' ||
      challenge.sessionTokenHash !== sessionTokenHash ||
      !challenge.policyChange
    ) {
      return undefined;
    }
    if (
      !(await this.allowAttempt(
        'verification_attempt',
        `${challenge.host}\0${challenge.userId}`,
        input.networkIdentifier,
        10,
        50,
        15 * 60,
      ))
    ) {
      return undefined;
    }
    const code = input.code.replace(/\s/gu, '');
    if (!/^\d{8}$/u.test(code)) return undefined;
    const verified = await this.options.emailCodeStore?.verify({
      challengeId: input.challengeId,
      codeDigest: this.emailCodeDigest(input.challengeId, challenge, code),
      host: challenge.host,
      maxAttempts: 5,
      now: this.now(),
      userId: challenge.userId,
    });
    if (verified !== 'verified') return undefined;
    const consumed = await this.challenges.consume(input.challengeId);
    if (
      !consumed ||
      consumed.userId !== challenge.userId ||
      consumed.host !== challenge.host ||
      consumed.sessionTokenHash !== sessionTokenHash ||
      consumed.policyChange !== challenge.policyChange
    ) {
      return undefined;
    }
    const enabled = challenge.policyChange === 'enable_email_code';
    const recovery = enabled ? createRecoveryCodes() : undefined;
    const updated = await this.repository.updateCustomerEmailCodePolicy({
      enabled,
      host: challenge.host,
      now: this.now(),
      recoveryCodeHashes: recovery?.recoveryDigests ?? [],
      sessionTokenHash,
      traceId: input.traceId,
      userId: challenge.userId,
    });
    return updated
      ? { recoveryCodes: recovery?.recoveryCodes ?? [], sessionsRevoked: true }
      : undefined;
  }

  private async continueAfterPassword(
    target: LoginTarget,
    traceId: string,
    networkIdentifier?: string,
  ): Promise<AuthenticationResult> {
    if (!target.verificationRequired) return this.createSession(target, traceId, 'password');
    const factor = await this.repository.findMfaFactor(target.userId);
    const emailCodeAvailable = Boolean(
      target.emailCodeEnabled && this.options.emailCodeStore && this.options.verificationNotifier,
    );
    const webAuthnAvailable = Boolean(
      this.webAuthnEnrollmentAvailable() &&
      this.options.webAuthnRepository?.listActiveCredentials &&
      (
        await this.options.webAuthnRepository.listActiveCredentials({
          host: target.host,
          ...(target.siteId ? { siteId: target.siteId } : {}),
          ...(target.tenantId ? { tenantId: target.tenantId } : {}),
          userId: target.userId,
        })
      ).length > 0,
    );
    const methods: VerificationMethod[] = [
      ...(emailCodeAvailable ? (['email_code'] as const) : []),
      ...(factor ? (['totp'] as const) : []),
      ...(webAuthnAvailable ? (['webauthn'] as const) : []),
    ];
    const customerRecoveryAvailable =
      target.hasRecoveryCodes &&
      target.role.startsWith('customer_') &&
      target.privilegedRecoveryRequired === false;
    if (methods.length === 0 && !customerRecoveryAvailable) return { kind: 'invalid' };
    const challenge = challengeFor(
      target,
      traceId,
      methods,
      this.authStateDigest(target, factor?.id, methods),
    );
    const challengeId = await this.challenges.create(challenge, 300);
    if (methods.includes('email_code')) {
      try {
        await this.issueEmailCode(challengeId, challenge, networkIdentifier);
      } catch {
        await this.challenges.consume(challengeId);
        if (!factor && !webAuthnAvailable && !customerRecoveryAvailable) {
          return { kind: 'invalid' };
        }
        const fallbackMethods: VerificationMethod[] = [
          ...(factor ? (['totp'] as const) : []),
          ...(webAuthnAvailable ? (['webauthn'] as const) : []),
        ];
        const fallback = challengeFor(
          target,
          traceId,
          fallbackMethods,
          this.authStateDigest(target, factor?.id, fallbackMethods),
        );
        const fallbackChallengeId = await this.challenges.create(fallback, 300);
        return {
          challengeId: fallbackChallengeId,
          kind: 'mfa-required',
          methods: fallbackMethods,
        };
      }
    }
    return { challengeId, kind: 'mfa-required', methods };
  }

  private async issueEmailCode(
    challengeId: string,
    challenge: MfaChallenge,
    networkIdentifier?: string,
  ): Promise<void> {
    const store = this.options.emailCodeStore;
    const notifier = this.options.verificationNotifier;
    if (!store || !notifier) throw new Error('Email verification is unavailable');
    if (
      !(await this.allowAttempt(
        'email_code_issue',
        `${challenge.host}\0${challenge.userId}`,
        networkIdentifier,
        5,
        20,
        15 * 60,
      ))
    ) {
      throw new Error('Email verification is unavailable');
    }
    const now = this.now();
    const code = createEmailVerificationCode();
    await store.create({
      challengeId,
      codeDigest: this.emailCodeDigest(challengeId, challenge, code),
      host: challenge.host,
      now,
      ttlSeconds: 300,
      userId: challenge.userId,
    });
    try {
      await notifier.send({
        code,
        expiresAt: new Date(now.getTime() + 300_000),
        host: challenge.host,
        normalizedEmail: challenge.normalizedEmail,
      });
    } catch (error) {
      await store.remove(challengeId);
      throw error;
    }
  }

  private emailCodeDigest(challengeId: string, challenge: MfaChallenge, code: string): string {
    return digestEmailVerificationCode({
      challengeId,
      code,
      host: challenge.host,
      keyMaterial: this.#authenticationPepper,
      userId: challenge.userId,
    });
  }

  private authStateDigest(
    target: LoginTarget,
    factorId: string | undefined,
    methods: VerificationMethod[],
  ): string {
    return createHmac('sha256', this.#authenticationPepper)
      .update('omnireach-login-auth-state-v1\0', 'utf8')
      .update(target.userId, 'utf8')
      .update('\0', 'utf8')
      .update(target.authStateVersion, 'utf8')
      .update('\0', 'utf8')
      .update(target.host, 'utf8')
      .update('\0', 'utf8')
      .update(target.tenantId ?? '', 'utf8')
      .update('\0', 'utf8')
      .update(target.siteId ?? '', 'utf8')
      .update('\0', 'utf8')
      .update(target.role, 'utf8')
      .update('\0', 'utf8')
      .update(target.passwordHash, 'utf8')
      .update('\0', 'utf8')
      .update(target.verificationRequired ? 'required' : 'optional', 'utf8')
      .update('\0', 'utf8')
      .update(target.emailCodeEnabled ? 'email-enabled' : 'email-disabled', 'utf8')
      .update('\0', 'utf8')
      .update(target.hasRecoveryCodes ? 'recovery-available' : 'recovery-unavailable', 'utf8')
      .update('\0', 'utf8')
      .update(
        target.privilegedRecoveryRequired ? 'privileged-recovery' : 'customer-recovery',
        'utf8',
      )
      .update('\0', 'utf8')
      .update(target.preferredMethod ?? '', 'utf8')
      .update('\0', 'utf8')
      .update(factorId ?? '', 'utf8')
      .update('\0', 'utf8')
      .update([...methods].sort().join(','), 'utf8')
      .digest('hex');
  }

  private async createSession(
    target: LoginTarget,
    traceId: string,
    authenticationMethod: SessionAuthenticationMethod,
    factorId?: string,
    recoveryCodeHash?: string,
  ): Promise<AuthenticationResult> {
    const token = createOneTimeToken();
    const recoveryRestricted = authenticationMethod === 'recovery_code';
    const now = this.now();
    const standardSessionTtlMs = this.options.sessionTtlMs ?? 8 * 60 * 60_000;
    const assuranceLevel: AuthenticationAssurance =
      authenticationMethod === 'password'
        ? 'basic'
        : authenticationMethod === 'email_code'
          ? 'baseline'
          : recoveryRestricted
            ? 'recovery'
            : 'strong';
    const created = await this.repository.createSession({
      assuranceLevel,
      authenticationMethod,
      expectedAuthStateVersion: target.authStateVersion,
      expectedPasswordHash: target.passwordHash,
      expiresAt: new Date(
        now.getTime() +
          (recoveryRestricted ? Math.min(15 * 60_000, standardSessionTtlMs) : standardSessionTtlMs),
      ),
      ...(factorId ? { factorId } : {}),
      host: target.host,
      recoveryRestricted,
      ...(recoveryCodeHash ? { recoveryCodeHash } : {}),
      role: target.role,
      ...(target.siteId ? { siteId: target.siteId } : {}),
      ...(target.tenantId ? { tenantId: target.tenantId } : {}),
      tokenHash: recoveryRestricted ? this.recoverySessionTokenDigest(token.token) : token.digest,
      traceId,
      userId: target.userId,
      ...(authenticationMethod === 'password' ? {} : { verifiedAt: now }),
    });
    if (!created) return { kind: 'invalid' };
    return {
      audience: target.tenantId && target.siteId ? 'customer' : 'platform',
      kind: 'authenticated',
      ...(recoveryRestricted ? { recoveryRestricted: true as const } : {}),
      sessionToken: token.token,
    };
  }

  private isOrapHost(host: string): boolean {
    return rateLimitHost(host) === rateLimitHost(this.options.orapHostname);
  }

  private webAuthnEnrollmentAvailable(): boolean {
    // Enrollment stays fail-closed until assertion/login support ships in the same
    // release. A credential must never make WebAuthn preferred or required while the
    // active binary cannot use it to authenticate.
    return Boolean(
      this.options.webAuthnAuthenticationEnabled &&
      this.options.webAuthnCeremonies &&
      this.options.webAuthnRepository,
    );
  }

  private webAuthnCredentialStateDigest(passwordHash: string): string {
    return createHmac('sha256', this.#authenticationPepper)
      .update('omnireach-webauthn-enrollment-credential-state-v1\0', 'utf8')
      .update(passwordHash, 'utf8')
      .digest('hex');
  }

  private webAuthnBaseChallengeDigest(challengeId: string, authStateDigest: string): string {
    return createHmac('sha256', this.#authenticationPepper)
      .update('omnireach-webauthn-login-binding-v1\0', 'utf8')
      .update(challengeId, 'utf8')
      .update('\0', 'utf8')
      .update(authStateDigest, 'utf8')
      .digest('hex');
  }

  private async allowAttempt(
    scope: AuthenticationRateLimitScope,
    accountIdentifier: string,
    networkIdentifier: string | undefined,
    accountLimit: number,
    networkLimit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const limiter = this.options.attemptLimiter;
    if (!limiter) return true;
    if (!networkIdentifier) return false;
    return limiter.consume({
      accountIdentifier,
      accountLimit,
      networkIdentifier,
      networkLimit,
      scope,
      windowSeconds,
    });
  }

  private recoverySessionTokenDigest(token: string): string {
    return createHmac('sha256', this.#authenticationPepper)
      .update('omnireach-recovery-session-v1\0', 'utf8')
      .update(token, 'utf8')
      .digest('hex');
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

function challengeFor(
  target: LoginTarget,
  traceId: string,
  methods: VerificationMethod[],
  authStateDigest: string,
): MfaChallenge {
  return {
    authStateDigest,
    host: target.host,
    methods,
    normalizedEmail: target.normalizedEmail,
    purpose: 'login',
    recoveryCodeAllowed: Boolean(
      target.hasRecoveryCodes && target.privilegedRecoveryRequired === false,
    ),
    ...(target.siteId ? { siteId: target.siteId } : {}),
    ...(target.tenantId ? { tenantId: target.tenantId } : {}),
    traceId,
    userId: target.userId,
  };
}

function safeDigestEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/u.test(left) || !/^[a-f0-9]{64}$/u.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function bootstrapUserId(tokenHash: string): string {
  return `owner-bootstrap:${tokenHash}`;
}

function formatRecoveryCode(compactCode: string): string {
  return compactCode.match(/.{1,4}/gu)?.join('-') ?? compactCode;
}

function rateLimitHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/u, '');
}

function normalizeWebAuthnTransports(value: string[] | undefined): string[] | undefined {
  const allowed = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);
  const transports = [...new Set(value ?? [])];
  return transports.length <= 8 && transports.every((entry) => allowed.has(entry))
    ? transports
    : undefined;
}
