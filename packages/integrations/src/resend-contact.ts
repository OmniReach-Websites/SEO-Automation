import {
  EmailProviderError,
  providerFailureCode,
  withEmailDeliveryQuota,
  type EmailDeliveryQuota,
} from './email-quota.ts';

export interface ResendContactSubmission {
  confirmationEnabled: boolean;
  email?: string;
  fields: Readonly<Record<string, string | true>>;
  formId: string;
  recipientEmail: string;
  siteId: string;
}

export interface ResendContactOptions {
  apiKey: string;
  fetchImplementation?: typeof fetch;
  from: string;
  maxAttempts?: number;
  quota?: EmailDeliveryQuota;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}

export class ResendContactDelivery {
  private readonly fetchImplementation: typeof fetch;
  private readonly maxAttempts: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(private readonly options: ResendContactOptions) {
    if (!options.apiKey.trim()) throw new Error('Resend API key is required');
    if (!isEmail(options.from)) throw new Error('Resend contact sender is invalid');
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.maxAttempts = options.maxAttempts ?? 1;
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 4) {
      throw new Error('Resend contact attempts must be between 1 and 4');
    }
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async deliver(
    submission: ResendContactSubmission,
  ): Promise<{ confirmationFailed?: boolean; providerReference: string }> {
    if (!isEmail(submission.recipientEmail)) throw new Error('Contact recipient is invalid');
    const providerReference = await this.send({
      ...(submission.email ? { replyTo: submission.email } : {}),
      subject: `New website inquiry (${submission.formId})`,
      text: renderFields(submission.fields),
      to: submission.recipientEmail,
    });
    if (submission.confirmationEnabled) {
      if (!submission.email || !isEmail(submission.email)) {
        return { confirmationFailed: true, providerReference };
      }
      try {
        await this.send({
          subject: 'We received your message',
          text: 'Your message was received. The business will respond using the contact details you supplied.',
          to: submission.email,
        });
      } catch {
        return { confirmationFailed: true, providerReference };
      }
    }
    return { providerReference };
  }

  private async send(input: {
    replyTo?: string;
    subject: string;
    text: string;
    to: string;
  }): Promise<string> {
    const delivered = await withEmailDeliveryQuota(
      this.options.quota,
      'contact',
      async (idempotencyKey) => {
        let lastError: EmailProviderError | undefined;
        for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
          let response: Response;
          try {
            response = await this.fetchImplementation('https://api.resend.com/emails', {
              body: JSON.stringify({
                from: this.options.from,
                ...(input.replyTo ? { reply_to: input.replyTo } : {}),
                subject: input.subject,
                text: input.text,
                to: [input.to],
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
            lastError = new EmailProviderError(
              'Resend contact delivery failed (network)',
              'network_failure',
            );
            if (attempt < this.maxAttempts) {
              await this.sleep(250 * 2 ** (attempt - 1));
              continue;
            }
            throw lastError;
          }
          if (!response.ok) {
            lastError = new EmailProviderError(
              `Resend contact delivery failed (${response.status})`,
              providerFailureCode(response.status),
            );
            if (attempt < this.maxAttempts && (response.status === 429 || response.status >= 500)) {
              await this.sleep(250 * 2 ** (attempt - 1));
              continue;
            }
            throw lastError;
          }
          let body: { id?: unknown };
          try {
            body = (await response.json()) as { id?: unknown };
          } catch {
            throw new EmailProviderError(
              'Resend contact delivery returned no reference',
              'provider_invalid_response',
            );
          }
          if (typeof body.id !== 'string' || !body.id) {
            throw new EmailProviderError(
              'Resend contact delivery returned no reference',
              'provider_invalid_response',
            );
          }
          return { providerReference: body.id };
        }
        throw (
          lastError ?? new EmailProviderError('Resend contact delivery failed', 'network_failure')
        );
      },
    );
    return delivered.providerReference;
  }
}

function renderFields(fields: Readonly<Record<string, string | true>>): string {
  return Object.entries(fields)
    .filter(([, value]) => value !== true)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join('\n\n');
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) && value.length <= 320;
}
