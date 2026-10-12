import {
  createOneTimeToken,
  digestToken,
  type EmailCodeChallengeStore,
  type EmailCodeResendResult,
  type EmailCodeVerificationResult,
  type MfaChallenge,
  type MfaChallengeStore,
  type OwnerBootstrapPendingStore,
  type PendingOwnerBootstrap,
  type PasswordRecoveryNotifier,
  type VerificationCodeNotifier,
  type VerificationMethod,
} from '@omnireach/auth';

export interface AuthRedisClient {
  get(key: string): Promise<string | null>;
  getDel(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options: { EX: number; NX?: true; XX?: true },
  ): Promise<null | string>;
}

export interface EmailCodeRedisClient extends AuthRedisClient {
  del(key: string): Promise<number>;
  eval(script: string, options: { arguments: string[]; keys: string[] }): Promise<unknown>;
}

interface StoredEmailCode {
  attempts: number;
  codeDigest: string;
  expiresAtMs: number;
  host: string;
  resendAfterMs: number;
  sends: number;
  userId: string;
}

export class RedisOwnerBootstrapPendingStore implements OwnerBootstrapPendingStore {
  constructor(
    private readonly redis: AuthRedisClient,
    private readonly prefix = 'omnireach:auth:owner-bootstrap:',
  ) {}

  async create(value: PendingOwnerBootstrap, ttlSeconds: number): Promise<string> {
    const serialized = JSON.stringify({
      ...(value.encryptedMfaSecret
        ? { encryptedMfaSecret: Buffer.from(value.encryptedMfaSecret).toString('base64') }
        : {}),
      method: value.method,
      normalizedEmail: value.normalizedEmail,
      recoveryCodeHashes: value.recoveryCodeHashes,
      tokenHash: value.tokenHash,
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = createOneTimeToken().token;
      const stored = await this.redis.set(this.key(id), serialized, { EX: ttlSeconds, NX: true });
      if (stored === 'OK') return id;
    }
    throw new Error('Unable to allocate owner bootstrap state');
  }

  async read(setupId: string): Promise<PendingOwnerBootstrap | undefined> {
    return parseOwnerBootstrap(await this.redis.get(this.key(setupId)));
  }

  async consume(setupId: string): Promise<PendingOwnerBootstrap | undefined> {
    return parseOwnerBootstrap(await this.redis.getDel(this.key(setupId)));
  }

  private key(setupId: string): string {
    return `${this.prefix}${digestToken(setupId)}`;
  }
}

export class RedisMfaChallengeStore implements MfaChallengeStore {
  constructor(
    private readonly redis: AuthRedisClient,
    // Version the namespace so a code rollback cannot consume challenges created
    // under the newer account-policy/auth-state contract.
    private readonly prefix = 'omnireach:auth:mfa:v2:',
  ) {}

  async create(challenge: MfaChallenge, ttlSeconds: number): Promise<string> {
    const value = JSON.stringify(challenge);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = createOneTimeToken().token;
      const stored = await this.redis.set(this.key(id), value, { EX: ttlSeconds, NX: true });
      if (stored === 'OK') return id;
    }
    throw new Error('Unable to allocate MFA challenge');
  }

  async read(challengeId: string): Promise<MfaChallenge | undefined> {
    return parseChallenge(await this.redis.get(this.key(challengeId)));
  }

  async consume(challengeId: string): Promise<MfaChallenge | undefined> {
    return parseChallenge(await this.redis.getDel(this.key(challengeId)));
  }

  async refresh(
    challengeId: string,
    challenge: MfaChallenge,
    ttlSeconds: number,
  ): Promise<boolean> {
    const stored = await this.redis.set(this.key(challengeId), JSON.stringify(challenge), {
      EX: ttlSeconds,
      XX: true,
    });
    return stored === 'OK';
  }

  private key(challengeId: string): string {
    return `${this.prefix}${digestToken(challengeId)}`;
  }
}

export class RedisEmailCodeChallengeStore implements EmailCodeChallengeStore {
  constructor(
    private readonly redis: EmailCodeRedisClient,
    private readonly prefix = 'omnireach:auth:email-code:',
  ) {}

  async create(input: {
    challengeId: string;
    codeDigest: string;
    host: string;
    now: Date;
    ttlSeconds: number;
    userId: string;
  }): Promise<void> {
    assertDigest(input.codeDigest);
    const state: StoredEmailCode = {
      attempts: 0,
      codeDigest: input.codeDigest,
      expiresAtMs: input.now.getTime() + input.ttlSeconds * 1000,
      host: input.host,
      resendAfterMs: input.now.getTime() + 60_000,
      sends: 1,
      userId: input.userId,
    };
    const stored = await this.redis.set(this.key(input.challengeId), JSON.stringify(state), {
      EX: input.ttlSeconds,
      NX: true,
    });
    if (stored !== 'OK') throw new Error('Unable to allocate email verification state');
  }

