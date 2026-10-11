import { z } from 'zod';

const optionalNonempty = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

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
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    MFA_ENCRYPTION_KEY: z.string().min(32),
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
  })
  .superRefine((config, context) => {
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
    MFA_ENCRYPTION_KEY: '[REDACTED]',
    ...(config.OPENAI_API_KEY ? { OPENAI_API_KEY: '[REDACTED]' } : {}),
    ORAP_HOSTNAME: config.ORAP_HOSTNAME,
    PREVIEW_SIGNING_KEY: '[REDACTED]',
    REDIS_URL: redactUrl(config.REDIS_URL),
    ...(config.RESEND_API_KEY ? { RESEND_API_KEY: '[REDACTED]' } : {}),
    SESSION_SECRET: '[REDACTED]',
    ...(config.TURNSTILE_SECRET_KEY ? { TURNSTILE_SECRET_KEY: '[REDACTED]' } : {}),
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
