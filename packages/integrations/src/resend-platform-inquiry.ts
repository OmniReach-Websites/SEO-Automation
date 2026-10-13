export interface PlatformInquiryMessage {
  businessName?: string;
  email: string;
  message: string;
  name: string;
  phone?: string;
  recipients: readonly string[];
}

export interface ResendPlatformInquiryOptions {
  apiKey: string;
  fetchImplementation?: typeof fetch;
  from: string;
  timeoutMs?: number;
}

export class ResendPlatformInquiryDelivery {
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ResendPlatformInquiryOptions) {
    if (!options.apiKey.trim()) throw new Error('Resend API key is required');
    if (!isEmail(options.from)) throw new Error('Resend inquiry sender is invalid');
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async deliver(message: PlatformInquiryMessage): Promise<{ providerReference: string }> {
    const recipients = [...new Set(message.recipients.map((email) => email.toLowerCase()))];
    if (recipients.length === 0 || recipients.some((email) => !isEmail(email))) {
      throw new Error('Platform inquiry recipients are invalid');
    }
    if (!isEmail(message.email)) throw new Error('Platform inquiry reply address is invalid');

    const response = await this.fetchImplementation('https://api.resend.com/emails', {
      body: JSON.stringify({
        from: this.options.from,
        reply_to: message.email,
        subject: `New OmniReach inquiry from ${message.businessName || message.name}`,
        text: renderMessage(message),
        to: recipients,
      }),
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Resend inquiry delivery failed (${response.status})`);
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || !body.id) {
      throw new Error('Resend inquiry delivery returned no reference');
    }
    return { providerReference: body.id };
  }
}

function renderMessage(message: PlatformInquiryMessage): string {
  return [
    `Name: ${message.name}`,
    `Email: ${message.email}`,
    ...(message.phone ? [`Phone: ${message.phone}`] : []),
    ...(message.businessName ? [`Business: ${message.businessName}`] : []),
    `Message:\n${message.message}`,
  ].join('\n\n');
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) && value.length <= 320;
}
