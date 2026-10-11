import {
  assertSafeCrawlTarget,
  canonicalizeCrawlUrl,
  type ResolveHostname,
} from '@omnireach/seo-core';

export interface CrawlResponse {
  readonly body: string;
  readonly contentType: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
}
export interface CrawlEvidence {
  readonly canonical?: string;
  readonly contentType: string;
  readonly headings: readonly string[];
  readonly images: readonly { readonly alt: string | null; readonly src: string }[];
  readonly links: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly methodVersion: 1;
  readonly status: number;
  readonly structuredDataCount: number;
  readonly truncated: boolean;
  readonly url: string;
}

export async function crawlSite(options: {
  readonly fetchRaw: (url: URL, maximumBytes: number, timeoutMs: number) => Promise<CrawlResponse>;
  readonly isAllowedByRobots?: (url: URL) => Promise<boolean>;
  readonly maxBytes: number;
  readonly maxPages: number;
  readonly maxQueryVariantsPerPath?: number;
  readonly maxRedirects: number;
  readonly ownedSiteMode?: boolean;
  readonly resolveHostname: ResolveHostname;
  readonly startUrl: string;
  readonly timeoutMs: number;
}): Promise<readonly CrawlEvidence[]> {
  const start = canonicalizeCrawlUrl(options.startUrl);
  const policy = {
    allowedHostname: start.hostname,
    allowedPorts: [Number(start.port || (start.protocol === 'https:' ? 443 : 80))],
    maxRedirects: options.maxRedirects,
    ownedSiteMode: options.ownedSiteMode ?? true,
  };
  const pending = [start.href];
  const seen = new Set<string>();
  const queryVariants = new Map<string, Set<string>>();
  const evidence: CrawlEvidence[] = [];
  while (pending.length > 0 && evidence.length < options.maxPages) {
    const nextUrl = pending.shift();
    if (!nextUrl) break;
    let current = canonicalizeCrawlUrl(nextUrl);
    if (seen.has(current.href)) continue;
    const pathKey = `${current.origin}${current.pathname}`;
    const variants = queryVariants.get(pathKey) ?? new Set<string>();
    if (!variants.has(current.search)) {
      if (variants.size >= (options.maxQueryVariantsPerPath ?? 4)) continue;
      variants.add(current.search);
      queryVariants.set(pathKey, variants);
    }
    seen.add(current.href);
    let redirects = 0;
    let response: CrawlResponse;
    while (true) {
      await assertSafeCrawlTarget(current, policy, options.resolveHostname);
      if (!policy.ownedSiteMode) {
        if (!options.isAllowedByRobots) throw new Error('External crawl requires robots policy');
        if (!(await options.isAllowedByRobots(current))) {
          throw new Error('Crawl target is disallowed by robots policy');
        }
      }
      response = await withTimeout(
        options.fetchRaw(current, options.maxBytes, options.timeoutMs),
        options.timeoutMs,
      );
      if (Buffer.byteLength(response.body, 'utf8') > options.maxBytes) {
        throw new Error('Response body exceeded crawl byte budget');
      }
      const location = response.headers.location;
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) break;
      if (++redirects > options.maxRedirects) throw new Error('Redirect budget exceeded');
      current = canonicalizeCrawlUrl(location, current.href);
    }
    if (!/^text\/html(?:;|$)/iu.test(response.contentType)) {
      evidence.push({
        contentType: response.contentType,
        headings: [],
        images: [],
        links: [],
        metadata: {},
        methodVersion: 1,
        status: response.status,
        structuredDataCount: 0,
        truncated: response.body.length >= options.maxBytes,
        url: current.href,
      });
      continue;
    }
    const parsed = extractHtmlEvidence(response.body, current);
    evidence.push({
      ...parsed,
      contentType: response.contentType,
      methodVersion: 1,
      status: response.status,
      truncated: response.body.length >= options.maxBytes,
      url: current.href,
    });
    for (const link of parsed.links)
      if (!seen.has(link) && new URL(link).hostname === start.hostname) pending.push(link);
  }
  return evidence;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Crawl request timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function extractHtmlEvidence(
  body: string,
  base: URL,
): Omit<CrawlEvidence, 'contentType' | 'methodVersion' | 'status' | 'truncated' | 'url'> {
  const matchAll = (expression: RegExp) => [...body.matchAll(expression)];
  const links = matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/giu).flatMap((match) =>
    match[1] ? [canonicalizeCrawlUrl(match[1], base.href).href] : [],
  );
  const images = matchAll(/<img\b([^>]*)>/giu).map((match) => ({
    alt: /\balt=["']([^"']*)["']/iu.exec(match[1] ?? '')?.[1] ?? null,
    src: canonicalizeCrawlUrl(
      /\bsrc=["']([^"']+)["']/iu.exec(match[1] ?? '')?.[1] ?? '/',
      base.href,
    ).href,
  }));
  const title = /<title[^>]*>([^<]*)<\/title>/iu.exec(body)?.[1]?.trim();
  const description = /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/iu
    .exec(body)?.[1]
    ?.trim();
  const canonical = /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/iu.exec(
    body,
  )?.[1];
  return {
    ...(canonical ? { canonical: canonicalizeCrawlUrl(canonical, base.href).href } : {}),
    headings: matchAll(/<h[1-6]\b[^>]*>(.*?)<\/h[1-6]>/gisu).map((match) =>
      (match[1] ?? '').replace(/<[^>]+>/gu, '').trim(),
    ),
    images,
    links: [...new Set(links)],
    metadata: { ...(title ? { title } : {}), ...(description ? { description } : {}) },
    structuredDataCount: matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>/giu)
      .length,
  };
}
