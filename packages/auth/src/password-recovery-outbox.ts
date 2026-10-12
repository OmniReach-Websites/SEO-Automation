import { domainToASCII } from 'node:url';

import {
  activeSecretKey,
  createVersionedSecretKeyring,
  decryptPasswordRecoveryDeliveryToken,
  encryptPasswordRecoveryDeliveryToken,
  secretKeyForVersion,
  type VersionedSecretKeyring,
} from './secrets.ts';
import type { PasswordRecoveryNotifier } from './service.ts';
import { digestToken } from './tokens.ts';

export interface PasswordRecoveryOutboxClient {
  query(query: string, values?: unknown[]): Promise<unknown>;
  release(): void;
}

export interface PasswordRecoveryOutboxPool {
  connect(): Promise<PasswordRecoveryOutboxClient>;
}

export type PasswordRecoveryOutboxResult = 'delivered' | 'expired' | 'failed' | 'idle' | 'retrying';

interface ClaimedDelivery {
  attempts: number;
  encrypted_token: Uint8Array;
  encryption_key_version: number;
  expires_at: Date;
  host: string;
  id: string;
  leaseUntil: Date;
  normalized_email: string;
}

interface OutboxOptions {
  baseRetryMs?: number;
  batchSize?: number;
  leaseMs?: number;
  maxAttempts?: number;
  now?: () => Date;
  pollIntervalMs?: number;
}

/**
 * A durable adapter between password-recovery issuance and the email provider.
 * `send` only encrypts and commits an outbox record; provider I/O happens later in
 * `processNext`. This keeps request latency independent of the provider and lets a
 * crashed process safely resume through a bounded lease.
 */
