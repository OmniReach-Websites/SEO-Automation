import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

export interface OAuthRequest {
  readonly codeChallenge: string;
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly redirectUri: string;
  readonly state: string;
}
export interface GoogleProperty {
  readonly id: string;
  readonly kind: 'ga4' | 'search_console';
  readonly siteUrl: string;
}
export interface GoogleMetricPoint {
  readonly dimensions: Readonly<Record<string, string>>;
  readonly endDate: string;
  readonly metric: string;
  readonly propertyId: string;
  readonly source: 'ga4' | 'search_console';
  readonly startDate: string;
  readonly value: number;
}

export function createOAuthRequest(
  redirectUri: string,
  allowedRedirects: readonly string[],
): OAuthRequest {
  if (!allowedRedirects.includes(redirectUri))
    throw new Error('OAuth redirect URI is not allowlisted');
  const codeVerifier = randomBytes(32).toString('base64url');
  return {
    codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
    codeVerifier,
    nonce: randomBytes(24).toString('base64url'),
    redirectUri,
    state: randomBytes(24).toString('base64url'),
  };
}

export class EncryptedTokenVault {
  readonly #key: Buffer;
  readonly #records = new Map<string, Buffer>();
  constructor(hexKey: string) {
    if (!/^[a-f0-9]{64}$/iu.test(hexKey)) throw new Error('Token vault key must be 32 bytes');
    this.#key = Buffer.from(hexKey, 'hex');
  }
  store(token: string): string {
    const id = randomUUID();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    this.#records.set(id, Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
    return id;
  }
  read(id: string): string {
    const payload = this.#records.get(id);
    if (!payload) throw new Error('Unknown credential reference');
    const decipher = createDecipheriv('aes-256-gcm', this.#key, payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString(
      'utf8',
    );
  }
  revoke(id: string): void {
    this.#records.delete(id);
  }
}

export class GoogleConnectionManager {
  readonly #consumedStates = new Set<string>();
  readonly metrics = new Map<string, GoogleMetricPoint>();
  acceptCallback(
    expected: OAuthRequest,
    received: { readonly nonce: string; readonly redirectUri: string; readonly state: string },
  ): void {
    if (this.#consumedStates.has(received.state)) throw new Error('OAuth callback replay rejected');
    if (
      received.state !== expected.state ||
      received.nonce !== expected.nonce ||
      received.redirectUri !== expected.redirectUri
    )
      throw new Error('OAuth callback state, nonce, or redirect mismatch');
    this.#consumedStates.add(received.state);
  }
  verifyProperty(property: GoogleProperty, exactSiteHostname: string): void {
    const normalized = property.siteUrl.startsWith('sc-domain:')
      ? property.siteUrl.slice(10)
      : new URL(property.siteUrl).hostname;
    if (normalized.toLowerCase() !== exactSiteHostname.toLowerCase())
      throw new Error('Google property does not match the exact site');
  }
  ingest(points: readonly GoogleMetricPoint[]): number {
    let inserted = 0;
    for (const point of points) {
      const key = createHash('sha256').update(JSON.stringify(point)).digest('hex');
      if (!this.metrics.has(key)) {
        this.metrics.set(key, structuredClone(point));
        inserted += 1;
      }
    }
    return inserted;
  }
}

const aiReferralMap: Readonly<Record<string, string>> = {
  'chatgpt.com': 'ChatGPT',
  'copilot.microsoft.com': 'Microsoft Copilot',
  'gemini.google.com': 'Google Gemini',
  'perplexity.ai': 'Perplexity',
};
export function classifyAiReferral(source: string): {
  readonly classification: string | null;
  readonly mappingVersion: 1;
  readonly source: string;
} {
  const hostname =
    source
      .toLowerCase()
      .replace(/^https?:\/\//u, '')
      .split('/')[0] ?? source;
  return { classification: aiReferralMap[hostname] ?? null, mappingVersion: 1, source };
}
