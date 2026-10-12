import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ivBytes = 12;
const tagBytes = 16;
const formatVersion = 1;
const passwordRecoveryDeliveryPurpose = Buffer.from(
  'omnireach-password-recovery-delivery-v1',
  'utf8',
);

export function encryptMfaSecret(secret: string, keyMaterial: string): Uint8Array {
  if (!secret) throw new Error('MFA secret is required');
  const iv = randomBytes(ivBytes);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(keyMaterial), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([formatVersion]), iv, tag, ciphertext]);
}

export function decryptMfaSecret(encrypted: Uint8Array, keyMaterial: string): string {
  const value = Buffer.from(encrypted);
  if (value.length <= 1 + ivBytes + tagBytes || value[0] !== formatVersion) {
    throw new Error('Encrypted MFA secret format is invalid');
  }
  const iv = value.subarray(1, 1 + ivBytes);
  const tag = value.subarray(1 + ivBytes, 1 + ivBytes + tagBytes);
  const ciphertext = value.subarray(1 + ivBytes + tagBytes);
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(keyMaterial), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Encrypted MFA secret authentication failed');
  }
}

/**
 * Encrypts the short-lived copy of a password-recovery token that the durable
 * delivery outbox needs. The reset token stored on the recovery record remains
 * one-way hashed; this encrypted copy is domain-separated from MFA encryption and
 * is erased after delivery or a terminal failure.
 */
export function encryptPasswordRecoveryDeliveryToken(
  token: string,
  keyMaterial: string,
): Uint8Array {
  if (!token) throw new Error('Password recovery delivery token is required');
  const iv = randomBytes(ivBytes);
  const cipher = createCipheriv('aes-256-gcm', passwordRecoveryDeliveryKey(keyMaterial), iv);
  cipher.setAAD(passwordRecoveryDeliveryPurpose);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([formatVersion]), iv, tag, ciphertext]);
}

export function decryptPasswordRecoveryDeliveryToken(
  encrypted: Uint8Array,
  keyMaterial: string,
): string {
  const value = Buffer.from(encrypted);
  if (value.length <= 1 + ivBytes + tagBytes || value[0] !== formatVersion) {
    throw new Error('Encrypted password recovery delivery token format is invalid');
  }
  const iv = value.subarray(1, 1 + ivBytes);
  const tag = value.subarray(1 + ivBytes, 1 + ivBytes + tagBytes);
  const ciphertext = value.subarray(1 + ivBytes + tagBytes);
  try {
    const decipher = createDecipheriv('aes-256-gcm', passwordRecoveryDeliveryKey(keyMaterial), iv);
    decipher.setAAD(passwordRecoveryDeliveryPurpose);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Encrypted password recovery delivery token authentication failed');
  }
}

function encryptionKey(keyMaterial: string): Buffer {
  if (keyMaterial.length < 32) throw new Error('MFA encryption key material is too short');
  return createHash('sha256').update(keyMaterial, 'utf8').digest();
}

function passwordRecoveryDeliveryKey(keyMaterial: string): Buffer {
  if (keyMaterial.length < 32) {
    throw new Error('Password recovery delivery encryption key material is too short');
  }
  return createHash('sha256')
    .update(passwordRecoveryDeliveryPurpose)
    .update('\0', 'utf8')
    .update(keyMaterial, 'utf8')
    .digest();
}
