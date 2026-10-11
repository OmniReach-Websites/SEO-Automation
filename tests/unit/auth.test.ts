import {
  decryptMfaSecret,
  encryptMfaSecret,
  createMfaEnrollment,
  createOneTimeToken,
  hasPermission,
  hashPassword,
  normalizeEmail,
  requiresMfa,
  sessionCookieOptions,
  verifyPassword,
} from '@omnireach/auth';
import * as OTPAuth from 'otpauth';
import { describe, expect, it } from 'vitest';

describe('authentication primitives', () => {
  it('normalizes identities and hashes passwords with Argon2id', async () => {
    expect(normalizeEmail('  OWNER@Example.TEST ')).toBe('owner@example.test');
    const encoded = await hashPassword('fictional-secure-password');
    expect(encoded).toContain('$argon2id$');
    expect(await verifyPassword(encoded, 'fictional-secure-password')).toBe(true);
    expect(await verifyPassword(encoded, 'incorrect-password')).toBe(false);
  });

  it('creates host-only secure cookie options and one-time token digests', () => {
    expect(sessionCookieOptions()).toEqual(
      expect.objectContaining({ httpOnly: true, path: '/', sameSite: 'strict', secure: true }),
    );
    expect(sessionCookieOptions()).not.toHaveProperty('domain');
    const first = createOneTimeToken();
    const second = createOneTimeToken();
    expect(first.token).not.toBe(first.digest);
    expect(first.digest).not.toBe(second.digest);
  });

  it('requires MFA for every platform role and denies permissions by default', () => {
    expect(requiresMfa('platform_owner')).toBe(true);
    expect(requiresMfa('platform_admin')).toBe(true);
    expect(requiresMfa('staff')).toBe(true);
    expect(requiresMfa('customer_owner')).toBe(false);
    expect(hasPermission('customer_viewer', 'content.edit')).toBe(false);
    expect(hasPermission('customer_editor', 'content.publish')).toBe(false);
    expect(hasPermission('customer_editor', 'content.publish', new Set(['content.publish']))).toBe(
      true,
    );
  });

  it('creates an authenticator enrollment and non-recoverable recovery-code digests', () => {
    const enrollment = createMfaEnrollment('fictional@example.test');
    const totp = OTPAuth.URI.parse(enrollment.uri);
    expect(totp).toBeInstanceOf(OTPAuth.TOTP);
    expect(enrollment.secret).not.toHaveLength(0);
    expect(enrollment.recoveryCodes).toHaveLength(10);
    expect(enrollment.recoveryDigests).toHaveLength(10);
    expect(enrollment.recoveryDigests).not.toContain(enrollment.recoveryCodes[0]);
  });

  it('encrypts MFA secrets with authenticated encryption and rejects tampering', () => {
    const key = 'fictional-dedicated-mfa-key-material-0001';
    const encrypted = encryptMfaSecret('JBSWY3DPEHPK3PXP', key);
    expect(Buffer.from(encrypted).toString('utf8')).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptMfaSecret(encrypted, key)).toBe('JBSWY3DPEHPK3PXP');
    const tampered = Uint8Array.from(encrypted);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() => decryptMfaSecret(tampered, key)).toThrow('authentication failed');
    expect(() => encryptMfaSecret('secret', 'too-short')).toThrow('too short');
  });
});
