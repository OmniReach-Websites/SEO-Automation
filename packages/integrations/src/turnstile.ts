export interface TurnstileChallenge {
  readonly expectedHostname: string;
  readonly remoteIp: string;
  readonly token: string;
}

export interface TurnstileVerifier {
  verify(challenge: TurnstileChallenge): Promise<boolean>;
}

export class MockTurnstileVerifier implements TurnstileVerifier {
  constructor(private readonly accepted = true) {}

  async verify(): Promise<boolean> {
    return this.accepted;
  }
}

export class CloudflareTurnstileVerifier implements TurnstileVerifier {
  constructor(
    private readonly secret: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    if (!secret.trim()) throw new Error('Turnstile secret is required');
  }

  async verify(challenge: TurnstileChallenge): Promise<boolean> {
    if (!challenge.token || challenge.token.length > 2_048) return false;
    try {
      const body = new URLSearchParams({
        remoteip: challenge.remoteIp,
        response: challenge.token,
        secret: this.secret,
      });
      const response = await this.fetchImplementation(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          body,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          method: 'POST',
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) return false;
      const result = (await response.json()) as { hostname?: unknown; success?: unknown };
      return result.success === true && result.hostname === challenge.expectedHostname;
    } catch {
      // Verification outages, malformed responses, and timeouts fail closed without
      // leaking provider details or allowing the protected action to continue.
      return false;
    }
  }
}
