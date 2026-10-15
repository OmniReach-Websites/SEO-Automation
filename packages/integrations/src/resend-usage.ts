import { EmailProviderError, providerFailureCode } from './email-quota.ts';

export interface EmailProviderUsageWindow {
  readonly limit: number;
  readonly resetsAt: string;
  readonly used: number;
}

export interface EmailProviderUsageSnapshot {
  readonly daily: EmailProviderUsageWindow;
  readonly monthly: EmailProviderUsageWindow;
}

export interface ResendAccountUsageOptions {
  readonly apiKey: string;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
}

export class ResendAccountUsageProvider {
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ResendAccountUsageOptions) {
    if (!options.apiKey.trim()) throw new Error('Resend API key is required');
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async read(): Promise<EmailProviderUsageSnapshot> {
    let response: Response;
    try {
      response = await this.fetchImplementation('https://api.resend.com/usage', {
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
        method: 'GET',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new EmailProviderError('Resend usage lookup failed (network)', 'network_failure');
    }
    if (!response.ok) {
      throw new EmailProviderError(
        `Resend usage lookup failed (${response.status})`,
        providerFailureCode(response.status),
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new EmailProviderError(
        'Resend usage lookup returned an invalid response',
        'provider_invalid_response',
      );
    }
    if (!record(body) || !record(body.emails)) {
      throw new EmailProviderError(
        'Resend usage lookup returned an invalid response',
        'provider_invalid_response',
      );
    }
    return {
      daily: usageWindow(body.emails.daily),
      monthly: usageWindow(body.emails.monthly),
    };
  }
}

function usageWindow(value: unknown): EmailProviderUsageWindow {
  if (!record(value)) return invalidUsage();
  const used = boundedInteger(value.used);
  const limit = boundedInteger(value.limit);
  const resetsAt = typeof value.resets_at === 'string' ? value.resets_at : '';
  if (used === undefined || limit === undefined || !validTimestamp(resetsAt)) {
    return invalidUsage();
  }
  return { limit, resetsAt, used };
}

function invalidUsage(): never {
  throw new EmailProviderError(
    'Resend usage lookup returned an invalid response',
    'provider_invalid_response',
  );
}

function boundedInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000_000
    ? Number(value)
    : undefined;
}

function validTimestamp(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
