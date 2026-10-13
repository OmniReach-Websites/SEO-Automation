import { isIP } from 'node:net';

import { z } from 'zod';

type IpFamily = 4 | 6;

interface NumericIpRange {
  end: bigint;
  start: bigint;
}

const addressBits = { 4: 32, 6: 128 } as const;
const minimumPublicPrefix = { 4: 12, 6: 32 } as const;
const minimumPrivateOrSpecialPrefix = { 4: 24, 6: 64 } as const;
const ipv4Mask = (1n << 32n) - 1n;
const maximumPostgresInteger = 2_147_483_647;

const privateOrSpecialRanges: Record<IpFamily, readonly NumericIpRange[]> = {
  4: [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ].map(([address, prefix]) => numericIpRange(address as string, prefix as number, 4)),
  6: [
    ['::', 128],
    ['::1', 128],
    ['64:ff9b::', 96],
    ['64:ff9b:1::', 48],
    ['100::', 64],
    ['2001::', 23],
    ['2002::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
  ].map(([address, prefix]) => numericIpRange(address as string, prefix as number, 6)),
};

const optionalNonempty = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const trustedProxyCidrs = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .refine((values) => values.every(validIpOrCidr), 'Trusted proxy entries must be IPs or CIDRs');

const configSchema = z
  .object({
    ALERT_EMAIL_DELIVERY_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    ALERT_EMAIL_RECIPIENT: optionalNonempty.pipe(z.string().email().optional()),
    ASSET_STORAGE_ROOT: z.string().trim().min(1).default('runtime-data/assets'),
    API_HOST: z.string().default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
    CONTACT_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/iu),
    CONTACT_DELIVERY_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    AUTH_EMAIL_DELIVERY_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    DATABASE_URL: z.string().url().startsWith('postgresql://'),
    GOOGLE_CLIENT_ID: optionalNonempty,
    GOOGLE_CLIENT_SECRET: optionalNonempty,
    GOOGLE_INTEGRATION_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    GOOGLE_TOKEN_ENCRYPTION_KEY: optionalNonempty.pipe(
      z
        .string()
        .regex(/^[a-f0-9]{64}$/iu)
        .optional(),
    ),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    MFA_ENCRYPTION_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(32).optional(),
    ),
    MFA_ENCRYPTION_KEYRING_JSON: optionalNonempty,
    OMNIREACH_ENV: z.enum(['local', 'test', 'ci', 'production']).default('local'),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_PROVIDER_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(20_000).default(800),
    OPENAI_MODEL_ALIASES_JSON: z.string().default('{}'),
    OPENAI_MODEL_SELECTION: z.string().default(''),
    OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    ORAP_HOSTNAME: z.string().trim().min(1).max(253).default('admin.omnireach.test'),
    PREVIEW_SIGNING_KEY: z.string().min(32),
    PREVIEW_STORAGE_ROOT: z.string().trim().min(1).default('runtime-data/previews'),
    REDIS_URL: z.string().url().startsWith('redis://'),
    REPOSITORY_ROOT: z.string().trim().min(1).default('.'),
    RESEND_API_KEY: optionalNonempty,
    RESEND_ALERT_FROM: z.string().email().default('alerts@updates.omnireach.cloud'),
    RESEND_AUTH_FROM: optionalNonempty.pipe(z.string().email().optional()),
    RESEND_CONTACT_FROM: z.string().email().default('forms@updates.omnireach.cloud'),
    SESSION_SECRET: z.string().min(32),
    SOURCE_COMMIT_SHA: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u),
    TURNSTILE_SECRET_KEY: optionalNonempty,
    TURNSTILE_SITE_KEY: optionalNonempty,
    TRUSTED_PROXY_CIDRS: trustedProxyCidrs,
  })
  .superRefine((config, context) => {
    if (!config.MFA_ENCRYPTION_KEY && !config.MFA_ENCRYPTION_KEYRING_JSON) {
      context.addIssue({
        code: 'custom',
        message: 'An MFA encryption key or versioned keyring is required',
        path: ['MFA_ENCRYPTION_KEYRING_JSON'],
      });
    }
    if (config.MFA_ENCRYPTION_KEYRING_JSON) {
      try {
        const keyMaterials = assertMfaKeyringJson(config.MFA_ENCRYPTION_KEYRING_JSON);
        if (keyMaterials.includes(config.SESSION_SECRET)) throw new Error('invalid');
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'MFA encryption keyring JSON is invalid',
          path: ['MFA_ENCRYPTION_KEYRING_JSON'],
        });
      }
    }
    if (config.MFA_ENCRYPTION_KEY === config.SESSION_SECRET) {
      context.addIssue({
        code: 'custom',
        message: 'Session and MFA encryption secrets must be independent',
        path: ['MFA_ENCRYPTION_KEY'],
      });
    }
    if (
      config.GOOGLE_INTEGRATION_ENABLED &&
      (!config.GOOGLE_CLIENT_ID ||
        !config.GOOGLE_CLIENT_SECRET ||
        !config.GOOGLE_TOKEN_ENCRYPTION_KEY)
    ) {
      for (const path of [
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_TOKEN_ENCRYPTION_KEY',
      ] as const) {
        if (!config[path]) {
          context.addIssue({
            code: 'custom',
            message:
              'Google OAuth client and token encryption credentials are required when enabled',
            path: [path],
          });
        }
      }
    }
    let modelAliases: Record<string, string> | undefined;
    try {
      const parsed: unknown = JSON.parse(config.OPENAI_MODEL_ALIASES_JSON);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed) ||
        Object.entries(parsed).some(
          ([alias, model]) =>
            alias.trim().length === 0 || typeof model !== 'string' || !model.trim(),
        )
      ) {
        throw new Error('invalid alias map');
      }
      modelAliases = parsed as Record<string, string>;
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'OpenAI model aliases must be a JSON object of nonempty string mappings',
        path: ['OPENAI_MODEL_ALIASES_JSON'],
      });
    }
    if (config.OPENAI_PROVIDER_ENABLED && !config.OPENAI_API_KEY) {
      context.addIssue({
        code: 'custom',
        message: 'OpenAI API key is required when the provider is enabled',
        path: ['OPENAI_API_KEY'],
      });
    }
    if (config.OPENAI_PROVIDER_ENABLED && !config.OPENAI_MODEL_SELECTION.trim()) {
      context.addIssue({
        code: 'custom',
        message: 'OpenAI model selection is required when the provider is enabled',
        path: ['OPENAI_MODEL_SELECTION'],
      });
    } else if (
      config.OPENAI_PROVIDER_ENABLED &&
      modelAliases &&
      !modelAliases[config.OPENAI_MODEL_SELECTION]
    ) {
      context.addIssue({
        code: 'custom',
        message: 'OpenAI model selection must resolve through the configured alias map',
        path: ['OPENAI_MODEL_SELECTION'],
      });
    }
    if (config.CONTACT_DELIVERY_ENABLED && !config.RESEND_API_KEY) {
      context.addIssue({
        code: 'custom',
        message: 'Resend API key is required when contact delivery is enabled',
        path: ['RESEND_API_KEY'],
      });
    }
    if (
      config.AUTH_EMAIL_DELIVERY_ENABLED &&
      (!config.RESEND_API_KEY || !config.RESEND_AUTH_FROM)
    ) {
      for (const path of ['RESEND_API_KEY', 'RESEND_AUTH_FROM'] as const) {
        if (!config[path]) {
          context.addIssue({
            code: 'custom',
            message:
              'Resend API key and verified auth sender are required when auth email is enabled',
            path: [path],
          });
        }
      }
    }
    if (
      config.ALERT_EMAIL_DELIVERY_ENABLED &&
      (!config.RESEND_API_KEY || !config.ALERT_EMAIL_RECIPIENT)
    ) {
      for (const path of ['RESEND_API_KEY', 'ALERT_EMAIL_RECIPIENT'] as const) {
        if (!config[path]) {
          context.addIssue({
            code: 'custom',
            message: 'Resend API key and alert recipient are required when alert email is enabled',
            path: [path],
          });
        }
      }
    }
    if (Boolean(config.TURNSTILE_SECRET_KEY) !== Boolean(config.TURNSTILE_SITE_KEY)) {
      context.addIssue({
        code: 'custom',
        message: 'Both Turnstile keys must be configured together',
        path: ['TURNSTILE_SITE_KEY'],
      });
    }
    if (config.OMNIREACH_ENV === 'production' && config.TRUSTED_PROXY_CIDRS.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Production requires an explicit trusted proxy IP/CIDR allowlist',
        path: ['TRUSTED_PROXY_CIDRS'],
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
}

