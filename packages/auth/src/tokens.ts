import { createHash, randomBytes } from 'node:crypto';

export interface OneTimeToken {
  digest: string;
  token: string;
}

export function createOneTimeToken(): OneTimeToken {
  const token = randomBytes(32).toString('base64url');
  return { digest: digestToken(token), token };
}

export function digestToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface SessionCookieOptions {
  httpOnly: true;
  maxAge: number;
  path: '/';
  sameSite: 'strict';
  secure: true;
}

export function sessionCookieOptions(maxAgeSeconds = 60 * 60 * 8): SessionCookieOptions {
  return { httpOnly: true, maxAge: maxAgeSeconds, path: '/', sameSite: 'strict', secure: true };
}
