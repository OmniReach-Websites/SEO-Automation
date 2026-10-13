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

export interface GoogleTokenSet {
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly refreshToken?: string;
  readonly scopes: readonly string[];
}

export interface GoogleProviderClient {
  authorizationUrl(request: OAuthRequest, propertyKind: GoogleProperty['kind']): string;
  exchangeCode(input: { code: string; request: OAuthRequest }): Promise<GoogleTokenSet>;
  listProperties(
    tokens: GoogleTokenSet,
    kind: GoogleProperty['kind'],
  ): Promise<readonly GoogleProperty[]>;
  refresh(tokens: GoogleTokenSet): Promise<GoogleTokenSet>;
  revoke(tokens: GoogleTokenSet): Promise<void>;
  collect(input: {
    endDate: string;
    property: GoogleProperty;
    startDate: string;
    tokens: GoogleTokenSet;
  }): Promise<readonly GoogleMetricPoint[]>;
}

export interface GoogleHttpProviderOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

const googleScopes = {
  ga4: ['https://www.googleapis.com/auth/analytics.readonly'],
  search_console: ['https://www.googleapis.com/auth/webmasters.readonly'],
} as const;

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

export class GoogleHttpProvider implements GoogleProviderClient {
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #fetch: typeof fetch;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: GoogleHttpProviderOptions) {
    if (!options.clientId.trim() || !options.clientSecret.trim()) {
      throw new Error('Google OAuth client configuration is incomplete');
    }
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  authorizationUrl(request: OAuthRequest, propertyKind: GoogleProperty['kind']): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      access_type: 'offline',
      client_id: this.#clientId,
      code_challenge: request.codeChallenge,
      code_challenge_method: 'S256',
      include_granted_scopes: 'false',
      nonce: request.nonce,
      prompt: 'consent',
      redirect_uri: request.redirectUri,
      response_type: 'code',
      scope: googleScopes[propertyKind].join(' '),
      state: request.state,
    }).toString();
    return url.toString();
  }

  async exchangeCode(input: { code: string; request: OAuthRequest }): Promise<GoogleTokenSet> {
    const response = await this.request('https://oauth2.googleapis.com/token', {
      body: new URLSearchParams({
        client_id: this.#clientId,
        client_secret: this.#clientSecret,
        code: input.code,
        code_verifier: input.request.codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: input.request.redirectUri,
      }),
      method: 'POST',
    });
    return parseTokenResponse(await response.json());
  }

  async refresh(tokens: GoogleTokenSet): Promise<GoogleTokenSet> {
    if (!tokens.refreshToken) throw new GoogleProviderError('missing_refresh_token', false);
    const response = await this.request('https://oauth2.googleapis.com/token', {
      body: new URLSearchParams({
        client_id: this.#clientId,
        client_secret: this.#clientSecret,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      }),
      method: 'POST',
    });
    const refreshed = parseTokenResponse(await response.json());
    return { ...refreshed, refreshToken: tokens.refreshToken };
  }

  async revoke(tokens: GoogleTokenSet): Promise<void> {
    const token = tokens.refreshToken ?? tokens.accessToken;
    await this.request('https://oauth2.googleapis.com/revoke', {
      body: new URLSearchParams({ token }),
      method: 'POST',
    });
  }

  async listProperties(
    tokens: GoogleTokenSet,
    kind: GoogleProperty['kind'],
  ): Promise<readonly GoogleProperty[]> {
    return kind === 'search_console'
      ? this.listSearchConsoleProperties(tokens)
      : this.listGa4Properties(tokens);
  }

  async collect(input: {
    endDate: string;
    property: GoogleProperty;
    startDate: string;
    tokens: GoogleTokenSet;
  }): Promise<readonly GoogleMetricPoint[]> {
    assertIsoDate(input.startDate);
    assertIsoDate(input.endDate);
    if (input.startDate > input.endDate) throw new Error('Google metric window is invalid');
    return input.property.kind === 'search_console'
      ? this.collectSearchConsole(input)
      : this.collectGa4(input);
  }

  private async listSearchConsoleProperties(tokens: GoogleTokenSet): Promise<GoogleProperty[]> {
    const response = await this.authorizedRequest(
      'https://www.googleapis.com/webmasters/v3/sites',
      tokens,
    );
    const payload = (await response.json()) as { siteEntry?: { siteUrl?: string }[] };
    return (payload.siteEntry ?? [])
      .filter((entry): entry is { siteUrl: string } => Boolean(entry.siteUrl))
      .map((entry) => ({ id: entry.siteUrl, kind: 'search_console', siteUrl: entry.siteUrl }));
  }

  private async listGa4Properties(tokens: GoogleTokenSet): Promise<GoogleProperty[]> {
    const result: GoogleProperty[] = [];
    let pageToken = '';
    do {
      const url = new URL('https://analyticsadmin.googleapis.com/v1beta/accountSummaries');
      url.searchParams.set('pageSize', '200');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await this.authorizedRequest(url.toString(), tokens);
      const payload = (await response.json()) as {
        accountSummaries?: { propertySummaries?: { property?: string }[] }[];
        nextPageToken?: string;
      };
      for (const account of payload.accountSummaries ?? []) {
        for (const summary of account.propertySummaries ?? []) {
          if (!summary.property) continue;
          const streams = await this.authorizedRequest(
            `https://analyticsadmin.googleapis.com/v1beta/${encodeGoogleResource(summary.property)}/dataStreams`,
            tokens,
          );
          const streamsPayload = (await streams.json()) as {
            dataStreams?: { type?: string; webStreamData?: { defaultUri?: string } }[];
          };
          for (const stream of streamsPayload.dataStreams ?? []) {
            const siteUrl = stream.webStreamData?.defaultUri;
            if (stream.type === 'WEB_DATA_STREAM' && siteUrl) {
              result.push({ id: summary.property, kind: 'ga4', siteUrl });
            }
          }
        }
      }
      pageToken = payload.nextPageToken ?? '';
    } while (pageToken);
    return result;
  }

  private async collectSearchConsole(input: {
    endDate: string;
    property: GoogleProperty;
    startDate: string;
    tokens: GoogleTokenSet;
  }): Promise<GoogleMetricPoint[]> {
    const response = await this.authorizedRequest(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(input.property.id)}/searchAnalytics/query`,
      input.tokens,
      {
        body: JSON.stringify({
          dataState: 'final',
          dimensions: ['date', 'query', 'page', 'country', 'device'],
          endDate: input.endDate,
          rowLimit: 25_000,
          startDate: input.startDate,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    );
    const payload = (await response.json()) as {
      rows?: {
        clicks?: number;
        ctr?: number;
        impressions?: number;
        keys?: string[];
        position?: number;
      }[];
    };
    const metrics = ['clicks', 'impressions', 'ctr', 'position'] as const;
    return (payload.rows ?? []).flatMap((row) => {
      const [date = input.startDate, query = '', page = '', country = '', device = ''] =
        row.keys ?? [];
      const dimensions = { country, device, page, query };
      return metrics.map((metric) => ({
        dimensions,
        endDate: date,
        metric,
        propertyId: input.property.id,
        source: 'search_console' as const,
        startDate: date,
        value: Number(row[metric] ?? 0),
      }));
    });
  }

  private async collectGa4(input: {
    endDate: string;
    property: GoogleProperty;
    startDate: string;
    tokens: GoogleTokenSet;
  }): Promise<GoogleMetricPoint[]> {
    const propertyId = input.property.id.replace(/^properties\//u, '');
    const response = await this.authorizedRequest(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
      input.tokens,
      {
        body: JSON.stringify({
          dateRanges: [{ endDate: input.endDate, startDate: input.startDate }],
          dimensions: [{ name: 'date' }, { name: 'sessionSource' }, { name: 'sessionMedium' }],
          limit: '100000',
          metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }],
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    );
    const payload = (await response.json()) as {
      dimensionHeaders?: { name?: string }[];
      metricHeaders?: { name?: string }[];
      rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
    };
    const dimensions = (payload.dimensionHeaders ?? []).map((header) => header.name ?? 'unknown');
    const metrics = (payload.metricHeaders ?? []).map((header) => header.name ?? 'unknown');
    return (payload.rows ?? []).flatMap((row) => {
      const values = Object.fromEntries(
        dimensions.map((name, index) => [name, row.dimensionValues?.[index]?.value ?? '']),
      );
      const rawDate = values.date ?? input.startDate.replaceAll('-', '');
      const date = /^\d{8}$/u.test(rawDate)
        ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6)}`
        : input.startDate;
      delete values.date;
      return metrics.map((metric, index) => ({
        dimensions: values,
        endDate: date,
        metric,
        propertyId: input.property.id,
        source: 'ga4' as const,
        startDate: date,
        value: Number(row.metricValues?.[index]?.value ?? 0),
      }));
    });
  }

  private authorizedRequest(url: string, tokens: GoogleTokenSet, init: RequestInit = {}) {
    return this.request(url, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers).entries()),
        authorization: `Bearer ${tokens.accessToken}`,
      },
    });
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.#fetch(url, init);
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 3) {
        throw new GoogleProviderError(
          providerErrorCode(response.status),
          retryable,
          response.status,
        );
      }
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
      await this.#sleep(
        Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 30_000) : 250 * 2 ** attempt,
      );
    }
    throw new GoogleProviderError('retry_exhausted', true);
  }
}

