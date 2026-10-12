import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ivBytes = 12;
const tagBytes = 16;
const formatVersion = 1;
export const maximumMfaKeyVersion = 2_147_483_647;
const passwordRecoveryDeliveryPurpose = Buffer.from(
  'omnireach-password-recovery-delivery-v1',
  'utf8',
);

export interface VersionedSecretKeyring {
  activeVersion: number;
  keys: ReadonlyMap<number, string>;
}

export interface VersionedSecretKeyringInput {
  activeVersion: number;
  keys: Readonly<Record<string, string>>;
}

export interface ActiveSecretKey {
  keyMaterial: string;
  keyVersion: number;
}

/**
 * Parses the host-only JSON keyring used for encrypted authentication state.
 * The legacy single key remains a version-1 bridge so an existing installation
 * can deploy keyring-capable code before introducing a new key.
 */
export function parseVersionedSecretKeyring(
  serializedKeyring: string | undefined,
  legacyKeyMaterial?: string,
): VersionedSecretKeyring {
  if (!serializedKeyring) {
    if (!legacyKeyMaterial) throw new Error('MFA encryption keyring is required');
    return createVersionedSecretKeyring({ activeVersion: 1, keys: { 1: legacyKeyMaterial } });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedKeyring);
  } catch {
    throw new Error('MFA encryption keyring JSON is invalid');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MFA encryption keyring JSON is invalid');
  }
  const candidate = parsed as { activeVersion?: unknown; keys?: unknown };
  if (
    !Number.isSafeInteger(candidate.activeVersion) ||
    typeof candidate.activeVersion !== 'number' ||
    candidate.activeVersion <= 0 ||
    candidate.activeVersion > maximumMfaKeyVersion ||
    !candidate.keys ||
    typeof candidate.keys !== 'object' ||
    Array.isArray(candidate.keys)
  ) {
    throw new Error('MFA encryption keyring JSON is invalid');
  }
  return createVersionedSecretKeyring({
    activeVersion: candidate.activeVersion,
    keys: candidate.keys as Record<string, string>,
  });
}

export function createVersionedSecretKeyring(
  input: VersionedSecretKeyringInput,
): VersionedSecretKeyring {
  if (
    !Number.isSafeInteger(input.activeVersion) ||
    input.activeVersion <= 0 ||
    input.activeVersion > maximumMfaKeyVersion
  ) {
    throw new Error('MFA encryption keyring active version is invalid');
  }
  const entries = Object.entries(input.keys);
  if (entries.length === 0) throw new Error('MFA encryption keyring has no keys');

  const keys = new Map<number, string>();
  const uniqueMaterial = new Set<string>();
  for (const [rawVersion, keyMaterial] of entries) {
    if (!/^[1-9]\d*$/u.test(rawVersion)) {
      throw new Error('MFA encryption keyring version is invalid');
    }
    const version = Number(rawVersion);
    if (
      !Number.isSafeInteger(version) ||
      version <= 0 ||
      version > maximumMfaKeyVersion ||
      typeof keyMaterial !== 'string'
    ) {
      throw new Error('MFA encryption keyring entry is invalid');
    }
    assertKeyMaterial(keyMaterial);
    if (keys.has(version) || uniqueMaterial.has(keyMaterial)) {
      throw new Error('MFA encryption keyring entries must be unique');
    }
    keys.set(version, keyMaterial);
    uniqueMaterial.add(keyMaterial);
  }
  if (!keys.has(input.activeVersion)) {
    throw new Error('MFA encryption keyring active version is unavailable');
  }
  return Object.freeze({ activeVersion: input.activeVersion, keys });
}

export function activeSecretKey(keyring: VersionedSecretKeyring): ActiveSecretKey {
  const keyMaterial = keyring.keys.get(keyring.activeVersion);
  if (!keyMaterial) throw new Error('MFA encryption keyring active version is unavailable');
  return { keyMaterial, keyVersion: keyring.activeVersion };
}

export function secretKeyForVersion(
  keyring: VersionedSecretKeyring,
  keyVersion: number,
): string | undefined {
  if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0 || keyVersion > maximumMfaKeyVersion) {
    return undefined;
  }
  return keyring.keys.get(keyVersion);
}

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
  assertKeyMaterial(keyMaterial);
  return createHash('sha256').update(keyMaterial, 'utf8').digest();
}

function passwordRecoveryDeliveryKey(keyMaterial: string): Buffer {
  assertKeyMaterial(keyMaterial, 'Password recovery delivery encryption key material');
  return createHash('sha256')
    .update(passwordRecoveryDeliveryPurpose)
    .update('\0', 'utf8')
    .update(keyMaterial, 'utf8')
    .digest();
}

function assertKeyMaterial(keyMaterial: string, name = 'MFA encryption key material'): void {
  if (keyMaterial.length < 32) throw new Error(`${name} is too short`);
}
