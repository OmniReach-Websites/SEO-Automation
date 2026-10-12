import { hkdfSync, randomInt, createHmac } from 'node:crypto';

export function createEmailVerificationCode(): string {
  return randomInt(0, 100_000_000).toString().padStart(8, '0');
}

export function digestEmailVerificationCode(input: {
  challengeId: string;
  code: string;
  host: string;
  keyMaterial: string;
  userId: string;
}): string {
  if (!/^\d{8}$/u.test(input.code)) throw new Error('Email verification code is invalid');
  const key = hkdfSync(
    'sha256',
    Buffer.from(input.keyMaterial, 'utf8'),
    Buffer.alloc(0),
    Buffer.from('omnireach-email-verification-code-v1', 'utf8'),
    32,
  );
  return createHmac('sha256', Buffer.from(key))
    .update(input.challengeId, 'utf8')
    .update('\0', 'utf8')
    .update(input.userId, 'utf8')
    .update('\0', 'utf8')
    .update(input.host.trim().toLowerCase(), 'utf8')
    .update('\0', 'utf8')
    .update(input.code, 'utf8')
    .digest('hex');
}