  async remove(challengeId: string): Promise<void> {
    await this.redis.del(this.key(challengeId));
  }

  async replace(input: {
    challengeId: string;
    codeDigest: string;
    cooldownSeconds: number;
    host: string;
    maxSends: number;
    now: Date;
    ttlSeconds: number;
    userId: string;
  }): Promise<EmailCodeResendResult> {
    assertDigest(input.codeDigest);
    const result = Number(
      await this.redis.eval(REPLACE_EMAIL_CODE_SCRIPT, {
        arguments: [
          input.host,
          input.userId,
          String(input.now.getTime()),
          String(input.maxSends),
          input.codeDigest,
          String(input.cooldownSeconds * 1000),
          String(input.ttlSeconds * 1000),
        ],
        keys: [this.key(input.challengeId)],
      }),
    );
    return result === 1
      ? 'updated'
      : result === -1
        ? 'cooldown'
        : result === -2
          ? 'exhausted'
          : 'missing';
  }

  async verify(input: {
    challengeId: string;
    codeDigest: string;
    host: string;
    maxAttempts: number;
    now: Date;
    userId: string;
  }): Promise<EmailCodeVerificationResult> {
    assertDigest(input.codeDigest);
    const result = Number(
      await this.redis.eval(VERIFY_EMAIL_CODE_SCRIPT, {
        arguments: [
          input.host,
          input.userId,
          String(input.now.getTime()),
          String(input.maxAttempts),
          input.codeDigest,
        ],
        keys: [this.key(input.challengeId)],
      }),
    );
    return result === 1
      ? 'verified'
      : result === -1
        ? 'exhausted'
        : result === 0
          ? 'invalid'
          : 'missing';
  }

  private key(challengeId: string): string {
    return `${this.prefix}${digestToken(challengeId)}`;
  }
}

export class DisabledVerificationCodeNotifier implements VerificationCodeNotifier {
  async send(): Promise<void> {
    throw new Error('Email verification delivery is disabled');
  }
}

export class LocalRedisPasswordRecoveryNotifier implements PasswordRecoveryNotifier {
  constructor(
    private readonly redis: AuthRedisClient,
    private readonly environment: 'ci' | 'local' | 'production' | 'test',
  ) {}

  async send(input: { host: string; normalizedEmail: string; token: string }): Promise<void> {
    void input.host;
    if (!['ci', 'local', 'test'].includes(this.environment)) {
      throw new Error('Local recovery delivery is disabled');
    }
    await this.redis.set(
      `omnireach:local:recovery:${digestToken(input.normalizedEmail)}`,
      input.token,
      { EX: 30 * 60 },
    );
  }
}

export class LocalRedisInvitationNotifier {
  constructor(
    private readonly redis: AuthRedisClient,
    private readonly environment: 'ci' | 'local' | 'production' | 'test',
  ) {}

  async send(input: { host: string; normalizedEmail: string; token: string }): Promise<void> {
    void input.host;
    if (!['ci', 'local', 'test'].includes(this.environment)) {
      throw new Error('Local invitation delivery is disabled');
    }
    await this.redis.set(
      `omnireach:local:invitation:${digestToken(input.normalizedEmail)}`,
      input.token,
      { EX: 7 * 24 * 60 * 60 },
    );
  }
}

