import {
  RedisAuthenticationRateLimiter,
  type AuthenticationRateLimitRedisClient,
} from '@omnireach/api/auth-rate-limit';
import { describe, expect, it } from 'vitest';

interface Counter {
  count: number;
  expiresAtMs: number;
}

class AtomicCounterRedis implements AuthenticationRateLimitRedisClient {
  readonly keys = new Set<string>();
  private readonly counters = new Map<string, Counter>();
  private nowMs = Date.parse('2026-10-11T12:00:00.000Z');

  advance(milliseconds: number): void {
    this.nowMs += milliseconds;
  }

  async eval(script: string, options: { arguments: string[]; keys: string[] }): Promise<unknown> {
    expect(script).toContain("redis.call('GET', KEYS[1])");
    expect(script).toContain("redis.call('GET', KEYS[2])");
    expect(script).toContain("redis.call('INCR', KEYS[1])");
    expect(script).toContain("redis.call('INCR', KEYS[2])");
    expect(script).toContain("redis.call('PEXPIRE', KEYS[1], ARGV[3])");
    expect(options.keys).toHaveLength(2);
    const [accountKey, networkKey] = options.keys;
    if (!accountKey || !networkKey) throw new Error('Expected account and network keys');
    this.keys.add(accountKey);
    this.keys.add(networkKey);
    this.expire(accountKey);
    this.expire(networkKey);
    const account = this.counters.get(accountKey)?.count ?? 0;
    const network = this.counters.get(networkKey)?.count ?? 0;
    if (account >= Number(options.arguments[0]) || network >= Number(options.arguments[1])) {
      return 0;
    }
    const windowMs = Number(options.arguments[2]);
    this.increment(accountKey, windowMs);
    this.increment(networkKey, windowMs);
    return 1;
  }

  private expire(key: string): void {
    const counter = this.counters.get(key);
    if (counter && counter.expiresAtMs <= this.nowMs) this.counters.delete(key);
  }

  private increment(key: string, windowMs: number): void {
    const existing = this.counters.get(key);
    this.counters.set(key, {
      count: (existing?.count ?? 0) + 1,
      expiresAtMs: existing?.expiresAtMs ?? this.nowMs + windowMs,
    });
  }
}

const KEY_MATERIAL = 'fictional-rate-limit-key-material-0001';

function consume(
  limiter: RedisAuthenticationRateLimiter,
  overrides: Partial<Parameters<RedisAuthenticationRateLimiter['consume']>[0]> = {},
) {
  return limiter.consume({
    accountIdentifier: 'admin.example.test\0person@example.test',
    accountLimit: 3,
    networkIdentifier: '198.51.100.0/24',
    networkLimit: 4,
    scope: 'login_attempt',
    windowSeconds: 900,
    ...overrides,
  });
}

describe('RedisAuthenticationRateLimiter', () => {
  it('atomically enforces the account limit across different networks', async () => {
    const limiter = new RedisAuthenticationRateLimiter(new AtomicCounterRedis(), KEY_MATERIAL);
    await expect(consume(limiter, { accountLimit: 2 })).resolves.toBe(true);
    await expect(
      consume(limiter, { accountLimit: 2, networkIdentifier: '203.0.113.0/24' }),
    ).resolves.toBe(true);
    await expect(
      consume(limiter, { accountLimit: 2, networkIdentifier: '192.0.2.0/24' }),
    ).resolves.toBe(false);
  });

  it('atomically enforces the network limit across different accounts', async () => {
    const limiter = new RedisAuthenticationRateLimiter(new AtomicCounterRedis(), KEY_MATERIAL);
    await expect(consume(limiter, { networkLimit: 2 })).resolves.toBe(true);
    await expect(
      consume(limiter, { accountIdentifier: 'second-account', networkLimit: 2 }),
    ).resolves.toBe(true);
    await expect(
      consume(limiter, { accountIdentifier: 'third-account', networkLimit: 2 }),
    ).resolves.toBe(false);
  });

  it('allows no more concurrent attempts than the smallest applicable limit', async () => {
    const limiter = new RedisAuthenticationRateLimiter(new AtomicCounterRedis(), KEY_MATERIAL);
    const results = await Promise.all(Array.from({ length: 20 }, () => consume(limiter)));
    expect(results.filter(Boolean)).toHaveLength(3);
  });

  it('uses fixed-window expiry without storing account or network identifiers in keys', async () => {
    const redis = new AtomicCounterRedis();
    const limiter = new RedisAuthenticationRateLimiter(redis, KEY_MATERIAL);
    await expect(consume(limiter, { accountLimit: 1, windowSeconds: 60 })).resolves.toBe(true);
    await expect(consume(limiter, { accountLimit: 1, windowSeconds: 60 })).resolves.toBe(false);
    const serializedKeys = JSON.stringify([...redis.keys]);
    expect(serializedKeys).not.toContain('person@example.test');
    expect(serializedKeys).not.toContain('198.51.100');
    expect(serializedKeys).toMatch(/[a-f0-9]{64}/u);

    redis.advance(60_000);
    await expect(consume(limiter, { accountLimit: 1, windowSeconds: 60 })).resolves.toBe(true);
  });

  it('fails closed for missing identifiers and rejects invalid limits', async () => {
    const limiter = new RedisAuthenticationRateLimiter(new AtomicCounterRedis(), KEY_MATERIAL);
    await expect(consume(limiter, { networkIdentifier: '' })).resolves.toBe(false);
    await expect(consume(limiter, { accountLimit: 0 })).rejects.toThrow(/account limit/u);
    expect(() => new RedisAuthenticationRateLimiter(new AtomicCounterRedis(), 'short')).toThrow(
      /too short/u,
    );
  });
});
