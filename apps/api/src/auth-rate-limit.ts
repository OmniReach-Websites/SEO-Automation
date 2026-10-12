import { createHmac } from 'node:crypto';

import type { AuthenticationRateLimiter, AuthenticationRateLimitScope } from '@omnireach/auth';

export interface AuthenticationRateLimitRedisClient {
  eval(script: string, options: { arguments: string[]; keys: string[] }): Promise<unknown>;
}

export class RedisAuthenticationRateLimiter implements AuthenticationRateLimiter {
  constructor(
    private readonly redis: AuthenticationRateLimitRedisClient,
    private readonly keyMaterial: string,
    private readonly prefix = 'omnireach:auth-rate:v1:',
  ) {
    if (keyMaterial.length < 32) {
      throw new Error('Authentication rate-limit key material is too short');
    }
  }

  async consume(input: {
    accountIdentifier: string;
    accountLimit: number;
    networkIdentifier: string;
    networkLimit: number;
    scope: AuthenticationRateLimitScope;
    windowSeconds: number;
  }): Promise<boolean> {
    assertPositiveInteger(input.accountLimit, 'account limit');
    assertPositiveInteger(input.networkLimit, 'network limit');
    assertPositiveInteger(input.windowSeconds, 'rate-limit window');
    if (!input.accountIdentifier || !input.networkIdentifier) return false;
    const result = Number(
      await this.redis.eval(CONSUME_AUTH_RATE_LIMIT_SCRIPT, {
        arguments: [
          String(input.accountLimit),
          String(input.networkLimit),
          String(input.windowSeconds * 1000),
        ],
        keys: [
          `${this.prefix}account:${this.digest(input.scope, 'account', input.accountIdentifier)}`,
          `${this.prefix}network:${this.digest(input.scope, 'network', input.networkIdentifier)}`,
        ],
      }),
    );
    return result === 1;
  }

  private digest(
    scope: AuthenticationRateLimitScope,
    kind: 'account' | 'network',
    identifier: string,
  ): string {
    return createHmac('sha256', this.keyMaterial)
      .update('omnireach-auth-rate-limit-v1\0', 'utf8')
      .update(scope, 'utf8')
      .update('\0', 'utf8')
      .update(kind, 'utf8')
      .update('\0', 'utf8')
      .update(identifier, 'utf8')
      .digest('hex');
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${label}`);
}

const CONSUME_AUTH_RATE_LIMIT_SCRIPT = `
local accountCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local networkCount = tonumber(redis.call('GET', KEYS[2]) or '0')
if accountCount >= tonumber(ARGV[1]) or networkCount >= tonumber(ARGV[2]) then
  return 0
end
accountCount = redis.call('INCR', KEYS[1])
if accountCount == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
networkCount = redis.call('INCR', KEYS[2])
if networkCount == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[3]) end
return 1
`;
