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
  timeoutMs?: number;
}

export class ResendContactDelivery {
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ResendContactOptions) {
    if (!options.apiKey.trim()) throw new Error('Resend API key is required');
    if (!isEmail(options.from)) throw new Error('Resend contact sender is invalid');
    this.fetchImplementation = options.fetchImplementation ?? fetch;
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
    const response = await this.fetchImplementation('https://api.resend.com/emails', {
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
      },
      method: 'POST',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Resend contact delivery failed (${response.status})`);
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || !body.id) {
      throw new Error('Resend contact delivery returned no reference');
    }
    return body.id;
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
