import { PassThrough } from 'node:stream';

import { createLogger, createTraceId } from '@omnireach/observability';
import { ConfigurationError, parseConfig, redactConfig } from '@omnireach/shared';
import { describe, expect, it } from 'vitest';

const validConfig = {
  CONTACT_ENCRYPTION_KEY: 'a'.repeat(64),
  DATABASE_URL: 'postgresql://local_user:local_password@127.0.0.1:55432/local_db',
  MFA_ENCRYPTION_KEY: 'fictional-local-mfa-encryption-key-value',
  PREVIEW_SIGNING_KEY: 'fictional-local-preview-signing-key-value',
  REDIS_URL: 'redis://127.0.0.1:56379',
  SESSION_SECRET: 'fictional-local-session-secret-value',
  SOURCE_COMMIT_SHA: 'a'.repeat(40),
};

describe('configuration and logging safety', () => {
  it('fails closed and names invalid fields without reflecting their values', () => {
    expect(() =>
      parseConfig({ ...validConfig, DATABASE_URL: 'not-a-url', SESSION_SECRET: 'short' }),
    ).toThrow(new ConfigurationError('Invalid configuration fields: DATABASE_URL, SESSION_SECRET'));
  });

  it('redacts credentials from structured configuration', () => {
    const redacted = redactConfig(parseConfig(validConfig));
    expect(redacted.SESSION_SECRET).toBe('[REDACTED]');
    expect(redacted.MFA_ENCRYPTION_KEY).toBe('[REDACTED]');
    expect(redacted.PREVIEW_SIGNING_KEY).toBe('[REDACTED]');
    expect(redacted.CONTACT_ENCRYPTION_KEY).toBe('[REDACTED]');
    expect(redacted.DATABASE_URL).not.toContain('local_user');
    expect(redacted.DATABASE_URL).not.toContain('local_password');
  });

  it('accepts and redacts a versioned MFA keyring while rejecting unsafe rings', () => {
    const first = 'fictional-version-one-encryption-key-material';
    const second = 'fictional-version-two-encryption-key-material';
    const keyringConfig = {
      ...validConfig,
      MFA_ENCRYPTION_KEY: undefined,
      MFA_ENCRYPTION_KEYRING_JSON: JSON.stringify({
        activeVersion: 2,
        keys: { 1: first, 2: second },
      }),
    };
    const parsed = parseConfig(keyringConfig);
    expect(parsed.MFA_ENCRYPTION_KEY).toBeUndefined();
    expect(redactConfig(parsed).MFA_ENCRYPTION_KEYRING_JSON).toBe('[REDACTED]');
    expect(JSON.stringify(redactConfig(parsed))).not.toContain(first);
    expect(() =>
      parseConfig({
        ...keyringConfig,
        MFA_ENCRYPTION_KEYRING_JSON: JSON.stringify({ activeVersion: 3, keys: { 2: second } }),
      }),
    ).toThrow('MFA_ENCRYPTION_KEYRING_JSON');
    expect(() =>
      parseConfig({
        ...keyringConfig,
        MFA_ENCRYPTION_KEYRING_JSON: JSON.stringify({
          activeVersion: 2,
          keys: { 1: first, 2: first },
        }),
      }),
    ).toThrow('MFA_ENCRYPTION_KEYRING_JSON');
    expect(() =>
      parseConfig({
        ...keyringConfig,
        MFA_ENCRYPTION_KEYRING_JSON: JSON.stringify({
          activeVersion: 2_147_483_648,
          keys: { 2_147_483_648: second },
        }),
      }),
    ).toThrow('MFA_ENCRYPTION_KEYRING_JSON');
    expect(() =>
      parseConfig({
        ...keyringConfig,
        MFA_ENCRYPTION_KEYRING_JSON: JSON.stringify({
          activeVersion: 2,
          keys: { 1: first, 2: validConfig.SESSION_SECRET },
        }),
      }),
    ).toThrow('MFA_ENCRYPTION_KEYRING_JSON');
    expect(() =>
      parseConfig({
        ...validConfig,
        MFA_ENCRYPTION_KEY: validConfig.SESSION_SECRET,
      }),
    ).toThrow('MFA_ENCRYPTION_KEY');
  });

  it('keeps contact delivery disabled by default and requires complete provider keys', () => {
    const defaults = parseConfig(validConfig);
    expect(defaults.CONTACT_DELIVERY_ENABLED).toBe(false);
    expect(defaults.PLATFORM_INQUIRY_ENABLED).toBe(false);
    expect(defaults.AUTH_EMAIL_DELIVERY_ENABLED).toBe(false);
    expect(defaults.ALERT_EMAIL_DELIVERY_ENABLED).toBe(false);
    expect(defaults.OPENAI_PROVIDER_ENABLED).toBe(false);
    expect(defaults.TRUSTED_PROXY_CIDRS).toEqual([]);
    expect(() => parseConfig({ ...validConfig, CONTACT_DELIVERY_ENABLED: 'true' })).toThrow(
      'RESEND_API_KEY',
    );
    expect(() => parseConfig({ ...validConfig, PLATFORM_INQUIRY_ENABLED: 'true' })).toThrow(
      'RESEND_API_KEY',
    );
    expect(() =>
      parseConfig({
        ...validConfig,
        CONTACT_DELIVERY_ENABLED: 'true',
        RESEND_API_KEY: 'fictional-key',
      }),
    ).toThrow('TURNSTILE_SECRET_KEY');
    expect(() => parseConfig({ ...validConfig, TURNSTILE_SECRET_KEY: 'secret-only' })).toThrow(
      'TURNSTILE_SITE_KEY',
    );
    const config = parseConfig({
      ...validConfig,
      CONTACT_DELIVERY_ENABLED: 'true',
      RESEND_API_KEY: 'fictional-key',
      TURNSTILE_SECRET_KEY: 'fictional-secret',
      TURNSTILE_SITE_KEY: 'fictional-public-key',
    });
    expect(redactConfig(config).RESEND_API_KEY).toBe('[REDACTED]');
    expect(
      parseConfig({
        ...validConfig,
        PLATFORM_INQUIRY_ENABLED: 'true',
        RESEND_API_KEY: 'fictional-key',
        TURNSTILE_SECRET_KEY: 'fictional-secret',
        TURNSTILE_SITE_KEY: 'fictional-public-key',
      }).PLATFORM_INQUIRY_ENABLED,
    ).toBe(true);
    expect(() => parseConfig({ ...validConfig, AUTH_EMAIL_DELIVERY_ENABLED: 'true' })).toThrow(
      'RESEND_AUTH_FROM',
    );
    expect(
      parseConfig({
        ...validConfig,
        ALERT_EMAIL_DELIVERY_ENABLED: 'true',
        RESEND_API_KEY: 'fictional-key',
      }).ALERT_EMAIL_DELIVERY_ENABLED,
    ).toBe(true);
    expect(() =>
      parseConfig({
        ...validConfig,
        OPENAI_API_KEY: 'fictional-openai-key',
        OPENAI_MODEL_ALIASES_JSON: '{malformed',
      }),
    ).toThrow('OPENAI_MODEL_ALIASES_JSON');
    expect(() => parseConfig({ ...validConfig, OPENAI_PROVIDER_ENABLED: 'true' })).toThrow(
      'OPENAI_API_KEY, OPENAI_MODEL_SELECTION',
    );
    expect(
      parseConfig({
        ...validConfig,
        OPENAI_API_KEY: 'fictional-openai-key',
        OPENAI_MODEL_ALIASES_JSON: '{"content-review-balanced":"fixture-model"}',
        OPENAI_MODEL_SELECTION: 'content-review-balanced',
        OPENAI_PROVIDER_ENABLED: 'true',
      }).OPENAI_PROVIDER_ENABLED,
    ).toBe(true);
    expect(
      parseConfig({
        ...validConfig,
        TRUSTED_PROXY_CIDRS: '172.20.0.2/32, 2400:cb00::/32',
      }).TRUSTED_PROXY_CIDRS,
    ).toEqual(['172.20.0.2/32', '2400:cb00::/32']);
    expect(() =>
      parseConfig({ ...validConfig, TRUSTED_PROXY_CIDRS: 'private_ranges, arbitrary-proxy' }),
    ).toThrow('TRUSTED_PROXY_CIDRS');
    expect(() => parseConfig({ ...validConfig, OMNIREACH_ENV: 'production' })).toThrow(
      'TRUSTED_PROXY_CIDRS',
    );
    expect(
      parseConfig({
        ...validConfig,
        OMNIREACH_ENV: 'production',
        TRUSTED_PROXY_CIDRS: '172.20.0.2/32',
      }).OMNIREACH_ENV,
    ).toBe('production');
  });

  it('accepts exact proxy IPs and narrowly scoped private or public CIDRs', () => {
    const trustedProxyCidrs = [
      '172.20.0.2',
      '2001:db8::1',
      '172.20.0.0/24',
      'fd12:3456:789a:1::/64',
      '8.0.0.0/12',
      '104.16.0.0/13',
      '2400:cb00::/32',
    ];

    expect(
      parseConfig({ ...validConfig, TRUSTED_PROXY_CIDRS: trustedProxyCidrs.join(',') })
        .TRUSTED_PROXY_CIDRS,
    ).toEqual(trustedProxyCidrs);
  });

  it.each([
    '0.0.0.0/0',
    '::/0',
    '8.0.0.0/11',
    '2400::/31',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '172.20.0.0/23',
    'fd12:3456:789a:1::/63',
    '::ffff:0.0.0.0/96',
    '0:0:0:0:0:ffff:0:0/96',
    '::ffff:8.0.0.0/107',
  ])('rejects an overly broad trusted proxy CIDR: %s', (trustedProxyCidr) => {
    expect(() => parseConfig({ ...validConfig, TRUSTED_PROXY_CIDRS: trustedProxyCidr })).toThrow(
      'TRUSTED_PROXY_CIDRS',
    );
  });

  it('redacts common secret fields and accepts only safe trace IDs', async () => {
    const output = new PassThrough();
    let line = '';
    output.on('data', (chunk: Buffer) => {
      line += chunk.toString('utf8');
    });
    createLogger('info', output).info(
      { authorization: 'Bearer fictional', password: 'fictional' },
      'test',
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(line).not.toContain('Bearer fictional');
    expect(line).not.toContain('"fictional"');
    expect(line).toContain('[REDACTED]');
    expect(createTraceId('safe-trace-id-0001')).toBe('safe-trace-id-0001');
    expect(createTraceId('bad')).not.toBe('bad');
  });
});