export function parseConfig(
  input: NodeJS.ProcessEnv | Record<string, string | undefined>,
): AppConfig {
  const result = configSchema.safeParse(input);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.') || 'configuration');
    throw new ConfigurationError(
      `Invalid configuration fields: ${[...new Set(fields)].join(', ')}`,
    );
  }
  return result.data;
}

export function redactConfig(config: AppConfig): Record<string, string | number> {
  const redacted = {
    ...config,
    DATABASE_URL: redactUrl(config.DATABASE_URL),
    CONTACT_ENCRYPTION_KEY: '[REDACTED]',
    ...(config.MFA_ENCRYPTION_KEY ? { MFA_ENCRYPTION_KEY: '[REDACTED]' } : {}),
    ...(config.MFA_ENCRYPTION_KEYRING_JSON ? { MFA_ENCRYPTION_KEYRING_JSON: '[REDACTED]' } : {}),
    ...(config.GOOGLE_CLIENT_SECRET ? { GOOGLE_CLIENT_SECRET: '[REDACTED]' } : {}),
    ...(config.GOOGLE_TOKEN_ENCRYPTION_KEY ? { GOOGLE_TOKEN_ENCRYPTION_KEY: '[REDACTED]' } : {}),
    ...(config.OPENAI_API_KEY ? { OPENAI_API_KEY: '[REDACTED]' } : {}),
    ORAP_HOSTNAME: config.ORAP_HOSTNAME,
    PREVIEW_SIGNING_KEY: '[REDACTED]',
    REDIS_URL: redactUrl(config.REDIS_URL),
    ...(config.RESEND_API_KEY ? { RESEND_API_KEY: '[REDACTED]' } : {}),
    SESSION_SECRET: '[REDACTED]',
    ...(config.TURNSTILE_SECRET_KEY ? { TURNSTILE_SECRET_KEY: '[REDACTED]' } : {}),
    TRUSTED_PROXY_CIDRS: config.TRUSTED_PROXY_CIDRS.join(','),
  };
  return Object.fromEntries(
    Object.entries(redacted).filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    ),
  );
}

