import {
  EmailProviderError,
  providerFailureCode,
  withEmailDeliveryQuota,
  type EmailDeliveryQuota,
} from './email-quota.ts';

export interface VerificationCodeEmailInput {
  readonly code: string;
  readonly normalizedEmail: string;
}

export interface ResendVerificationCodeOptions {
  readonly apiKey: string;
  readonly fetchImplementation?: typeof fetch;
  readonly from: string;
  readonly quota?: EmailDeliveryQuota;
  readonly timeoutMs?: number;
}

export class ResendVerificationCodeNotifier {
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ResendVerificationCodeOptions) {
    if (!options.apiKey.trim()) throw new Error('Resend API key is required');
    if (!isEmail(options.from)) throw new Error('Resend verification-code sender is invalid');
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async send(input: VerificationCodeEmailInput): Promise<void> {
    if (!isEmail(input.normalizedEmail)) {
      throw new Error('Verification-code recipient is invalid');
    }
    if (!/^\d{8}$/u.test(input.code)) {
      throw new Error('Verification code is invalid');
    }

    await withEmailDeliveryQuota(this.options.quota, 'authentication', async (idempotencyKey) => {
      let response: Response;
      try {
        response = await this.fetchImplementation('https://api.resend.com/emails', {
          body: JSON.stringify({
            from: this.options.from,
            subject: 'Verify your OmniReach sign-in',
            text: `Your OmniReach verification code is:\n\n${input.code}\n\nThis code expires in 5 minutes. If you did not try to sign in, you can ignore this email.`,
            to: [input.normalizedEmail],
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
        throw new EmailProviderError(
          'Resend verification-code delivery failed (network)',
          'network_failure',
        );
      }

      if (!response.ok) {
        throw new EmailProviderError(
          `Resend verification-code delivery failed (${response.status})`,
          providerFailureCode(response.status),
        );
      }
      let body: { id?: unknown };
      try {
        body = (await response.json()) as { id?: unknown };
      } catch {
        throw new EmailProviderError(
          'Resend verification-code delivery returned no reference',
          'provider_invalid_response',
        );
      }
      if (typeof body.id !== 'string' || !body.id) {
        throw new EmailProviderError(
          'Resend verification-code delivery returned no reference',
          'provider_invalid_response',
        );
      }
      return { providerReference: body.id };
    });
  }
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) && value.length <= 320;
}
