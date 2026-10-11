import { hash, verify, type Options } from '@node-rs/argon2';

const options: Options = {
  algorithm: 2,
  memoryCost: 65_536,
  outputLen: 32,
  parallelism: 1,
  timeCost: 3,
};

export function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new Error('Password must contain between 12 and 128 characters');
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  return hash(password, options);
}

export async function verifyPassword(passwordHash: string, candidate: string): Promise<boolean> {
  try {
    return await verify(passwordHash, candidate, options);
  } catch {
    return false;
  }
}

export function normalizeEmail(email: string): string {
  const normalized = email.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    throw new Error('Invalid email address');
  }
  return normalized;
}