function redactUrl(value: string): string {
  const url = new URL(value);
  if (url.username) url.username = '[REDACTED]';
  if (url.password) url.password = '[REDACTED]';
  return url.toString();
}

function assertMfaKeyringJson(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
  const candidate = parsed as { activeVersion?: unknown; keys?: unknown };
  if (
    typeof candidate.activeVersion !== 'number' ||
    !Number.isSafeInteger(candidate.activeVersion) ||
    candidate.activeVersion <= 0 ||
    candidate.activeVersion > maximumPostgresInteger ||
    !candidate.keys ||
    typeof candidate.keys !== 'object' ||
    Array.isArray(candidate.keys)
  ) {
    throw new Error('invalid');
  }
  const entries = Object.entries(candidate.keys as Record<string, unknown>);
  if (
    entries.length === 0 ||
    entries.some(
      ([version, key]) =>
        !/^[1-9]\d*$/u.test(version) ||
        !Number.isSafeInteger(Number(version)) ||
        Number(version) > maximumPostgresInteger ||
        typeof key !== 'string' ||
        key.length < 32,
    ) ||
    !Object.hasOwn(candidate.keys, String(candidate.activeVersion)) ||
    new Set(entries.map(([, key]) => key)).size !== entries.length
  ) {
    throw new Error('invalid');
  }
  return entries.map(([, key]) => key as string);
}

function validIpOrCidr(value: string): boolean {
  const [address, prefix, ...extra] = value.split('/');
  if (!address || extra.length > 0) return false;
  const family = isIP(address) as IpFamily | 0;
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/u.test(prefix)) return false;
  const bits = Number(prefix);
  const maximumBits = addressBits[family];
  if (bits < 1 || bits > maximumBits) return false;

  const numericAddress = ipToBigInt(address, family);
  if (family === 6 && isIpv4MappedAddress(numericAddress)) {
    if (bits < 96) return false;
    return cidrPrefixIsSafe(numericAddress & ipv4Mask, bits - 96, 4);
  }
  return cidrPrefixIsSafe(numericAddress, bits, family);
}

function cidrPrefixIsSafe(address: bigint, prefix: number, family: IpFamily): boolean {
  const range = numericCidrRange(address, prefix, addressBits[family]);
  const minimumPrefix = privateOrSpecialRanges[family].some((specialRange) =>
    rangesIntersect(range, specialRange),
  )
    ? minimumPrivateOrSpecialPrefix[family]
    : minimumPublicPrefix[family];
  return prefix >= minimumPrefix;
}

function numericIpRange(address: string, prefix: number, family: IpFamily): NumericIpRange {
  return numericCidrRange(ipToBigInt(address, family), prefix, addressBits[family]);
}

function numericCidrRange(address: bigint, prefix: number, bits: number): NumericIpRange {
  const hostBits = BigInt(bits - prefix);
  const start = (address >> hostBits) << hostBits;
  return { start, end: start + (1n << hostBits) - 1n };
}

function rangesIntersect(left: NumericIpRange, right: NumericIpRange): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function isIpv4MappedAddress(address: bigint): boolean {
  return address >> 32n === 0xffffn;
}

function ipToBigInt(address: string, family: IpFamily): bigint {
  if (family === 4) {
    return address.split('.').reduce((result, octet) => (result << 8n) + BigInt(octet), 0n);
  }

  let normalized = address.split('%', 1)[0] ?? address;
  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':');
    const ipv4 = normalized
      .slice(lastColon + 1)
      .split('.')
      .map(Number);
    normalized = `${normalized.slice(0, lastColon)}:${((ipv4[0] ?? 0) * 256 + (ipv4[1] ?? 0)).toString(16)}:${((ipv4[2] ?? 0) * 256 + (ipv4[3] ?? 0)).toString(16)}`;
  }

  const [head = '', tail = ''] = normalized.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const omittedParts = 8 - headParts.length - tailParts.length;
  const parts = normalized.includes('::')
    ? [...headParts, ...Array<string>(omittedParts).fill('0'), ...tailParts]
    : headParts;
  return parts.reduce((result, part) => (result << 16n) + BigInt(`0x${part}`), 0n);
}
