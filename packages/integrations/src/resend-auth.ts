export type AuthenticationEmailKind = 'invitation' | 'password-recovery';

export interface AuthenticationEmailInput {
  readonly host: string;
  readonly normalizedEmail: string;
  readonly token: string;
}

export interface ResendAuthenticationOptions {
  readonly apiKey: string;
  readonly fetchImplementation?: typeof fetch;
  readonly from: string;
  readonly kind: AuthenticationEmailKind;
  readonly timeoutMs?: number;
}

export class ResendAuthenticationNotifier {
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ResendAuthenticationOptions) {
    if (!options.apiKey.trim()) throw new Error('Resend API key is required');
    if (!isEmail(options.from)) throw new Error('Resend authentication sender is invalid');
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async send(input: AuthenticationEmailInput): Promise<void> {
    if (!isEmail(input.normalizedEmail)) throw new Error('Authentication recipient is invalid');
    if (!/^[A-Za-z0-9_-]{32,256}$/u.test(input.token)) {
      throw new Error('Authentication token is invalid');
    }
    const url = authenticationUrl(input.host, input.token, this.options.kind);
    const invitation = this.options.kind === 'invitation';
    const response = await this.fetchImplementation('https://api.resend.com/emails', {
      body: JSON.stringify({
        from: this.options.from,
        subject: invitation ? 'Your OmniReach website invitation' : 'Reset your OmniReach password',
        text: invitation
          ? `Use this one-time link to accept your OmniReach website invitation:\n\n${url}\n\nThis link expires in 7 days.`
          : `Use this one-time link to reset your OmniReach password:\n\n${url}\n\nThis link expires in 30 minutes. If you did not request this, ignore this message.`,
        to: [input.normalizedEmail],
      }),
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Resend authentication delivery failed (${response.status})`);
    }
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || !body.id) {
      throw new Error('Resend authentication delivery returned no reference');
    }
  }
}

function authenticationUrl(host: string, token: string, kind: AuthenticationEmailKind): string {
  const compactHost = host.trim().toLowerCase();
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      compactHost,
    )
  ) {
    throw new Error('Authentication host is invalid');
  }
  const url = new URL(
    kind === 'invitation' ? '/auth/invitations/accept' : '/auth/recovery',
    `https://${compactHost}`,
  );
  url.searchParams.set('token', token);
  return url.toString();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) && value.length <= 320;
}
