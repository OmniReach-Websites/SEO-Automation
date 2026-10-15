export type EmailDeliveryChannel = 'alert' | 'authentication' | 'contact' | 'platform_inquiry';

export interface EmailDeliveryReservation {
  readonly id: string;
}

export interface EmailDeliveryQuotaClient {
  query<T extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
  release(): void;
}

export interface EmailDeliveryQuotaPool {
  connect(): Promise<EmailDeliveryQuotaClient>;
}

export interface EmailProviderUsageSnapshot {
  readonly daily: { readonly limit: number; readonly resetsAt: string; readonly used: number };
  readonly monthly: { readonly limit: number; readonly resetsAt: string; readonly used: number };
}

export interface EmailProviderUsageReader {
  read(): Promise<EmailProviderUsageSnapshot>;
}

export class EmailDeliveryQuotaExceededError extends Error {
  override readonly name = 'EmailDeliveryQuotaExceededError';
}

export class PostgresEmailDeliveryQuota {
  constructor(
    private readonly pool: EmailDeliveryQuotaPool,
    private readonly role: 'omnireach_app' | 'omnireach_worker' = 'omnireach_app',
    private readonly providerUsage?: EmailProviderUsageReader,
  ) {}

  async reserve(channel: EmailDeliveryChannel): Promise<EmailDeliveryReservation> {
    if (!this.providerUsage) {
      throw new Error('Account-wide email usage guard is not configured');
    }
    const usage = await this.providerUsage.read();
    try {
      const result = await this.transaction((client) =>
        client.query<{ id: string }>(
          `SELECT reserve_email_delivery(
                    $1::varchar(30), now() + interval '15 minutes',
                    $2::integer, $3::integer, $4::integer, $5::integer
                  ) AS id`,
          [channel, usage.daily.used, usage.daily.limit, usage.monthly.used, usage.monthly.limit],
        ),
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error('Email delivery reservation failed');
      return { id };
    } catch (error) {
      if (error instanceof Error && error.message.includes('email daily quota exhausted')) {
        throw new EmailDeliveryQuotaExceededError('Email daily quota exhausted');
      }
      if (error instanceof Error && error.message.includes('email monthly quota exhausted')) {
        throw new EmailDeliveryQuotaExceededError('Email monthly quota exhausted');
      }
      throw error;
    }
  }

  async finalize(
    reservation: EmailDeliveryReservation,
    outcome:
      | { readonly providerReference: string; readonly state: 'sent' }
      | {
          readonly errorCode:
            | 'network_failure'
            | 'provider_4xx'
            | 'provider_429'
            | 'provider_5xx'
            | 'provider_invalid_response'
            | 'reservation_released';
          readonly state: 'failed' | 'released';
        },
  ): Promise<void> {
    const result = await this.transaction((client) =>
      client.query<{ finalized: boolean }>(
        `SELECT finalize_email_delivery($1::uuid, $2::varchar(20), $3::varchar(200),
                                        $4::varchar(100)) AS finalized`,
        [
          reservation.id,
          outcome.state,
          outcome.state === 'sent' ? outcome.providerReference : null,
          outcome.state === 'sent' ? null : outcome.errorCode,
        ],
      ),
    );
    if (result.rows[0]?.finalized !== true) {
      throw new Error('Email delivery reservation was already finalized');
    }
  }

  private async transaction<T>(
    operation: (client: EmailDeliveryQuotaClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${this.role}`);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