export class PostgresPasswordRecoveryOutbox implements PasswordRecoveryNotifier {
  readonly #baseRetryMs: number;
  readonly #batchSize: number;
  readonly #leaseMs: number;
  readonly #maxAttempts: number;
  readonly #now: () => Date;
  readonly #pollIntervalMs: number;
  readonly #keyring: VersionedSecretKeyring;
  #activeDrain: Promise<void> | undefined;
  #timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly pool: PasswordRecoveryOutboxPool,
    private readonly downstream: PasswordRecoveryNotifier,
    keyring: string | VersionedSecretKeyring,
    options: OutboxOptions = {},
  ) {
    this.#keyring =
      typeof keyring === 'string'
        ? createVersionedSecretKeyring({ activeVersion: 1, keys: { 1: keyring } })
        : keyring;
    this.#baseRetryMs = positiveInteger(options.baseRetryMs ?? 30_000, 'base retry');
    this.#batchSize = positiveInteger(options.batchSize ?? 10, 'batch size');
    this.#leaseMs = positiveInteger(options.leaseMs ?? 60_000, 'lease');
    this.#maxAttempts = positiveInteger(options.maxAttempts ?? 3, 'maximum attempts');
    this.#now = options.now ?? (() => new Date());
    this.#pollIntervalMs = positiveInteger(options.pollIntervalMs ?? 1_000, 'poll interval');
  }

  async send(input: { host: string; normalizedEmail: string; token: string }): Promise<void> {
    const now = this.#now();
    const activeKey = activeSecretKey(this.#keyring);
    const encryptedToken = encryptPasswordRecoveryDeliveryToken(input.token, activeKey.keyMaterial);
    const rows = await this.transaction<{ id: string }[]>(async (client) =>
      queryRows<{ id: string }>(
        client,
        `INSERT INTO password_recovery_delivery_outbox
           (recovery_token_id, encrypted_token, encryption_key_version, status,
            attempts, available_at)
         SELECT recovery.id, $2, $3, 'queued', 0, $6
           FROM password_recovery_tokens recovery
           JOIN users account ON account.id = recovery.user_id
          WHERE recovery.token_hash = $1
            AND recovery.host = $4
            AND account.normalized_email = $5
            AND recovery.used_at IS NULL
            AND recovery.expires_at > $6
         ON CONFLICT (recovery_token_id) DO NOTHING
         RETURNING id`,
        [
          digestToken(input.token),
          encryptedToken,
          activeKey.keyVersion,
          normalizeHost(input.host),
          input.normalizedEmail,
          now,
        ],
      ),
    );
    if (rows.length !== 1) throw new Error('Password recovery delivery could not be queued');
  }

  async processNext(): Promise<PasswordRecoveryOutboxResult> {
    const now = this.#now();
    const delivery = await this.claim(now);
    if (!delivery) return 'idle';

    const keyMaterial = secretKeyForVersion(this.#keyring, delivery.encryption_key_version);
    if (!keyMaterial) {
      await this.finishKeyUnavailable(delivery, now);
      return 'retrying';
    }

    let token: string;
    try {
      token = decryptPasswordRecoveryDeliveryToken(delivery.encrypted_token, keyMaterial);
    } catch {
      await this.finishTerminal(delivery, 'payload_invalid', now);
      return 'failed';
    }

    try {
      await this.downstream.send({
        host: delivery.host,
        normalizedEmail: delivery.normalized_email,
        token,
      });
    } catch {
      return this.finishDeliveryFailure(delivery, this.#now());
    }

    const deliveredAt = this.#now();
    await this.transaction(async (client) => {
      await client.query(
        `UPDATE password_recovery_delivery_outbox
            SET status = 'delivered', encrypted_token = NULL, delivered_at = $2,
                locked_until = NULL, last_error_code = NULL, updated_at = $2
          WHERE id = $1 AND status = 'processing' AND attempts = $3
            AND locked_until = $4`,
        [delivery.id, deliveredAt, delivery.attempts, delivery.leaseUntil],
      );
    });
    return 'delivered';
  }

  start(onProcessingError: () => void = () => undefined): void {
    if (this.#timer) return;
    const tick = (): void => {
      if (this.#activeDrain) return;
      this.#activeDrain = this.drain()
        .catch(() => onProcessingError())
        .finally(() => {
          this.#activeDrain = undefined;
        });
    };
    this.#timer = setInterval(tick, this.#pollIntervalMs);
    this.#timer.unref();
    tick();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#activeDrain;
  }

  private async claim(now: Date): Promise<ClaimedDelivery | undefined> {
    return this.transaction(async (client) => {
      await client.query(
        `UPDATE password_recovery_delivery_outbox delivery
            SET status = 'expired', encrypted_token = NULL, locked_until = NULL,
                last_error_code = 'token_unavailable', updated_at = $1
           FROM password_recovery_tokens recovery
          WHERE recovery.id = delivery.recovery_token_id
            AND delivery.status IN ('queued', 'processing')
            AND (recovery.used_at IS NOT NULL OR recovery.expires_at <= $1)`,
        [now],
      );
      await client.query(
        `UPDATE password_recovery_delivery_outbox
            SET status = 'failed', encrypted_token = NULL, locked_until = NULL,
                last_error_code = 'attempts_exhausted', updated_at = $1
          WHERE status = 'processing' AND locked_until <= $1 AND attempts >= $2`,
        [now, this.#maxAttempts],
      );
      const candidates = await queryRows<ClaimedDelivery>(
        client,
        `SELECT delivery.id, delivery.encrypted_token, delivery.encryption_key_version,
                delivery.attempts,
                recovery.expires_at, recovery.host, account.normalized_email
           FROM password_recovery_delivery_outbox delivery
           JOIN password_recovery_tokens recovery ON recovery.id = delivery.recovery_token_id
           JOIN users account ON account.id = recovery.user_id
          WHERE recovery.used_at IS NULL AND recovery.expires_at > $1
            AND delivery.attempts < $2
            AND (
              (delivery.status = 'queued' AND delivery.available_at <= $1)
              OR (delivery.status = 'processing' AND delivery.locked_until <= $1)
            )
          ORDER BY delivery.available_at, delivery.created_at
          FOR UPDATE OF delivery SKIP LOCKED
          LIMIT 1`,
        [now, this.#maxAttempts],
      );
      const candidate = candidates[0];
      if (!candidate) return undefined;
      const attempts = candidate.attempts + 1;
      const leaseUntil = new Date(now.getTime() + this.#leaseMs);
      await client.query(
        `UPDATE password_recovery_delivery_outbox
            SET status = 'processing', attempts = $2, locked_until = $3,
                updated_at = $1
          WHERE id = $4`,
        [now, attempts, leaseUntil, candidate.id],
      );
      return { ...candidate, attempts, leaseUntil };
    });
  }

  private async drain(): Promise<void> {
    for (let processed = 0; processed < this.#batchSize; processed += 1) {
      if ((await this.processNext()) === 'idle') return;
    }
  }

  private async finishDeliveryFailure(
    delivery: ClaimedDelivery,
    now: Date,
  ): Promise<'failed' | 'retrying'> {
    const retryAt = new Date(
      now.getTime() + this.#baseRetryMs * 2 ** Math.max(0, delivery.attempts - 1),
    );
    const terminal = delivery.attempts >= this.#maxAttempts || retryAt >= delivery.expires_at;
    await this.transaction(async (client) => {
      await client.query(
        terminal
          ? `UPDATE password_recovery_delivery_outbox
                SET status = 'failed', encrypted_token = NULL, locked_until = NULL,
                    last_error_code = 'delivery_failed', updated_at = $2
              WHERE id = $1 AND status = 'processing' AND attempts = $3
                AND locked_until = $4`
          : `UPDATE password_recovery_delivery_outbox
                SET status = 'queued', available_at = $3, locked_until = NULL,
                    last_error_code = 'delivery_failed', updated_at = $2
              WHERE id = $1 AND status = 'processing' AND attempts = $4
                AND locked_until = $5`,
        terminal
          ? [delivery.id, now, delivery.attempts, delivery.leaseUntil]
          : [delivery.id, now, retryAt, delivery.attempts, delivery.leaseUntil],
      );
    });
    return terminal ? 'failed' : 'retrying';
  }

  private async finishTerminal(
    delivery: ClaimedDelivery,
    errorCode: string,
    now: Date,
  ): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(
        `UPDATE password_recovery_delivery_outbox
            SET status = 'failed', encrypted_token = NULL, locked_until = NULL,
                last_error_code = $2, updated_at = $3
          WHERE id = $1 AND status = 'processing' AND attempts = $4
            AND locked_until = $5`,
        [delivery.id, errorCode, now, delivery.attempts, delivery.leaseUntil],
      );
    });
  }

  private async finishKeyUnavailable(delivery: ClaimedDelivery, now: Date): Promise<void> {
    const retryAt = new Date(now.getTime() + this.#baseRetryMs);
    await this.transaction(async (client) => {
      await client.query(
        `UPDATE password_recovery_delivery_outbox
            SET status = 'queued', attempts = GREATEST(attempts - 1, 0),
                available_at = $2, locked_until = NULL,
                last_error_code = 'key_version_unavailable', updated_at = $3
          WHERE id = $1 AND status = 'processing' AND attempts = $4
            AND locked_until = $5`,
        [delivery.id, retryAt, now, delivery.attempts, delivery.leaseUntil],
      );
    });
  }

  private async transaction<T>(
    operation: (client: PasswordRecoveryOutboxClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE omnireach_auth');
      await client.query(`SELECT set_config('app.authentication_contract_version', '3', true)`);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function queryRows<Row>(
  client: PasswordRecoveryOutboxClient,
  sql: string,
  values?: unknown[],
): Promise<Row[]> {
  const result = await client.query(sql, values);
  if (!result || typeof result !== 'object' || !('rows' in result)) {
    throw new Error('Password recovery outbox query returned no rows');
  }
  const rows = (result as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) throw new Error('Password recovery outbox query rows are invalid');
  return rows as Row[];
}

function normalizeHost(value: string): string {
  const withoutPort = value.trim().toLowerCase().replace(/\.$/u, '').split(':')[0] ?? '';
  const ascii = domainToASCII(withoutPort);
  if (!ascii || ascii.includes('/') || ascii.length > 253) {
    throw new Error('Authentication host is invalid');
  }
  return ascii;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Password recovery outbox ${name} must be a positive integer`);
  }
  return value;
}
