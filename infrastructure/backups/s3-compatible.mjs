import { createHash, createHmac } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

export class S3CompatibleBackupStore {
  #accessKeyId;
  #bucket;
  #endpoint;
  #fetch;
  #prefix;
  #region;
  #secretAccessKey;

  constructor(options) {
    if (
      !options?.endpoint ||
      !options?.bucket ||
      !options?.accessKeyId ||
      !options?.secretAccessKey
    ) {
      throw new Error('S3-compatible backup storage configuration is incomplete');
    }
    const endpoint = new URL(options.endpoint);
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search
    ) {
      throw new Error('Backup storage endpoint must be a credential-free HTTPS URL');
    }
    this.#endpoint = endpoint;
    this.#bucket = validateSegment(options.bucket, 'bucket');
    this.#prefix = normalizePrefix(options.prefix ?? 'omnireach');
    this.#region = options.region?.trim() || 'auto';
    this.#accessKeyId = options.accessKeyId;
    this.#secretAccessKey = options.secretAccessKey;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async upload(localPath) {
    const body = await readFile(localPath);
    const key = this.keyFor(basename(localPath));
    await this.request('PUT', key, { body });
    const downloaded = await this.downloadBytes(key);
    if (!safeHashEqual(body, downloaded)) {
      throw new Error('Off-site backup verification failed after upload');
    }
    return { key, sha256: sha256(body), size: body.byteLength };
  }

  async download(key, targetPath) {
    const body = await this.downloadBytes(key);
    await writeFile(targetPath, body, { flag: 'wx', mode: 0o600 });
    return { key, sha256: sha256(body), size: body.byteLength, targetPath };
  }

  async downloadBytes(key) {
    const response = await this.request('GET', this.assertOwnedKey(key));
    return Buffer.from(await response.arrayBuffer());
  }

  async remove(key) {
    await this.request('DELETE', this.assertOwnedKey(key));
  }

  async list() {
    const results = [];
    let continuationToken;
    do {
      const query = new URLSearchParams({ 'list-type': '2', prefix: `${this.#prefix}/` });
      if (continuationToken) query.set('continuation-token', continuationToken);
      const response = await this.request('GET', '', { query });
      const xml = await response.text();
      for (const block of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gu)) {
        const value = block[1] ?? '';
        const key = xmlValue(value, 'Key');
        if (!key) continue;
        results.push({
          etag: xmlValue(value, 'ETag')?.replaceAll('&quot;', '').replaceAll('"', ''),
          key,
          lastModified: xmlValue(value, 'LastModified'),
          size: Number(xmlValue(value, 'Size') ?? 0),
        });
      }
      continuationToken = xmlValue(xml, 'NextContinuationToken');
    } while (continuationToken);
    return results;
  }

  keyFor(name) {
    const normalized = validateSegment(name, 'object name');
    return `${this.#prefix}/${normalized}`;
  }

  assertOwnedKey(key) {
    if (typeof key !== 'string' || !key.startsWith(`${this.#prefix}/`)) {
      throw new Error('Backup object is outside the configured prefix');
    }
    const rest = key.slice(this.#prefix.length + 1);
    validateSegment(rest, 'object name');
    return key;
  }

  async request(method, key, options = {}) {
    const body = options.body ?? Buffer.alloc(0);
    const encodedPath = [this.#bucket, ...key.split('/').filter(Boolean)]
      .map(encodeRfc3986)
      .join('/');
    const url = new URL(`/${encodedPath}`, this.#endpoint);
    if (options.query) url.search = canonicalQuery(options.query);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/gu, '');
    const date = amzDate.slice(0, 8);
    const payloadHash = sha256(body);
    const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [
      method,
      url.pathname,
      url.search.slice(1),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${date}/${this.#region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256(Buffer.from(canonicalRequest)),
    ].join('\n');
    const signingKey = hmac(
      hmac(hmac(hmac(Buffer.from(`AWS4${this.#secretAccessKey}`), date), this.#region), 's3'),
      'aws4_request',
    );
    const signature = hmac(signingKey, stringToSign).toString('hex');
    const response = await this.#fetch(url, {
      body: method === 'PUT' ? body : undefined,
      headers: {
        Authorization: `AWS4-HMAC-SHA256 Credential=${this.#accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
      },
      method,
    });
    if (!response.ok) {
      throw new Error(`Off-site backup request failed with HTTP ${response.status}`);
    }
    return response;
  }
}

function canonicalQuery(query) {
  return [...query.entries()]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function normalizePrefix(value) {
  const segments = value
    .trim()
    .replace(/^\/+|\/+$/gu, '')
    .split('/');
  if (segments.length === 0 || segments.some((segment) => !validateSegment(segment, 'prefix'))) {
    throw new Error('Invalid backup object prefix');
  }
  return segments.join('/');
}

function safeHashEqual(left, right) {
  return sha256(left) === sha256(right);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validateSegment(value, label) {
  if (
    typeof value !== 'string' ||
    !value ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    })
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function xmlValue(xml, name) {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'u').exec(xml);
  return match?.[1]
    ?.replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}
