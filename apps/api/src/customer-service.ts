import type {
  PostgresAssetRepository,
  PostgresContentRepository,
  ContentActorContext,
} from '@omnireach/content';
import { hasPermission } from '@omnireach/auth';
import { withTenantTransaction, type TenantTransactionPool } from '@omnireach/tenant';

import type { CustomerEndpointService, CustomerPrincipal } from './customer-routes.ts';
import { decryptContactPayload } from './postgres-contact.ts';

export interface CustomerPreviewAdapter {
  create(
    context: { siteId: string; tenantId: string; userId: string },
    draftId: string,
  ): Promise<{ previewToken: string }>;
  read(
    context: { siteId: string; tenantId: string; userId: string },
    input: { path: string; token: string },
  ): Promise<{ body: Uint8Array; contentType: string }>;
}

export class PostgresCustomerService implements CustomerEndpointService {
  constructor(
    private readonly pool: TenantTransactionPool,
    private readonly content: PostgresContentRepository,
    private readonly assets: PostgresAssetRepository,
    private readonly previews: CustomerPreviewAdapter,
    private readonly contactEncryptionKey: Uint8Array,
  ) {
    if (contactEncryptionKey.byteLength !== 32) {
      throw new Error('Contact encryption key must be exactly 32 bytes');
    }
  }

  async dashboard(principal: CustomerPrincipal): Promise<unknown> {
    return withTenantTransaction(this.pool, tenantContext(principal), async (client) => {
      const result = (await client.query(
        `SELECT s.id, s.name, s.status,
                sub.status AS subscription_status, sub.grace_ends_at,
                COALESCE(e.editing_frozen, false) AS editing_frozen,
                COALESCE(e.automation_stopped, false) AS automation_stopped,
                COALESCE(e.autonomous_changes_stopped, false) AS autonomous_changes_stopped,
                b.artifact_hash, b.content_revision
           FROM sites s
           LEFT JOIN subscriptions sub ON sub.tenant_id = s.tenant_id AND sub.site_id = s.id
           LEFT JOIN site_emergency_controls e ON e.tenant_id = s.tenant_id AND e.site_id = s.id
           LEFT JOIN active_artifacts a ON a.tenant_id = s.tenant_id AND a.site_id = s.id
           LEFT JOIN build_artifacts b
             ON b.tenant_id = a.tenant_id AND b.site_id = a.site_id AND b.id = a.artifact_id
          WHERE s.tenant_id = $1 AND s.id = $2`,
        [principal.tenantId, principal.siteId],
      )) as {
        rows: {
          artifact_hash: string | null;
          autonomous_changes_stopped: boolean;
          automation_stopped: boolean;
          content_revision: number | null;
          editing_frozen: boolean;
          grace_ends_at: Date | null;
          id: string;
          name: string;
          status: string;
          subscription_status: string | null;
        }[];
      };
      const site = result.rows[0];
      if (!site) throw new Error('Site was not found');
      return {
        controls: {
          autonomousChangesStopped: site.autonomous_changes_stopped,
          automationStopped: site.automation_stopped,
          editingFrozen: site.editing_frozen,
        },
        integrations: { status: 'not_configured' },
        publication: site.artifact_hash
          ? {
              artifactHash: site.artifact_hash,
              contentRevision: site.content_revision,
              status: 'active',
            }
          : { status: 'not_published' },
        site: { id: site.id, name: site.name, status: site.status },
        subscription: site.subscription_status
          ? {
              graceEndsAt: site.grace_ends_at,
              status: site.subscription_status,
            }
          : { status: 'not_configured' },
      };
    });
  }

  createDraft(principal: CustomerPrincipal): Promise<unknown> {
    return this.content.createDraft(actorContext(principal));
  }

  drafts(principal: CustomerPrincipal): Promise<unknown> {
    return this.content.listDrafts(actorContext(principal));
  }

  contactForms(principal: CustomerPrincipal): Promise<unknown> {
    return withTenantTransaction(this.pool, tenantContext(principal), async (client) => {
      const result = (await client.query(
        `SELECT form_id, enabled, declared_field_ids, enabled_field_ids,
                required_field_ids, confirmation_enabled,
                recipient_verified_at IS NOT NULL AS recipient_verified,
                retention_days, updated_at
           FROM site_contact_forms
          WHERE tenant_id = $1 AND site_id = $2
          ORDER BY form_id`,
        [principal.tenantId, principal.siteId],
      )) as { rows: Record<string, unknown>[] };
      return result.rows;
    });
  }

