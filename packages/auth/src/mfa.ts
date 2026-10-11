import { randomBytes } from 'node:crypto';

import * as OTPAuth from 'otpauth';

import { digestToken } from './tokens.ts';

export interface MfaEnrollment {
  recoveryCodes: string[];
  recoveryDigests: string[];
  secret: string;
  uri: string;
}

export function createMfaEnrollment(label: string, issuer = 'OmniReach'): MfaEnrollment {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    issuer,
    label,
    period: 30,
    secret,
  });
  const recoveryCodes = Array.from({ length: 10 }, () => {
    const value = randomBytes(8).toString('hex').toUpperCase();
    return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12)}`;
  });
  return {
    recoveryCodes,
    recoveryDigests: recoveryCodes.map(digestToken),
    secret: secret.base32,
    uri: totp.toString(),
  };
}

export function verifyTotp(secret: string, token: string, timestamp = Date.now()): boolean {
  const totp = new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    issuer: 'OmniReach',
    label: 'authentication',
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.validate({ timestamp, token, window: 1 }) !== null;
}
