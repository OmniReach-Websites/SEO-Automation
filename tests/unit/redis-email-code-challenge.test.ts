import { createHash } from 'node:crypto';

import { RedisEmailCodeChallengeStore, type EmailCodeRedisClient } from '@omnireach/api/redis-auth';
import { describe, expect, it } from 'vitest';

interface MemoryEntry {
  expiresAtMs: number;
  value: string;
}

interface StoredEmailCodeState {
  attempts: number;
  codeDigest: string;
  expiresAtMs: number;
  host: string;
  resendAfterMs: number;
  sends: number;
  userId: string;
}

class InMemoryEmailRedis implements EmailCodeRedisClient {
  private readonly entries = new Map<string, MemoryEntry>();
  private nowMs: number;

  constructor(now: Date) {
    this.nowMs = now.getTime();
  }

  advance(milliseconds: number): void {
    this.nowMs += milliseconds;
  }

  date(): Date {
    return new Date(this.nowMs);
  }

  async del(key: string): Promise<number> {
    this.expire(key);
    return this.entries.delete(key) ? 1 : 0;
  }

  async eval(script: string, options: { arguments: string[]; keys: string[] }): Promise<unknown> {
    // The harness deliberately checks the atomic Redis primitives relied on by the
    // production state machine before faithfully interpreting either Lua script.
    expect(script).toContain("redis.call('GET', KEYS[1])");
    expect(script).toContain("redis.call('DEL', KEYS[1])");
    const key = options.keys[0];
    if (!key) throw new Error('Email-code script requires exactly one Redis key');
    this.expire(key);
    const entry = this.entries.get(key);
    if (!entry) return options.arguments.length === 7 ? -3 : -2;

    const state = JSON.parse(entry.value) as StoredEmailCodeState;
    if (options.arguments.length === 7) {
      expect(script).toContain("'PX', ARGV[7]");
      return this.replace(key, state, options.arguments);
    }
    if (options.arguments.length === 5) {
      expect(script).toContain("'KEEPTTL'");
      return this.verify(key, entry, state, options.arguments);
    }
    throw new Error('Unrecognized email-code Lua script');
  }

  async get(key: string): Promise<string | null> {
    this.expire(key);
    return this.entries.get(key)?.value ?? null;
  }

  async getDel(key: string): Promise<string | null> {
    const value = await this.get(key);
    this.entries.delete(key);
    return value;
  }

  async set(
    key: string,
    value: string,
    options: { EX: number; NX?: true },
  ): Promise<null | string> {
    this.expire(key);
    if (options.NX && this.entries.has(key)) return null;
    this.entries.set(key, {
      expiresAtMs: this.nowMs + options.EX * 1000,
      value,
    });
    return 'OK';
  }

  storedEntries(): [string, MemoryEntry][] {
    for (const key of this.entries.keys()) this.expire(key);
    return [...this.entries.entries()];
  }

  private expire(key: string): void {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAtMs <= this.nowMs) this.entries.delete(key);
  }

  private replace(key: string, state: StoredEmailCodeState, args: string[]): number {
    const [host, userId, nowRaw, maxSendsRaw, codeDigest, cooldownRaw, ttlRaw] = args;
    const now = Number(nowRaw);
    if (state.host !== host || state.userId !== userId || state.expiresAtMs <= now) {
      this.entries.delete(key);
      return -3;
    }
    if (state.sends >= Number(maxSendsRaw) || state.attempts >= 5) {
      this.entries.delete(key);
      return -2;
    }
    if (state.resendAfterMs > now) return -1;
    state.codeDigest = String(codeDigest);
    state.sends += 1;
    state.resendAfterMs = now + Number(cooldownRaw);
    state.expiresAtMs = now + Number(ttlRaw);
    this.entries.set(key, { expiresAtMs: state.expiresAtMs, value: JSON.stringify(state) });
    return 1;
  }

  private verify(
    key: string,
    entry: MemoryEntry,
    state: StoredEmailCodeState,
    args: string[],
  ): number {
    const [host, userId, nowRaw, maxAttemptsRaw, codeDigest] = args;
    const now = Number(nowRaw);
    const maxAttempts = Number(maxAttemptsRaw);
    if (state.host !== host || state.userId !== userId || state.expiresAtMs <= now) {
      this.entries.delete(key);
      return -2;
    }
    state.attempts += 1;
    if (state.attempts > maxAttempts) {
      this.entries.delete(key);
      return -1;
    }
    if (state.codeDigest === codeDigest) {
      this.entries.delete(key);
      return 1;
    }
    if (state.attempts >= maxAttempts) {
      this.entries.delete(key);
      return -1;
    }
    this.entries.set(key, { expiresAtMs: entry.expiresAtMs, value: JSON.stringify(state) });
    return 0;
  }
}

