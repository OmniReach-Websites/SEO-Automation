import type { PlatformInquiryMessage } from '@omnireach/integrations';
import type { TurnstileVerifier } from '@omnireach/integrations';
import {
  withAuthTransaction,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';

import type { PlatformInquiryEndpointService } from './platform-inquiry-routes.ts';

export interface PlatformInquiryDelivery {
  deliver(message: PlatformInquiryMessage): Promise<{ providerReference: string }>;
}

export class PostgresPlatformInquiryService implements PlatformInquiryEndpointService {
  constructor(
    private readonly pool: TenantTransactionPool,
    private readonly delivery: PlatformInquiryDelivery,
    private readonly options: {
      allowedOrigin?: string;
      deliveryEnabled?: boolean;
      turnstile: TurnstileVerifier;
      turnstileSiteKey?: string;
    },
  ) {}

  async publicConfig(): Promise<{ enabled: boolean; turnstileSiteKey?: string }> {
    if (!(this.options.deliveryEnabled ?? true)) return { enabled: false };
    return this.options.turnstileSiteKey
      ? { enabled: true, turnstileSiteKey: this.options.turnstileSiteKey }
      : { enabled: true };
  }

  async submit(input: {
    businessName?: string;
    email: string;
    message: string;
    name: string;
    origin: string;
    phone?: string;
    remoteIp: string;
    turnstileToken: string;
    website?: string;
  }): Promise<void> {
    const allowedOrigin = this.options.allowedOrigin ?? 'https://omnireach.cloud';
    if (
      !(this.options.deliveryEnabled ?? true) ||
      input.origin !== allowedOrigin ||
      input.website
    ) {
      throw new Error('Platform inquiry rejected');
    }
    if (
      this.options.turnstileSiteKey &&
      !(await this.options.turnstile.verify({
        expectedHostname: new URL(allowedOrigin).hostname,
        remoteIp: input.remoteIp,
        token: input.turnstileToken,
      }))
    ) {
      throw new Error('Platform inquiry spam challenge was rejected');
    }

    const recipients = await withAuthTransaction(this.pool, async (client) => {
      const result = await query<{ normalized_email: string }>(
        client,
        `SELECT DISTINCT u.normalized_email
           FROM users u
           JOIN platform_memberships membership ON membership.user_id = u.id
          WHERE u.status = 'active'
            AND membership.active
            AND membership.role = 'platform_owner'
          ORDER BY u.normalized_email`,
        [],
      );
      return result.rows.map(({ normalized_email }) => normalized_email);
    });
    if (recipients.length === 0) throw new Error('No active platform owner recipients exist');

    await this.delivery.deliver({
      email: input.email,
      message: input.message,
      name: input.name,
      recipients,
      ...(input.businessName ? { businessName: input.businessName } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
    });
  }
}

async function query<T>(
  client: TenantTransactionClient,
  text: string,
  values: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}
