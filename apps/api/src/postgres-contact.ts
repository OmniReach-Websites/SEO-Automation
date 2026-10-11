import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { contractHash, type SiteContract } from '@omnireach/contracts';
import { validateContactSubmission, type ContactDeliveryAdapter } from '@omnireach/content';
import type { TurnstileVerifier } from '@omnireach/integrations';
import {
  withWorkerTransaction,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';

import type { ContactEndpointService, ContactSiteContext } from './contact-routes.ts';

export class PostgresContactService implements ContactEndpointService {
  constructor(
    private readonly pool: TenantTransactionPool,
    private readonly delivery: ContactDeliveryAdapter,
    private readonly options: {
      contracts: ReadonlyMap<string, SiteContract>;
      encryptionKey: Uint8Array;
      retentionDays?: number;
      turnstile: TurnstileVerifier;
      turnstileSiteKey?: string;
    },
  ) {
    if (options.encryptionKey.byteLength !== 32) {
      throw new Error('Contact encryption key must be exactly 32 bytes');
    }
  }

  async publicConfig(
    context: ContactSiteContext,
    formId: string,
  ): Promise<{ enabled: boolean; turnstileSiteKey?: string }> {
    const turnstileSiteKey = this.options.turnstileSiteKey;
    if (!turnstileSiteKey) return { enabled: false };
    const jobId = `contact-config:${context.siteId}:${formId}`;
    return withWorkerTransaction(
      this.pool,
      { jobId, siteId: context.siteId, tenantId: context.tenantId },
      async (client) => {
        const row = (
          await query<{ enabled: boolean; recipient_verified_at: Date | null }>(
            client,
            `SELECT enabled, recipient_verified_at
               FROM site_contact_forms
              WHERE tenant_id = $1 AND site_id = $2 AND form_id = $3`,
            [context.tenantId, context.siteId, formId],
          )
        ).rows[0];
        if (!row?.enabled || !row.recipient_verified_at) return { enabled: false };
        return { enabled: true, turnstileSiteKey };
      },
    );
  }

  async submit(
    context: ContactSiteContext,
    input: {
      fields: Record<string, string | boolean>;
      formId: string;
      origin: string;
      remoteIp: string;
      turnstileToken: string;
      website?: string;
    },
  ): Promise<{ submissionId: string }> {
    const expectedHostname = new URL(context.allowedOrigin).hostname;
    if (
      !(await this.options.turnstile.verify({
        expectedHostname,
        remoteIp: input.remoteIp,
        token: input.turnstileToken,
      }))
    ) {
      throw new Error('Contact spam challenge was rejected');
    }
    const jobId = `contact:${context.siteId}:${randomBytes(12).toString('hex')}`;
    const prepared = await withWorkerTransaction(
      this.pool,
      { jobId, siteId: context.siteId, tenantId: context.tenantId },
      async (client) => {
        const site = (
          await query<{ contract_hash: string; source_path: string }>(
            client,
            `SELECT source_path, contract_hash FROM sites
              WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
            [context.tenantId, context.siteId],
          )
        ).rows[0];
        const contract = site?.source_path
          ? this.options.contracts.get(site.source_path)
          : undefined;
        if (!site || !contract || site.contract_hash !== contractHash(contract)) {
          throw new Error('Contact contract is unavailable');
        }
        const form = contract.contactForms.find(({ id }) => id === input.formId);
        if (!form) throw new Error('Contact form is not declared by the site contract');
        const settings = (
          await query<{
            enabled: boolean;
            enabled_field_ids: unknown;
            confirmation_enabled: boolean;
            recipient_email: string | null;
            recipient_verified_at: Date | null;
            retention_days: number;
          }>(
            client,
            `SELECT enabled, enabled_field_ids, confirmation_enabled, recipient_email, recipient_verified_at,
                    retention_days
               FROM site_contact_forms
              WHERE tenant_id = $1 AND site_id = $2 AND form_id = $3`,
            [context.tenantId, context.siteId, form.id],
          )
        ).rows[0];
        if (!settings?.enabled || !settings.recipient_email || !settings.recipient_verified_at) {
          throw new Error('Contact form is disabled or its recipient is unverified');
        }
        const enabledFieldIds = stringArray(settings.enabled_field_ids);
        const declaredFieldIds = new Set(form.fields.map(({ id }) => id));
        const requiredFieldIds = form.fields.filter(({ required }) => required).map(({ id }) => id);
        if (
          enabledFieldIds.some((id) => !declaredFieldIds.has(id)) ||
          requiredFieldIds.some((id) => !enabledFieldIds.includes(id))
        ) {
          throw new Error('Contact form field configuration is invalid');
        }
        const submission = validateContactSubmission({
          allowedOrigin: context.allowedOrigin,
          body: { formId: input.formId, ...input.fields },
          confirmationEnabled: settings.confirmation_enabled,
          enabledFieldIds,
          expectedFormId: form.id,
          fields: form.fields,
          ...(input.website === undefined ? {} : { honeypot: input.website }),
          origin: input.origin,
          recipientEmail: settings.recipient_email,
          siteId: context.siteId,
        });
        const encrypted = encryptPayload(
          this.options.encryptionKey,
          `${context.tenantId}:${context.siteId}:${form.id}`,
          submission,
        );
        const retentionDays = this.options.retentionDays ?? settings.retention_days;
        const inserted = await query<{ id: string }>(
          client,
          `INSERT INTO contact_submissions
             (tenant_id, site_id, form_id, encrypted_payload, key_version,
              consent_at, delivery_state, expires_at)
           VALUES ($1, $2, $3, $4, 1, now(), 'pending', now() + ($5 * interval '1 day'))
           RETURNING id`,
          [context.tenantId, context.siteId, form.id, encrypted, retentionDays],
        );
        const submissionId = inserted.rows[0]?.id;
        if (!submissionId) throw new Error('Contact submission could not be recorded');
        return { submission, submissionId };
      },
    );

    try {
      const delivered = await this.delivery.deliver(prepared.submission);
      await this.recordDelivery(context, jobId, prepared.submissionId, {
        ...(delivered.confirmationFailed ? { errorCode: 'confirmation_delivery_failed' } : {}),
        providerReference: delivered.providerReference,
        state: 'delivered',
      });
    } catch (error) {
      await this.recordDelivery(context, jobId, prepared.submissionId, { state: 'failed' });
      throw error;
    }
    return { submissionId: prepared.submissionId };
  }

  async purgeExpired(
    context: { siteId: string; tenantId: string },
    now = new Date(),
  ): Promise<{ deleted: number }> {
    const jobId = `contact-retention:${context.siteId}:${now.toISOString()}`;
    return withWorkerTransaction(
      this.pool,
      { jobId, siteId: context.siteId, tenantId: context.tenantId },
      async (client) => {
        const removed = await query<{ id: string }>(
          client,
          `DELETE FROM contact_submissions
            WHERE tenant_id = $1 AND site_id = $2 AND expires_at <= $3
              AND NOT legal_hold
            RETURNING id`,
          [context.tenantId, context.siteId, now],
        );
        if (removed.rows.length > 0) {
          await client.query(
            `INSERT INTO audit_events
               (tenant_id, site_id, action, trace_id, target_type, target_id, metadata)
             VALUES ($1, $2, 'contact.retention_deleted', $3,
                     'contact_submission_batch', $4, $5::jsonb)`,
            [
              context.tenantId,
              context.siteId,
              jobId,
              `${context.siteId}:${now.toISOString()}`,
              JSON.stringify({ count: removed.rows.length, cutoff: now.toISOString() }),
            ],
          );
        }
        return { deleted: removed.rows.length };
      },
    );
  }

  private async recordDelivery(
    context: ContactSiteContext,
    jobId: string,
    submissionId: string,
    outcome: {
      errorCode?: 'confirmation_delivery_failed';
      providerReference?: string;
      state: 'delivered' | 'failed';
    },
  ): Promise<void> {
    await withWorkerTransaction(
      this.pool,
      { jobId, siteId: context.siteId, tenantId: context.tenantId },
      async (client) => {
        await client.query(
          `UPDATE contact_submissions
              SET delivery_state = $4, attempts = attempts + 1,
                  provider_reference = $5,
                  last_error_code = CASE
                    WHEN $4 = 'failed' THEN 'delivery_failed'
                    ELSE $6
                  END
            WHERE tenant_id = $1 AND site_id = $2 AND id = $3`,
          [
            context.tenantId,
            context.siteId,
            submissionId,
            outcome.state,
            outcome.providerReference ?? null,
            outcome.errorCode ?? null,
          ],
        );
        await client.query(
          `INSERT INTO audit_events
             (tenant_id, site_id, action, trace_id, target_type, target_id, metadata)
           VALUES ($1, $2, $3, $4, 'contact_submission', $5, $6::jsonb)`,
          [
            context.tenantId,
            context.siteId,
            `contact.${outcome.state}`,
            jobId,
            submissionId,
            JSON.stringify({
              deliveryState: outcome.state,
              ...(outcome.errorCode ? { warning: outcome.errorCode } : {}),
            }),
          ],
        );
      },
    );
  }
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return [];
  return value;
}

export function decodeContactEncryptionKey(value: string): Uint8Array {
  if (!/^[a-f0-9]{64}$/iu.test(value)) {
    throw new Error('CONTACT_ENCRYPTION_KEY must be 64 hexadecimal characters');
  }
  return new Uint8Array(Buffer.from(value, 'hex'));
}

export function decryptContactPayload(
  key: Uint8Array,
  associatedData: string,
  encrypted: Uint8Array,
): unknown {
  if (key.byteLength !== 32 || encrypted.byteLength < 29) {
    throw new Error('Contact payload cannot be decrypted');
  }
  const bytes = Buffer.from(encrypted);
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as unknown;
}

function encryptPayload(key: Uint8Array, associatedData: string, payload: unknown): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

async function query<T extends Record<string, unknown>>(
  client: TenantTransactionClient,
  text: string,
  values: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}
