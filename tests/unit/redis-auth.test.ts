import { createHash } from 'node:crypto';

import {
  LocalRedisPasswordRecoveryNotifier,
  RedisMfaChallengeStore,
  RedisOwnerBootstrapPendingStore,
  type AuthRedisClient,
} from '@omnireach/api/redis-auth';
import type { MfaChallenge } from '@omnireach/auth';
import { describe, expect, it, vi } from 'vitest';

function redisClient(): AuthRedisClient & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    get: vi.fn(async (key) => values.get(key) ?? null),
    getDel: vi.fn(async (key) => {
      const value = values.get(key) ?? null;
      values.delete(key);
      return value;
    }),
    set: vi.fn(async (key, value, options) => {
      if (options.NX && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    }),
    values,
  };
}

describe('Redis authentication boundaries', () => {
  it('stores challenge data under a digest and consumes it once', async () => {
    const redis = redisClient();
    const store = new RedisMfaChallengeStore(redis);
    const challenge: MfaChallenge = {
      authStateDigest: 'c'.repeat(64),
      host: 'admin.omnireach.test',
      methods: ['totp'],
      normalizedEmail: 'staff@example.test',
      purpose: 'login' as const,
      traceId: 'trace-mfa',
      userId: 'staff-a',
    };
    const id = await store.create(challenge, 300);
    expect([...redis.values.keys()][0]).toMatch(/^omnireach:auth:mfa:v2:/u);
    expect([...redis.values.keys()][0]).not.toContain(id);
    await expect(store.read(id)).resolves.toEqual(challenge);
    await expect(store.consume(id)).resolves.toEqual(challenge);
    await expect(store.consume(id)).resolves.toBeUndefined();
  });

  it('stores local recovery tokens behind a hashed email key without logging them', async () => {
    const redis = redisClient();
    const notifier = new LocalRedisPasswordRecoveryNotifier(redis, 'test');
    await notifier.send({
      host: 'admin.customer.test',
      normalizedEmail: 'person@example.test',
      token: 'fictional-token',
    });
    const digest = createHash('sha256').update('person@example.test').digest('hex');
    expect(redis.values.get(`omnireach:local:recovery:${digest}`)).toBe('fictional-token');
    expect(JSON.stringify([...redis.values.keys()])).not.toContain('person@example.test');
  });

  it('stores pending owner bootstrap secrets under a one-time opaque identifier', async () => {
    const redis = redisClient();
    const store = new RedisOwnerBootstrapPendingStore(redis);
    const value = {
      encryptedMfaSecret: new Uint8Array(40).fill(7),
      method: 'totp' as const,
      normalizedEmail: 'owner@example.test',
      recoveryCodeHashes: ['a'.repeat(64)],
      tokenHash: 'b'.repeat(64),
    };
    const setupId = await store.create(value, 600);
    expect(JSON.stringify([...redis.values.keys()])).not.toContain(setupId);
    await expect(store.read(setupId)).resolves.toEqual(value);
    await expect(store.consume(setupId)).resolves.toEqual(value);
    await expect(store.read(setupId)).resolves.toBeUndefined();
  });
});