export class GoogleProviderError extends Error {
  override readonly name = 'GoogleProviderError';
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(`Google provider request failed: ${code}`);
  }
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

function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error('Google metric date must use YYYY-MM-DD');
  }
}

function encodeGoogleResource(value: string): string {
  return value
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function parseTokenResponse(value: unknown): GoogleTokenSet {
  if (!value || typeof value !== 'object')
    throw new GoogleProviderError('invalid_token_response', false);
  const payload = value as Record<string, unknown>;
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new GoogleProviderError('invalid_token_response', false);
  }
  const expiresIn = Number(payload.expires_in ?? 3600);
  const scopes =
    typeof payload.scope === 'string' ? payload.scope.split(/\s+/u).filter(Boolean) : [];
  return {
    accessToken: payload.access_token,
    expiresAt: new Date(Date.now() + Math.max(60, expiresIn) * 1000).toISOString(),
    ...(typeof payload.refresh_token === 'string' ? { refreshToken: payload.refresh_token } : {}),
    scopes,
  };
}

function providerErrorCode(status: number): string {
  if (status === 401) return 'revoked_or_expired';
  if (status === 403) return 'insufficient_scope_or_quota';
  if (status === 429) return 'quota_exhausted';
  if (status >= 500) return 'provider_unavailable';
  return 'provider_rejected';
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
