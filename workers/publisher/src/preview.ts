import { createHmac, timingSafeEqual } from 'node:crypto';

interface PreviewClaims {
  expiresAt: number;
  siteId: string;
  snapshotHash: string;
}

export function createPreviewToken(claims: PreviewClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyPreviewToken(token: string, secret: string, now = Date.now()): PreviewClaims {
  const [payload, received] = token.split('.');
  if (!payload || !received) throw new Error('Invalid preview token');
  const expected = createHmac('sha256', secret).update(payload).digest();
  const receivedBytes = Buffer.from(received, 'base64url');
  if (receivedBytes.length !== expected.length || !timingSafeEqual(receivedBytes, expected)) {
    throw new Error('Invalid preview token');
  }
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PreviewClaims;
  if (claims.expiresAt <= now) throw new Error('Preview token expired');
  return claims;
}

export const previewHeaders = {
  'Cache-Control': 'private, no-store',
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; form-action 'none'",
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
} as const;
