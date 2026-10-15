import type { UrgentEmail, UrgentEmailAdapter } from '@omnireach/observability';

import {
  EmailProviderError,
  providerFailureCode,
  withEmailDeliveryQuota,
  type EmailDeliveryQuota,
} from './email-quota.ts';

export interface ResendUrgentEmailOptions {
  readonly apiKey: string;
  readonly fetchImplementation?: typeof fetch;
  readonly from: string;
  readonly maxAttempts?: number;
  readonly quota?: EmailDeliveryQuota;
  readonly recipients: readonly string[];
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly timeoutMs?: number;
}

export class ResendUrgentEmailAdapter implements UrgentEmailAdapter {
  private readonly fetchImplementation: typeof fetch;
  private readonly maxAttempts: number;
  private readonly recipients: readonly string[];
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(private readonly options: ResendUrgentEmailOptions) {
    if (!options.apiKey.trim()) throw new Error('Resend API key is required');
    if (!isEmail(options.from)) throw new Error('Resend alert sender is invalid');
    this.recipients = [...new Set(options.recipients.map((recipient) => recipient.trim()))].sort();
    if (
      this.recipients.length < 1 ||
      this.recipients.length > 50 ||
      this.recipients.some((recipient) => !isEmail(recipient))
    ) {
      throw new Error('Resend alert recipients are invalid');
    }
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    // Retry orchestration belongs to the durable alert center so every provider
    // attempt is recorded. Standalone callers may opt in explicitly.
    this.maxAttempts = options.maxAttempts ?? 1;
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 4) {
      throw new Error('Resend alert attempts must be between 1 and 4');
    }
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async send(message: UrgentEmail): Promise<{ readonly providerReference: string }> {
    if (!message.subject || /token|password|secret=/iu.test(message.safeBody)) {
      throw new Error('Invalid or sensitive urgent email');
    }
    return withEmailDeliveryQuota(
      this.options.quota,
      'alert',
      async (idempotencyKey) => {
        let lastStatus = 0;
        for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
          let response: Response;
          try {
            response = await this.fetchImplementation('https://api.resend.com/emails', {
              body: JSON.stringify({
                from: this.options.from,
                headers: { 'X-Entity-Ref-ID': message.alertFingerprint },
                subject: message.subject,
                text: message.safeBody,
                to: this.recipients,
              }),
              headers: {
                Authorization: `Bearer ${this.options.apiKey}`,
                'Content-Type': 'application/json',
                ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
              },
              method: 'POST',
              signal: AbortSignal.timeout(this.timeoutMs),
            });
          } catch {
            if (attempt < this.maxAttempts) {
              await this.sleep(250 * 2 ** (attempt - 1));
              continue;
            }
            throw new EmailProviderError(
              'Resend alert delivery failed (network)',
              'network_failure',
            );
          }
          lastStatus = response.status;
          if (response.ok) {
            const body = (await response.json()) as { id?: unknown };
            if (typeof body.id !== 'string' || !body.id) {
              throw new EmailProviderError(
                'Resend alert delivery returned no reference',
                'provider_invalid_response',
              );
            }
            return { providerReference: body.id };
          }
          if (attempt < this.maxAttempts && (response.status === 429 || response.status >= 500)) {
            await this.sleep(250 * 2 ** (attempt - 1));
            continue;
          }
          throw new EmailProviderError(
            `Resend alert delivery failed (${response.status})`,
            providerFailureCode(response.status),
          );
        }
        throw new EmailProviderError(
          `Resend alert delivery failed (${lastStatus || 'network'})`,
          lastStatus ? providerFailureCode(lastStatus) : 'network_failure',
        );
      },
      this.recipients.length,
    );
  }
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) && value.length <= 320;
}
