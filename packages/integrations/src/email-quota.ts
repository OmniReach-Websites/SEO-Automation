export type EmailDeliveryChannel = 'alert' | 'authentication' | 'contact' | 'platform_inquiry';

export interface EmailDeliveryQuota {
  finalize(
    reservation: { readonly id: string },
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
  ): Promise<void>;
  reserve(channel: EmailDeliveryChannel): Promise<{ readonly id: string }>;
}

export type EmailDeliveryFailureCode =
  | 'network_failure'
  | 'provider_4xx'
  | 'provider_429'
  | 'provider_5xx'
  | 'provider_invalid_response';

export class EmailProviderError extends Error {
  override readonly name = 'EmailProviderError';

  constructor(
    message: string,
    readonly safeCode: EmailDeliveryFailureCode,
  ) {
    super(message);
  }
}

export async function withEmailDeliveryQuota<T extends { readonly providerReference: string }>(
  quota: EmailDeliveryQuota | undefined,
  channel: EmailDeliveryChannel,
  operation: (idempotencyKey?: string) => Promise<T>,
): Promise<T> {
  if (!quota) return operation();
  const reservation = await quota.reserve(channel);
  try {
    const result = await operation(reservation.id);
    await quota.finalize(reservation, {
      providerReference: result.providerReference,
      state: 'sent',
    });
    return result;
  } catch (error) {
    const safeCode =
      error instanceof EmailProviderError ? error.safeCode : 'provider_invalid_response';
    await quota
      .finalize(reservation, { errorCode: safeCode, state: 'failed' })
      .catch(() => undefined);
    throw error;
  }
}

export function providerFailureCode(status: number): EmailDeliveryFailureCode {
  if (status === 429) return 'provider_429';
  if (status >= 500) return 'provider_5xx';
  return 'provider_4xx';
}