const HOST = 'admin.omnireach.test';
const USER_ID = 'staff-a';
const START = new Date('2026-10-11T12:00:00.000Z');

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function createChallenge(input?: {
  challengeId?: string;
  code?: string;
  redis?: InMemoryEmailRedis;
}): Promise<{
  challengeId: string;
  codeDigest: string;
  redis: InMemoryEmailRedis;
  store: RedisEmailCodeChallengeStore;
}> {
  const redis = input?.redis ?? new InMemoryEmailRedis(START);
  const store = new RedisEmailCodeChallengeStore(redis);
  const challengeId = input?.challengeId ?? 'opaque-challenge-id';
  const codeDigest = digest(input?.code ?? '12345678');
  await store.create({
    challengeId,
    codeDigest,
    host: HOST,
    now: redis.date(),
    ttlSeconds: 5 * 60,
    userId: USER_ID,
  });
  return { challengeId, codeDigest, redis, store };
}

describe('RedisEmailCodeChallengeStore', () => {
  it('keeps only a digest under an opaque key and expires the challenge after five minutes', async () => {
    const code = '12345678';
    const challengeId = 'visible-challenge-id';
    const { redis, store } = await createChallenge({ challengeId, code });
    const entries = redis.storedEntries();
    expect(entries).toHaveLength(1);
    const stored = entries[0];
    if (!stored) throw new Error('Expected the challenge to be stored');
    const [key, entry] = stored;

    expect(key).not.toContain(challengeId);
    expect(entry.value).not.toContain(code);
    expect(JSON.parse(entry.value)).toMatchObject({ codeDigest: digest(code) });

    redis.advance(5 * 60 * 1000 - 1);
    await expect(
      store.verify({
        challengeId,
        codeDigest: digest(code),
        host: HOST,
        maxAttempts: 5,
        now: redis.date(),
        userId: USER_ID,
      }),
    ).resolves.toBe('verified');

    const second = await createChallenge({ challengeId: 'expires', code, redis });
    redis.advance(5 * 60 * 1000);
    await expect(
      second.store.verify({
        challengeId: second.challengeId,
        codeDigest: second.codeDigest,
        host: HOST,
        maxAttempts: 5,
        now: redis.date(),
        userId: USER_ID,
      }),
    ).resolves.toBe('missing');
  });

  it('accepts a valid code only once, including under concurrent verification', async () => {
    const { challengeId, codeDigest, redis, store } = await createChallenge();
    const verification = () =>
      store.verify({
        challengeId,
        codeDigest,
        host: HOST,
        maxAttempts: 5,
        now: redis.date(),
        userId: USER_ID,
      });

    const results = await Promise.all([verification(), verification()]);
    expect(results.sort()).toEqual(['missing', 'verified']);
    await expect(verification()).resolves.toBe('missing');
  });

  it('allows exactly five failed attempts and then permanently exhausts the challenge', async () => {
    const { challengeId, redis, store } = await createChallenge();
    const wrongDigest = digest('87654321');
    const attempt = () =>
      store.verify({
        challengeId,
        codeDigest: wrongDigest,
        host: HOST,
        maxAttempts: 5,
        now: redis.date(),
        userId: USER_ID,
      });

    await expect(attempt()).resolves.toBe('invalid');
    await expect(attempt()).resolves.toBe('invalid');
    await expect(attempt()).resolves.toBe('invalid');
    await expect(attempt()).resolves.toBe('invalid');
    await expect(attempt()).resolves.toBe('exhausted');
    await expect(attempt()).resolves.toBe('missing');
  });

  it('enforces a 60-second resend cooldown and a maximum of three total sends', async () => {
    const { challengeId, redis, store } = await createChallenge();
    const resend = (code: string) =>
      store.replace({
        challengeId,
        codeDigest: digest(code),
        cooldownSeconds: 60,
        host: HOST,
        maxSends: 3,
        now: redis.date(),
        ttlSeconds: 300,
        userId: USER_ID,
      });

    redis.advance(59_999);
    await expect(resend('22222222')).resolves.toBe('cooldown');
    redis.advance(1);
    await expect(resend('22222222')).resolves.toBe('updated');
    redis.advance(60_000);
    await expect(resend('33333333')).resolves.toBe('updated');
    redis.advance(60_000);
    await expect(resend('44444444')).resolves.toBe('exhausted');
    await expect(resend('55555555')).resolves.toBe('missing');
  });

  it('gives each replacement code a fresh exact five-minute lifetime', async () => {
    const { challengeId, redis, store } = await createChallenge();
    const replacementDigest = digest('22222222');
    redis.advance(60_000);
    await expect(
      store.replace({
        challengeId,
        codeDigest: replacementDigest,
        cooldownSeconds: 60,
        host: HOST,
        maxSends: 3,
        now: redis.date(),
        ttlSeconds: 300,
        userId: USER_ID,
      }),
    ).resolves.toBe('updated');
    const stored = redis.storedEntries()[0];
    if (!stored) throw new Error('Expected replacement state');
    expect(JSON.parse(stored[1].value)).toMatchObject({
      expiresAtMs: redis.date().getTime() + 300_000,
    });

    redis.advance(300_000);
    await expect(
      store.verify({
        challengeId,
        codeDigest: replacementDigest,
        host: HOST,
        maxAttempts: 5,
        now: redis.date(),
        userId: USER_ID,
      }),
    ).resolves.toBe('missing');
  });

  it('invalidates the prior code as soon as a replacement code is stored', async () => {
    const { challengeId, codeDigest, redis, store } = await createChallenge();
    const replacementDigest = digest('22222222');
    redis.advance(60_000);
    await expect(
      store.replace({
        challengeId,
        codeDigest: replacementDigest,
        cooldownSeconds: 60,
        host: HOST,
        maxSends: 3,
        now: redis.date(),
        ttlSeconds: 300,
        userId: USER_ID,
      }),
    ).resolves.toBe('updated');

    await expect(
      store.verify({
        challengeId,
        codeDigest,
        host: HOST,
        maxAttempts: 5,
        now: redis.date(),
        userId: USER_ID,
      }),
    ).resolves.toBe('invalid');
    await expect(
      store.verify({
        challengeId,
        codeDigest: replacementDigest,
        host: HOST,
        maxAttempts: 5,
        now: redis.date(),
        userId: USER_ID,
      }),
    ).resolves.toBe('verified');
  });

  it.each([
    { host: 'admin.attacker.test', userId: USER_ID },
    { host: HOST, userId: 'different-user' },
  ])('rejects and deletes a challenge bound to another host or user', async (binding) => {
    const { challengeId, codeDigest, redis, store } = await createChallenge();
    await expect(
      store.verify({
        challengeId,
        codeDigest,
        host: binding.host,
        maxAttempts: 5,
        now: redis.date(),
        userId: binding.userId,
      }),
    ).resolves.toBe('missing');
    expect(redis.storedEntries()).toHaveLength(0);
    await expect(
      store.verify({
        challengeId,
        codeDigest,
        host: HOST,
        maxAttempts: 5,
        now: redis.date(),
        userId: USER_ID,
      }),
    ).resolves.toBe('missing');
  });
});
