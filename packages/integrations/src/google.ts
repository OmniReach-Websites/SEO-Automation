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

export type GoogleCollectionDataset =
  'ga4_source_medium' | 'search_console_page' | 'search_console_property' | 'search_console_query';

export interface GoogleCollectionDiagnostic {
  readonly complete: boolean;
  readonly dataset: GoogleCollectionDataset;
  readonly pageCount: number;
  readonly rows: number;
  readonly totalRows: number | null;
}

export interface GoogleCollectionResult {
  readonly complete: boolean;
  readonly diagnostics: readonly GoogleCollectionDiagnostic[];
  readonly points: readonly GoogleMetricPoint[];
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
  }): Promise<GoogleCollectionResult>;
}

export interface GoogleHttpProviderOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetchImpl?: typeof fetch;
  readonly maximumPages?: number;
  readonly pageSize?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

const googleScopes = {
  ga4: ['https://www.googleapis.com/auth/analytics.readonly'],
  search_console: ['https://www.googleapis.com/auth/webmasters.readonly'],
} as const;

const defaultPageSize = 25_000;
const defaultMaximumPages = 4;

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
  readonly #maximumPages: number;
  readonly #pageSize: number;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: GoogleHttpProviderOptions) {
    if (!options.clientId.trim() || !options.clientSecret.trim()) {
      throw new Error('Google OAuth client configuration is incomplete');
    }
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#maximumPages = boundedInteger(
      options.maximumPages ?? defaultMaximumPages,
      1,
      16,
      'Google maximum pages',
    );
    this.#pageSize = boundedInteger(
      options.pageSize ?? defaultPageSize,
      1,
      25_000,
      'Google page size',
    );
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
  }): Promise<GoogleCollectionResult> {
    assertIsoDate(input.startDate);
    assertIsoDate(input.endDate);
    if (input.startDate > input.endDate) throw new Error('Google metric window is invalid');
    if (!input.property.id.trim() || !input.property.siteUrl.trim()) {
      throw new GoogleProviderError('missing_property', false);
    }
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
  }): Promise<GoogleCollectionResult> {
    const collections = [
      await this.collectSearchConsoleDataset(input, 'search_console_property', ['date']),
      await this.collectSearchConsoleDataset(input, 'search_console_query', ['date', 'query']),
      await this.collectSearchConsoleDataset(input, 'search_console_page', ['date', 'page']),
    ];
    return {
      complete: collections.every(({ diagnostic }) => diagnostic.complete),
      diagnostics: collections.map(({ diagnostic }) => diagnostic),
      points: collections.flatMap(({ points }) => points),
    };
  }

  private async collectSearchConsoleDataset(
    input: {
      endDate: string;
      property: GoogleProperty;
      startDate: string;
      tokens: GoogleTokenSet;
    },
    dataset: Extract<GoogleCollectionDataset, `search_console_${string}`>,
    dimensions: readonly ('date' | 'page' | 'query')[],
  ): Promise<{ diagnostic: GoogleCollectionDiagnostic; points: GoogleMetricPoint[] }> {
    const points: GoogleMetricPoint[] = [];
    let rowsRead = 0;
    let pageCount = 0;
    let complete = false;
    for (let page = 0; page < this.#maximumPages; page += 1) {
      const response = await this.authorizedRequest(
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(input.property.id)}/searchAnalytics/query`,
        input.tokens,
        {
          body: JSON.stringify({
            dataState: 'final',
            dimensions,
            endDate: input.endDate,
            rowLimit: this.#pageSize,
            startDate: input.startDate,
            startRow: page * this.#pageSize,
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
      const rows = payload.rows ?? [];
      pageCount += 1;
      rowsRead += rows.length;
      for (const row of rows) {
        const values = Object.fromEntries(
          dimensions.map((dimension, index) => [dimension, row.keys?.[index] ?? '']),
        );
        const date = values.date || input.startDate;
        const aggregation = dataset.replace('search_console_', '');
        const pointDimensions = {
          aggregation,
          ...(dataset === 'search_console_query' ? { query: values.query ?? '' } : {}),
          ...(dataset === 'search_console_page' ? { page: values.page ?? '' } : {}),
        };
        for (const metric of ['clicks', 'impressions', 'ctr', 'position'] as const) {
          points.push({
            dimensions: pointDimensions,
            endDate: date,
            metric,
            propertyId: input.property.id,
            source: 'search_console',
            startDate: date,
            value: Number(row[metric] ?? 0),
          });
        }
      }
      if (rows.length < this.#pageSize) {
        complete = true;
        break;
      }
    }
    return {
      diagnostic: {
        complete,
        dataset,
        pageCount,
        rows: rowsRead,
        totalRows: null,
      },
      points,
    };
  }

  private async collectGa4(input: {
    endDate: string;
    property: GoogleProperty;
    startDate: string;
    tokens: GoogleTokenSet;
  }): Promise<GoogleCollectionResult> {
    const propertyId = input.property.id.replace(/^properties\//u, '');
    const points: GoogleMetricPoint[] = [];
    let pageCount = 0;
    let rowsRead = 0;
    let totalRows: number | null = null;
    let complete = false;
    for (let page = 0; page < this.#maximumPages; page += 1) {
      const response = await this.authorizedRequest(
        `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
        input.tokens,
        {
          body: JSON.stringify({
            dateRanges: [{ endDate: input.endDate, startDate: input.startDate }],
            dimensions: [{ name: 'date' }, { name: 'sessionSource' }, { name: 'sessionMedium' }],
            limit: String(this.#pageSize),
            metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }],
            offset: String(page * this.#pageSize),
            orderBys: [
              { dimension: { dimensionName: 'date' } },
              { dimension: { dimensionName: 'sessionSource' } },
              { dimension: { dimensionName: 'sessionMedium' } },
            ],
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      );
      const payload = (await response.json()) as {
        dimensionHeaders?: { name?: string }[];
        metricHeaders?: { name?: string }[];
        rowCount?: number;
        rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
      };
      const rows = payload.rows ?? [];
      const dimensions = (payload.dimensionHeaders ?? []).map((header) => header.name ?? 'unknown');
      const metrics = (payload.metricHeaders ?? []).map((header) => header.name ?? 'unknown');
      totalRows =
        Number.isInteger(payload.rowCount) && Number(payload.rowCount) >= 0
          ? Number(payload.rowCount)
          : totalRows;
      pageCount += 1;
      rowsRead += rows.length;
      for (const row of rows) {
        const values = Object.fromEntries(
          dimensions.map((name, index) => [name, row.dimensionValues?.[index]?.value ?? '']),
        );
        const rawDate = values.date ?? input.startDate.replaceAll('-', '');
        const date = /^\d{8}$/u.test(rawDate)
          ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6)}`
          : input.startDate;
        delete values.date;
        for (const [index, metric] of metrics.entries()) {
          points.push({
            dimensions: values,
            endDate: date,
            metric,
            propertyId: input.property.id,
            source: 'ga4',
            startDate: date,
            value: Number(row.metricValues?.[index]?.value ?? 0),
          });
        }
      }
      if (rows.length < this.#pageSize || (totalRows !== null && rowsRead >= totalRows)) {
        complete = true;
        break;
      }
    }
    const diagnostic: GoogleCollectionDiagnostic = {
      complete,
      dataset: 'ga4_source_medium',
      pageCount,
      rows: rowsRead,
      totalRows,
    };
    return { complete, diagnostics: [diagnostic], points };
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
      const reason = await googleErrorReason(response);
      const code = providerErrorCode(response.status, reason);
      const retryable =
        response.status === 429 || response.status >= 500 || code === 'quota_exhausted';
      if (!retryable || attempt === 3) {
        throw new GoogleProviderError(code, retryable, response.status);
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
      const key = createHash('sha256')
        .update(
          JSON.stringify({
            dimensions: Object.fromEntries(
              Object.entries(point.dimensions).sort(([left], [right]) => left.localeCompare(right)),
            ),
            endDate: point.endDate,
            metric: point.metric,
            propertyId: point.propertyId,
            source: point.source,
            startDate: point.startDate,
          }),
        )
        .digest('hex');
      if (!this.metrics.has(key)) {
        inserted += 1;
      }
      this.metrics.set(key, structuredClone(point));
    }
    return inserted;
  }
}

function assertIsoDate(value: string): void {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error('Google metric date must use YYYY-MM-DD');
  }
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
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

function providerErrorCode(status: number, reason: string | null): string {
  if (status === 401) return 'revoked_or_expired';
  if (status === 403 && reason && /(?:quota|ratelimit|limitexceeded)/iu.test(reason)) {
    return 'quota_exhausted';
  }
  if (status === 403) return 'insufficient_scope';
  if (status === 404) return 'property_not_found';
  if (status === 429) return 'quota_exhausted';
  if (status >= 500) return 'provider_unavailable';
  return 'provider_rejected';
}

async function googleErrorReason(response: Response): Promise<string | null> {
  try {
    const payload = (await response.clone().json()) as {
      error?: { details?: { reason?: string }[]; errors?: { reason?: string }[] };
    };
    return (
      payload.error?.errors?.find(({ reason }) => Boolean(reason))?.reason ??
      payload.error?.details?.find(({ reason }) => Boolean(reason))?.reason ??
      null
    );
  } catch {
    return null;
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
