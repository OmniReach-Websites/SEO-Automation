import { createHash } from 'node:crypto';

import {
  LocalRedisPasswordRecoveryNotifier,
  RedisMfaChallengeStore,
  RedisOwnerBootstrapPendingStore,
  RedisWebAuthnCeremonyStore,
  type AuthRedisClient,
} from '@omnireach/api/redis-auth';
import type { MfaChallenge, WebAuthnCeremony } from '@omnireach/auth';
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
    expect([...redis.values.keys()][0]).toMatch(/^omnireach:auth:mfa:v3:/u);
    expect([...redis.values.keys()][0]).not.toContain(id);
    await expect(store.read(id)).resolves.toEqual(challenge);
    await expect(store.consume(id)).resolves.toEqual(challenge);
    await expect(store.consume(id)).resolves.toBeUndefined();
  });

  it('stores exact-host WebAuthn ceremony state under a digest and consumes it once', async () => {
    const redis = redisClient();
    const store = new RedisWebAuthnCeremonyStore(redis);
    const ceremony = {
      authStateVersion: '7',
      baseChallengeDigest: 'a'.repeat(64),
      challenge: 'base64url_challenge_value',
      host: 'admin.omnireach.cloud',
      origin: 'https://admin.omnireach.cloud',
      purpose: 'authentication' as const,
      rpId: 'admin.omnireach.cloud',
      scopeId: '10000000-0000-4000-8000-000000000001',
      traceId: 'trace-webauthn',
      userHandle: Buffer.alloc(64, 7).toString('base64url'),
      userId: '20000000-0000-4000-8000-000000000001',
    };
    const id = await store.create(ceremony);
    const key = [...redis.values.keys()][0];
    expect(key).toMatch(/^omnireach:auth:webauthn:v3:[a-f0-9]{64}$/u);
    expect(key).not.toContain(id);
    await expect(store.consume(id)).resolves.toEqual(ceremony);
    await expect(store.consume(id)).resolves.toBeUndefined();
  });

  it('rejects widened origins, overlong lifetimes, and malformed ceremony bindings', async () => {
    const redis = redisClient();
    const store = new RedisWebAuthnCeremonyStore(redis);
    const ceremony = {
      authStateVersion: '1',
      challenge: 'base64url_challenge_value',
      host: 'admin.customer.example',
      origin: 'https://customer.example',
      purpose: 'registration' as const,
      rpId: 'admin.customer.example',
      scopeId: '10000000-0000-4000-8000-000000000001',
      siteId: '30000000-0000-4000-8000-000000000001',
      tenantId: '40000000-0000-4000-8000-000000000001',
      traceId: 'trace-webauthn',
      userHandle: Buffer.alloc(64, 8).toString('base64url'),
      userId: '20000000-0000-4000-8000-000000000001',
    };
    await expect(store.create(ceremony as unknown as WebAuthnCeremony)).rejects.toThrow(
      'Invalid WebAuthn ceremony',
    );
    await expect(
      store.create(
        { ...ceremony, origin: 'https://admin.customer.example' } as unknown as WebAuthnCeremony,
        301,
      ),
    ).rejects.toThrow('lifetime');
  });

  it('requires exactly one purpose-specific WebAuthn authorization binding', async () => {
    const redis = redisClient();
    const store = new RedisWebAuthnCeremonyStore(redis);
    const common = {
      authStateVersion: '3',
      challenge: 'base64url_challenge_value',
      host: 'admin.omnireach.cloud',
      origin: 'https://admin.omnireach.cloud',
      rpId: 'admin.omnireach.cloud',
      scopeId: '10000000-0000-4000-8000-000000000001',
      traceId: 'trace-binding',
      userHandle: Buffer.alloc(64, 9).toString('base64url'),
      userId: '20000000-0000-4000-8000-000000000001',
    };
    const registration: WebAuthnCeremony = {
      ...common,
      credentialName: 'Windows Hello',
      credentialStateDigest: 'e'.repeat(64),
      purpose: 'registration',
      recoveryCodeHashes: Array.from({ length: 10 }, (_, index) =>
        index.toString(16).padStart(64, '0'),
      ),
      sessionTokenHash: 'b'.repeat(64),
    };
    const ownerBootstrap: WebAuthnCeremony = {
      ...common,
      bootstrapBindingDigest: 'c'.repeat(64),
      purpose: 'owner_bootstrap',
    };
    await expect(store.create(registration)).resolves.toBeTypeOf('string');
    const serialized = [...redis.values.values()].find((value) => value.includes('Windows Hello'));
    expect(serialized).toContain(registration.recoveryCodeHashes[0]);
    expect(serialized).not.toContain('AAAA-BBBB-CCCC-DDDD');
    await expect(store.create(ownerBootstrap)).resolves.toBeTypeOf('string');
    await expect(
      store.create({
        ...registration,
        baseChallengeDigest: 'd'.repeat(64),
      } as WebAuthnCeremony),
    ).rejects.toThrow('Invalid WebAuthn ceremony');
    const missingSession = { ...registration } as Record<string, unknown>;
    delete missingSession.sessionTokenHash;
    await expect(store.create(missingSession as unknown as WebAuthnCeremony)).rejects.toThrow(
      'Invalid WebAuthn ceremony',
    );
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
      keyVersion: 2,
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
