import {
  decryptPasswordRecoveryDeliveryToken,
  encryptPasswordRecoveryDeliveryToken,
  PostgresPasswordRecoveryOutbox,
  type PasswordRecoveryOutboxClient,
  type PasswordRecoveryOutboxPool,
} from '@omnireach/auth';
import { describe, expect, it, vi } from 'vitest';

const keyMaterial = 'fictional-dedicated-mfa-key-material-0001';
const now = new Date('2026-10-11T12:00:00.000Z');
const token = 'Fictional_recovery-token-value-0123456789';

function poolFor(handler: (query: string, values: unknown[] | undefined) => Promise<unknown>): {
  client: PasswordRecoveryOutboxClient;
  pool: PasswordRecoveryOutboxPool;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(handler);
  const client: PasswordRecoveryOutboxClient = {
    query,
    release: vi.fn(),
  };
  return {
    client,
    pool: { connect: vi.fn(async () => client) },
    query,
  };
}

describe('password recovery delivery outbox', () => {
  it('encrypts the delivery copy with purpose-bound authenticated encryption', () => {
    const encrypted = encryptPasswordRecoveryDeliveryToken(token, keyMaterial);
    expect(Buffer.from(encrypted).includes(Buffer.from(token, 'utf8'))).toBe(false);
    expect(decryptPasswordRecoveryDeliveryToken(encrypted, keyMaterial)).toBe(token);
    expect(() =>
      decryptPasswordRecoveryDeliveryToken(
        encrypted,
        'different-fictional-key-material-for-test-0002',
      ),
    ).toThrow('authentication failed');
  });

  it('commits an encrypted outbox record without waiting for the provider', async () => {
    const provider = { send: vi.fn(async () => new Promise<void>(() => undefined)) };
    let insertedValues: unknown[] | undefined;
    const { pool } = poolFor(async (query, values) => {
      if (query.includes('INSERT INTO password_recovery_delivery_outbox')) {
        insertedValues = values;
        return { rows: [{ id: 'delivery-a' }] };
      }
      return { rows: [] };
    });
    const outbox = new PostgresPasswordRecoveryOutbox(pool, provider, keyMaterial, {
      now: () => now,
    });

    await expect(
      outbox.send({
        host: 'ADMIN.Alpha.Test:443',
        normalizedEmail: 'owner@alpha.example.test',
        token,
      }),
    ).resolves.toBeUndefined();

    expect(provider.send).not.toHaveBeenCalled();
    expect(insertedValues?.[0]).toMatch(/^[a-f0-9]{64}$/u);
    expect(insertedValues?.[1]).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(insertedValues?.[1] as Uint8Array).includes(Buffer.from(token))).toBe(false);
    expect(insertedValues?.slice(2)).toEqual(['admin.alpha.test', 'owner@alpha.example.test', now]);
  });

  it('erases encrypted payloads for used or expired tokens before claiming work', async () => {
    const calls: { query: string; values?: unknown[] }[] = [];
    const provider = { send: vi.fn(async () => undefined) };
    const { pool } = poolFor(async (query, values) => {
      calls.push({ query, ...(values ? { values } : {}) });
      return { rows: [] };
    });
    const outbox = new PostgresPasswordRecoveryOutbox(pool, provider, keyMaterial, {
      now: () => now,
    });

    await expect(outbox.processNext()).resolves.toBe('idle');

    const cleanupIndex = calls.findIndex(({ query }) => query.includes("status = 'expired'"));
    const claimIndex = calls.findIndex(({ query }) => query.includes('SELECT delivery.id'));
    const cleanup = calls[cleanupIndex];
    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(cleanupIndex).toBeLessThan(claimIndex);
    expect(cleanup?.query).toContain('encrypted_token = NULL');
    expect(cleanup?.query).toContain("delivery.status IN ('queued', 'processing')");
    expect(cleanup?.query).toContain('recovery.used_at IS NOT NULL');
    expect(cleanup?.query).toContain('recovery.expires_at <= $1');
    expect(cleanup?.values).toEqual([now]);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('reclaims an expired lease with a new fenced attempt and lease', async () => {
    const encrypted = encryptPasswordRecoveryDeliveryToken(token, keyMaterial);
    const provider = { send: vi.fn(async () => undefined) };
    const calls: { query: string; values?: unknown[] }[] = [];
    const leaseMs = 45_000;
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const { pool } = poolFor(async (query, values) => {
      calls.push({ query, ...(values ? { values } : {}) });
      if (query.includes('SELECT delivery.id')) {
        return {
          rows: [
            {
              attempts: 1,
              encrypted_token: encrypted,
              encryption_key_version: 1,
              expires_at: new Date(now.getTime() + 30 * 60_000),
              host: 'admin.alpha.test',
              id: 'delivery-reclaimed',
              normalized_email: 'owner@alpha.example.test',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const outbox = new PostgresPasswordRecoveryOutbox(pool, provider, keyMaterial, {
      leaseMs,
      now: () => now,
    });

    await expect(outbox.processNext()).resolves.toBe('delivered');

    const selection = calls.find(({ query }) => query.includes('SELECT delivery.id'));
    expect(selection?.query).toContain(
      "delivery.status = 'processing' AND delivery.locked_until <= $1",
    );
    const reclaim = calls.find(({ query }) => query.includes("SET status = 'processing'"));
    expect(reclaim?.values).toEqual([now, 2, leaseUntil, 'delivery-reclaimed']);

    const completion = calls.find(({ query }) => query.includes("status = 'delivered'"));
    expect(completion?.query).toContain(
      "WHERE id = $1 AND status = 'processing' AND attempts = $3",
    );
    expect(completion?.query).toContain('AND locked_until = $4');
    expect(completion?.values).toEqual(['delivery-reclaimed', now, 2, leaseUntil]);
  });

  it('leases delivery, calls the provider later, and erases ciphertext on success', async () => {
    const encrypted = encryptPasswordRecoveryDeliveryToken(token, keyMaterial);
    const provider = { send: vi.fn(async () => undefined) };
    const statements: string[] = [];
    let claimed = false;
    const { pool } = poolFor(async (query) => {
      statements.push(query);
      if (query.includes('SELECT delivery.id')) {
        if (claimed) return { rows: [] };
        claimed = true;
        return {
          rows: [
            {
              attempts: 0,
              encrypted_token: encrypted,
              encryption_key_version: 1,
              expires_at: new Date(now.getTime() + 30 * 60_000),
              host: 'admin.alpha.test',
              id: 'delivery-a',
              normalized_email: 'owner@alpha.example.test',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const outbox = new PostgresPasswordRecoveryOutbox(pool, provider, keyMaterial, {
      now: () => now,
    });

    await expect(outbox.processNext()).resolves.toBe('delivered');
    expect(provider.send).toHaveBeenCalledWith({
      host: 'admin.alpha.test',
      normalizedEmail: 'owner@alpha.example.test',
      token,
    });
    expect(
      statements.some(
        (query) =>
          query.includes("status = 'delivered'") && query.includes('encrypted_token = NULL'),
      ),
    ).toBe(true);
  });

  it('records a bounded provider failure without storing its error or the token', async () => {
    const encrypted = encryptPasswordRecoveryDeliveryToken(token, keyMaterial);
    const secretBearingError = `provider failed while sending ${token}`;
    const provider = { send: vi.fn(async () => Promise.reject(new Error(secretBearingError))) };
    const calls: { query: string; values?: unknown[] }[] = [];
    const { pool } = poolFor(async (query, values) => {
      calls.push({ query, ...(values ? { values } : {}) });
      if (query.includes('SELECT delivery.id')) {
        return {
          rows: [
            {
              attempts: 0,
              encrypted_token: encrypted,
              encryption_key_version: 1,
              expires_at: new Date(now.getTime() + 30 * 60_000),
              host: 'admin.alpha.test',
              id: 'delivery-a',
              normalized_email: 'owner@alpha.example.test',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const outbox = new PostgresPasswordRecoveryOutbox(pool, provider, keyMaterial, {
      maxAttempts: 1,
      now: () => now,
    });

    await expect(outbox.processNext()).resolves.toBe('failed');
    const terminal = calls.find(
      ({ query }) => query.includes("status = 'failed'") && query.includes('delivery_failed'),
    );
    expect(terminal?.query).toContain('encrypted_token = NULL');
    expect(JSON.stringify(calls)).not.toContain(secretBearingError);
    expect(JSON.stringify(calls)).not.toContain(token);
  });

  it('backs off exponentially for three attempts then erases the terminal payload', async () => {
    const encrypted = encryptPasswordRecoveryDeliveryToken(token, keyMaterial);
    const provider = { send: vi.fn(async () => Promise.reject(new Error('provider unavailable'))) };
    const calls: { query: string; values?: unknown[] }[] = [];
    const startedAt = now;
    let currentTime = startedAt;
    let selectedAttempts = 0;
    const baseRetryMs = 1_000;
    const leaseMs = 15_000;
    const expiresAt = new Date(startedAt.getTime() + 60 * 60_000);
    const { pool } = poolFor(async (query, values) => {
      calls.push({ query, ...(values ? { values } : {}) });
      if (query.includes('SELECT delivery.id')) {
        const attempts = selectedAttempts;
        selectedAttempts += 1;
        return {
          rows: [
            {
              attempts,
              encrypted_token: encrypted,
              encryption_key_version: 1,
              expires_at: expiresAt,
              host: 'admin.alpha.test',
              id: 'delivery-retry',
              normalized_email: 'owner@alpha.example.test',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const outbox = new PostgresPasswordRecoveryOutbox(pool, provider, keyMaterial, {
      baseRetryMs,
      leaseMs,
      maxAttempts: 3,
      now: () => currentTime,
    });

    await expect(outbox.processNext()).resolves.toBe('retrying');
    currentTime = new Date(startedAt.getTime() + baseRetryMs);
    await expect(outbox.processNext()).resolves.toBe('retrying');
    currentTime = new Date(startedAt.getTime() + baseRetryMs * 3);
    await expect(outbox.processNext()).resolves.toBe('failed');

    const retries = calls.filter(
      ({ query }) => query.includes("SET status = 'queued'") && query.includes('delivery_failed'),
    );
    expect(retries).toHaveLength(2);
    expect(retries[0]?.values).toEqual([
      'delivery-retry',
      startedAt,
      new Date(startedAt.getTime() + baseRetryMs),
      1,
      new Date(startedAt.getTime() + leaseMs),
    ]);
    expect(retries[1]?.values).toEqual([
      'delivery-retry',
      new Date(startedAt.getTime() + baseRetryMs),
      new Date(startedAt.getTime() + baseRetryMs * 3),
      2,
      new Date(startedAt.getTime() + baseRetryMs + leaseMs),
    ]);
    for (const retry of retries) {
      expect(retry.query).toContain("WHERE id = $1 AND status = 'processing' AND attempts = $4");
      expect(retry.query).toContain('AND locked_until = $5');
      expect(retry.query).not.toContain('encrypted_token = NULL');
    }

    const terminal = calls.find(
      ({ query }) => query.includes("SET status = 'failed'") && query.includes('delivery_failed'),
    );
    expect(terminal?.query).toContain('encrypted_token = NULL');
    expect(terminal?.query).toContain("WHERE id = $1 AND status = 'processing' AND attempts = $3");
    expect(terminal?.query).toContain('AND locked_until = $4');
    expect(terminal?.values).toEqual([
      'delivery-retry',
      new Date(startedAt.getTime() + baseRetryMs * 3),
      3,
      new Date(startedAt.getTime() + baseRetryMs * 3 + leaseMs),
    ]);
    expect(provider.send).toHaveBeenCalledTimes(3);
  });

  it('terminally erases a payload encrypted with an unknown key version', async () => {
    const encrypted = encryptPasswordRecoveryDeliveryToken(token, keyMaterial);
    const provider = { send: vi.fn(async () => undefined) };
    const calls: { query: string; values?: unknown[] }[] = [];
    const leaseMs = 20_000;
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const { pool } = poolFor(async (query, values) => {
      calls.push({ query, ...(values ? { values } : {}) });
      if (query.includes('SELECT delivery.id')) {
        return {
          rows: [
            {
              attempts: 0,
              encrypted_token: encrypted,
              encryption_key_version: 99,
              expires_at: new Date(now.getTime() + 30 * 60_000),
              host: 'admin.alpha.test',
              id: 'delivery-unknown-key',
              normalized_email: 'owner@alpha.example.test',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const outbox = new PostgresPasswordRecoveryOutbox(pool, provider, keyMaterial, {
      leaseMs,
      now: () => now,
    });

    await expect(outbox.processNext()).resolves.toBe('failed');

    expect(provider.send).not.toHaveBeenCalled();
    const terminal = calls.find(
      ({ query, values }) =>
        query.includes("SET status = 'failed'") && values?.includes('key_version_unavailable'),
    );
    expect(terminal?.query).toContain('encrypted_token = NULL');
    expect(terminal?.query).toContain("WHERE id = $1 AND status = 'processing' AND attempts = $4");
    expect(terminal?.query).toContain('AND locked_until = $5');
    expect(terminal?.values).toEqual([
      'delivery-unknown-key',
      'key_version_unavailable',
      now,
      1,
      leaseUntil,
    ]);
  });
});