function parseChallenge(value: string | null): MfaChallenge | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.host !== 'string' ||
      (parsed.authStateDigest !== undefined &&
        (typeof parsed.authStateDigest !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(parsed.authStateDigest))) ||
      !Array.isArray(parsed.methods) ||
      !parsed.methods.every(isVerificationMethod) ||
      typeof parsed.normalizedEmail !== 'string' ||
      typeof parsed.traceId !== 'string' ||
      typeof parsed.userId !== 'string' ||
      (parsed.policyChange !== undefined &&
        parsed.policyChange !== 'enable_email_code' &&
        parsed.policyChange !== 'disable_email_code') ||
      (parsed.purpose !== undefined &&
        parsed.purpose !== 'login' &&
        parsed.purpose !== 'email_policy_change') ||
      (parsed.recoveryCodeAllowed !== undefined &&
        typeof parsed.recoveryCodeAllowed !== 'boolean') ||
      (parsed.sessionTokenHash !== undefined &&
        (typeof parsed.sessionTokenHash !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(parsed.sessionTokenHash))) ||
      (parsed.siteId !== undefined && typeof parsed.siteId !== 'string') ||
      (parsed.tenantId !== undefined && typeof parsed.tenantId !== 'string') ||
      Boolean(parsed.siteId) !== Boolean(parsed.tenantId) ||
      (parsed.purpose === 'email_policy_change' &&
        (typeof parsed.sessionTokenHash !== 'string' ||
          (parsed.policyChange !== 'enable_email_code' &&
            parsed.policyChange !== 'disable_email_code')))
    ) {
      return undefined;
    }
    return {
      ...(typeof parsed.authStateDigest === 'string'
        ? { authStateDigest: parsed.authStateDigest }
        : {}),
      host: parsed.host,
      methods: parsed.methods as VerificationMethod[],
      normalizedEmail: parsed.normalizedEmail,
      ...(parsed.policyChange === 'enable_email_code' ||
      parsed.policyChange === 'disable_email_code'
        ? { policyChange: parsed.policyChange }
        : {}),
      ...(parsed.purpose === 'login' || parsed.purpose === 'email_policy_change'
        ? { purpose: parsed.purpose }
        : {}),
      ...(typeof parsed.recoveryCodeAllowed === 'boolean'
        ? { recoveryCodeAllowed: parsed.recoveryCodeAllowed }
        : {}),
      ...(typeof parsed.sessionTokenHash === 'string'
        ? { sessionTokenHash: parsed.sessionTokenHash }
        : {}),
      ...(typeof parsed.siteId === 'string' ? { siteId: parsed.siteId } : {}),
      ...(typeof parsed.tenantId === 'string' ? { tenantId: parsed.tenantId } : {}),
      traceId: parsed.traceId,
      userId: parsed.userId,
    };
  } catch {
    return undefined;
  }
}

function parseOwnerBootstrap(value: string | null): PendingOwnerBootstrap | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      !['email_code', 'totp'].includes(String(parsed.method)) ||
      (parsed.method === 'totp' && typeof parsed.encryptedMfaSecret !== 'string') ||
      (parsed.encryptedMfaSecret !== undefined && typeof parsed.encryptedMfaSecret !== 'string') ||
      typeof parsed.normalizedEmail !== 'string' ||
      !Array.isArray(parsed.recoveryCodeHashes) ||
      !parsed.recoveryCodeHashes.every(
        (entry) => typeof entry === 'string' && /^[a-f0-9]{64}$/u.test(entry),
      ) ||
      typeof parsed.tokenHash !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(parsed.tokenHash)
    ) {
      return undefined;
    }
    const encryptedMfaSecret =
      typeof parsed.encryptedMfaSecret === 'string'
        ? new Uint8Array(Buffer.from(parsed.encryptedMfaSecret, 'base64'))
        : undefined;
    if (encryptedMfaSecret && encryptedMfaSecret.length < 30) return undefined;
    return {
      ...(encryptedMfaSecret ? { encryptedMfaSecret } : {}),
      method: parsed.method as 'email_code' | 'totp',
      normalizedEmail: parsed.normalizedEmail,
      recoveryCodeHashes: parsed.recoveryCodeHashes as string[],
      tokenHash: parsed.tokenHash,
    };
  } catch {
    return undefined;
  }
}

function assertDigest(value: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error('Email verification digest is invalid');
}

function isVerificationMethod(value: unknown): value is VerificationMethod {
  return value === 'email_code' || value === 'totp' || value === 'webauthn';
}

const REPLACE_EMAIL_CODE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -3 end
local state = cjson.decode(raw)
local now = tonumber(ARGV[3])
if state.host ~= ARGV[1] or state.userId ~= ARGV[2] or state.expiresAtMs <= now then
  redis.call('DEL', KEYS[1])
  return -3
end
if state.sends >= tonumber(ARGV[4]) or state.attempts >= 5 then
  redis.call('DEL', KEYS[1])
  return -2
end
if state.resendAfterMs > now then return -1 end
state.codeDigest = ARGV[5]
state.sends = state.sends + 1
state.resendAfterMs = now + tonumber(ARGV[6])
state.expiresAtMs = now + tonumber(ARGV[7])
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[7])
return 1
`;

const VERIFY_EMAIL_CODE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -2 end
local state = cjson.decode(raw)
local now = tonumber(ARGV[3])
if state.host ~= ARGV[1] or state.userId ~= ARGV[2] or state.expiresAtMs <= now then
  redis.call('DEL', KEYS[1])
  return -2
end
state.attempts = state.attempts + 1
if state.attempts > tonumber(ARGV[4]) then
  redis.call('DEL', KEYS[1])
  return -1
end
if state.codeDigest == ARGV[5] then
  redis.call('DEL', KEYS[1])
  return 1
end
if state.attempts >= tonumber(ARGV[4]) then
  redis.call('DEL', KEYS[1])
  return -1
end
redis.call('SET', KEYS[1], cjson.encode(state), 'KEEPTTL')
return 0
`;