  updateContactForm(
    principal: CustomerPrincipal,
    input: {
      confirmationEnabled: boolean;
      fieldIds: string[];
      formId: string;
      reason: string;
    },
  ): Promise<unknown> {
    if (!hasPermission(principal.role, 'content.edit')) {
      throw new Error('Customer role cannot configure contact forms');
    }
    return withTenantTransaction(this.pool, tenantContext(principal), async (client) => {
      const current = (
        (await client.query(
          `SELECT declared_field_ids, required_field_ids, enabled_field_ids,
                  confirmation_enabled
             FROM site_contact_forms
            WHERE tenant_id = $1 AND site_id = $2 AND form_id = $3
            FOR UPDATE`,
          [principal.tenantId, principal.siteId, input.formId],
        )) as { rows: Record<string, unknown>[] }
      ).rows[0];
      if (!current) throw new Error('Contact form is not configured');
      const declared = stringArray(current.declared_field_ids);
      const required = stringArray(current.required_field_ids);
      const fieldIds = [...new Set(input.fieldIds)];
      if (
        fieldIds.some((id) => !declared.includes(id)) ||
        required.some((id) => !fieldIds.includes(id))
      ) {
        throw new Error('Contact form fields must be declared and include required fields');
      }
      const result = (await client.query(
        `UPDATE site_contact_forms
            SET enabled_field_ids = $4::jsonb, confirmation_enabled = $5,
                reason = $6, actor_id = $7, policy_version = policy_version + 1,
                updated_at = now()
          WHERE tenant_id = $1 AND site_id = $2 AND form_id = $3
          RETURNING form_id, enabled, enabled_field_ids, confirmation_enabled,
                    recipient_verified_at IS NOT NULL AS recipient_verified,
                    retention_days, updated_at`,
        [
          principal.tenantId,
          principal.siteId,
          input.formId,
          JSON.stringify(fieldIds),
          input.confirmationEnabled,
          input.reason,
          principal.userId,
        ],
      )) as { rows: Record<string, unknown>[] };
      const after = result.rows[0];
      if (!after) throw new Error('Contact form configuration failed');
      await client.query(
        `INSERT INTO audit_events
           (tenant_id, site_id, actor_id, action, reason, trace_id,
            target_type, target_id, before, after)
         VALUES ($1, $2, $3, 'customer.contact_form_changed', $4, $5,
                 'site_contact_form', $6, $7::jsonb, $8::jsonb)`,
        [
          principal.tenantId,
          principal.siteId,
          principal.userId,
          input.reason,
          principal.traceId,
          `${principal.siteId}:${input.formId}`,
          JSON.stringify(current),
          JSON.stringify(after),
        ],
      );
      return after;
    });
  }

  contactSubmissions(principal: CustomerPrincipal): Promise<unknown> {
    return withTenantTransaction(this.pool, tenantContext(principal), async (client) => {
      const result = (await client.query(
        `SELECT id, form_id, encrypted_payload, key_version, consent_at,
                delivery_state, attempts, created_at, expires_at, legal_hold
           FROM contact_submissions
          WHERE tenant_id = $1 AND site_id = $2
            AND (expires_at > now() OR legal_hold)
          ORDER BY created_at DESC
          LIMIT 100`,
        [principal.tenantId, principal.siteId],
      )) as {
        rows: {
          attempts: number;
          consent_at: Date;
          created_at: Date;
          delivery_state: string;
          encrypted_payload: Uint8Array;
          expires_at: Date;
          form_id: string;
          id: string;
          key_version: number;
          legal_hold: boolean;
        }[];
      };
      return result.rows.map((row) => {
        if (row.key_version !== 1) throw new Error('Unsupported contact encryption key version');
        const payload = decryptContactPayload(
          this.contactEncryptionKey,
          `${principal.tenantId}:${principal.siteId}:${row.form_id}`,
          row.encrypted_payload,
        ) as Record<string, unknown>;
        const safePayload = { ...payload };
        delete safePayload.recipientEmail;
        return {
          attempts: row.attempts,
          consentAt: row.consent_at,
          createdAt: row.created_at,
          deliveryState: row.delivery_state,
          expiresAt: row.expires_at,
          formId: row.form_id,
          id: row.id,
          legalHold: row.legal_hold,
          submission: safePayload,
        };
      });
    });
  }

  pages(principal: CustomerPrincipal): Promise<unknown> {
    return this.content.listPages(actorContext(principal));
  }

  fieldUpdate(
    principal: CustomerPrincipal,
    input: { draftId: string; expectedVersion: number; fieldId: string; value: unknown },
  ): Promise<unknown> {
    return this.content.updateDraftField(actorContext(principal), input);
  }

  draftUpdate(
    principal: CustomerPrincipal,
    input: { draftId: string; expectedVersion: number; patch: Record<string, unknown> },
  ): Promise<unknown> {
    return this.content.updateDraftFields(actorContext(principal), input);
  }

  history(principal: CustomerPrincipal): Promise<unknown> {
    return this.content.listHistory(actorContext(principal));
  }

  assetUpload(
    principal: CustomerPrincipal,
    input: { filename: string; stream: AsyncIterable<Uint8Array> },
  ): Promise<unknown> {
    return this.assets.upload(actorContext(principal), input);
  }

  assetDownload(
    principal: CustomerPrincipal,
    input: { assetId: string },
  ): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> {
    return this.assets.download(actorContext(principal), input.assetId);
  }

  preview(
    principal: CustomerPrincipal,
    input: { draftId: string },
  ): Promise<{ previewToken: string }> {
    return this.previews.create(tenantContext(principal), input.draftId);
  }

  previewFile(
    principal: CustomerPrincipal,
    input: { path: string; token: string },
  ): Promise<{ body: Uint8Array; contentType: string }> {
    return this.previews.read(tenantContext(principal), input);
  }

  publish(
    principal: CustomerPrincipal,
    input: { draftId: string; idempotencyKey: string; reason: string },
  ): Promise<unknown> {
    return this.content.prepareDraftPublication(actorContext(principal), input);
  }

  restore(
    principal: CustomerPrincipal,
    input: { idempotencyKey: string; reason: string; revision: number },
  ): Promise<unknown> {
    return this.content.prepareRestorePublication(actorContext(principal), input);
  }
}

function actorContext(principal: CustomerPrincipal): ContentActorContext {
  return {
    role: principal.role,
    siteId: principal.siteId,
    tenantId: principal.tenantId,
    traceId: principal.traceId,
    userId: principal.userId,
  };
}

function tenantContext(principal: CustomerPrincipal) {
  return {
    siteId: principal.siteId,
    tenantId: principal.tenantId,
    userId: principal.userId,
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return [];
  return value;
}
