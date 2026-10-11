import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ivBytes = 12;
const tagBytes = 16;
const formatVersion = 1;

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

function encryptionKey(keyMaterial: string): Buffer {
  if (keyMaterial.length < 32) throw new Error('MFA encryption key material is too short');
  return createHash('sha256').update(keyMaterial, 'utf8').digest();
}
