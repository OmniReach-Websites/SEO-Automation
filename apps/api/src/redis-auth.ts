import {
  createOneTimeToken,
  digestToken,
  type MfaChallenge,
  type MfaChallengeStore,
  type OwnerBootstrapPendingStore,
  type PendingOwnerBootstrap,
  type PasswordRecoveryNotifier,
} from '@omnireach/auth';

export interface AuthRedisClient {
  get(key: string): Promise<string | null>;
  getDel(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number; NX?: true }): Promise<null | string>;
}

export class RedisOwnerBootstrapPendingStore implements OwnerBootstrapPendingStore {
  constructor(
    private readonly redis: AuthRedisClient,
    private readonly prefix = 'omnireach:auth:owner-bootstrap:',
  ) {}

  async create(value: PendingOwnerBootstrap, ttlSeconds: number): Promise<string> {
    const serialized = JSON.stringify({
      encryptedMfaSecret: Buffer.from(value.encryptedMfaSecret).toString('base64'),
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
    private readonly prefix = 'omnireach:auth:mfa:',
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

  private key(challengeId: string): string {
    return `${this.prefix}${digestToken(challengeId)}`;
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
      typeof parsed.traceId !== 'string' ||
      typeof parsed.userId !== 'string' ||
      (parsed.siteId !== undefined && typeof parsed.siteId !== 'string') ||
      (parsed.tenantId !== undefined && typeof parsed.tenantId !== 'string') ||
      Boolean(parsed.siteId) !== Boolean(parsed.tenantId)
    ) {
      return undefined;
    }
    return {
      host: parsed.host,
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
      typeof parsed.encryptedMfaSecret !== 'string' ||
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
    const encryptedMfaSecret = new Uint8Array(Buffer.from(parsed.encryptedMfaSecret, 'base64'));
    if (encryptedMfaSecret.length < 30) return undefined;
    return {
      encryptedMfaSecret,
      normalizedEmail: parsed.normalizedEmail,
      recoveryCodeHashes: parsed.recoveryCodeHashes as string[],
      tokenHash: parsed.tokenHash,
    };
  } catch {
    return undefined;
  }
}
