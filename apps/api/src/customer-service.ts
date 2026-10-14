import type {
  PostgresAiProposalRequestRepository,
  PostgresAssetRepository,
  PostgresContentRepository,
  ContentActorContext,
} from '@omnireach/content';
import { hasPermission } from '@omnireach/auth';
import { classifyAiReferral } from '@omnireach/integrations';
import { withTenantTransaction, type TenantTransactionPool } from '@omnireach/tenant';
import type { ReportMeasurement } from '@omnireach/ui';

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
  readonly aiProposalRequestsEnabled: boolean;

  constructor(
    private readonly pool: TenantTransactionPool,
    private readonly content: PostgresContentRepository,
    private readonly assets: PostgresAssetRepository,
    private readonly previews: CustomerPreviewAdapter,
    private readonly contactEncryptionKey: Uint8Array,
    private readonly aiProposals?: PostgresAiProposalRequestRepository,
  ) {
    if (contactEncryptionKey.byteLength !== 32) {
      throw new Error('Contact encryption key must be exactly 32 bytes');
    }
    this.aiProposalRequestsEnabled = aiProposals !== undefined;
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
      const integrations = (await client.query(
        `SELECT property_kind, status, last_synced_at
           FROM integration_connections
          WHERE tenant_id = $1 AND site_id = $2 AND provider = 'google'
          ORDER BY property_kind`,
        [principal.tenantId, principal.siteId],
      )) as { rows: { last_synced_at: Date | null; property_kind: string; status: string }[] };
      return {
        controls: {
          autonomousChangesStopped: site.autonomous_changes_stopped,
          automationStopped: site.automation_stopped,
          editingFrozen: site.editing_frozen,
        },
        integrations: {
          connections: integrations.rows.map((connection) => ({
            kind: connection.property_kind,
            lastSyncedAt: connection.last_synced_at,
            status: connection.status,
          })),
          status: integrations.rows.some((connection) => connection.status === 'connected')
            ? 'connected'
            : 'not_configured',
        },
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

  proposals(principal: CustomerPrincipal): Promise<unknown> {
    return this.content.listProposals(actorContext(principal));
  }

  requestProposal(
    principal: CustomerPrincipal,
    input: { evidence: string[]; fieldId: string; fieldPurpose: string; idempotencyKey: string },
  ): Promise<unknown> {
    if (!this.aiProposals) throw new Error('AI proposal requests are disabled');
    return this.aiProposals.request(actorContext(principal), input);
  }

  reviewProposal(
    principal: CustomerPrincipal,
    input: {
      action: 'approve' | 'reject';
      editedValue?: unknown;
      proposalId: string;
      reason: string;
    },
  ): Promise<unknown> {
    if (!hasPermission(principal.role, 'content.edit')) {
      throw new Error('Customer role cannot review proposals');
    }
    return this.content.reviewProposal(actorContext(principal), input);
  }

  reports(principal: CustomerPrincipal): Promise<unknown> {
    return withTenantTransaction(this.pool, tenantContext(principal), async (client) => {
      const now = new Date();
      const [metricRows, connections, publications, findings, jobs] = await Promise.all([
        client.query(
          `SELECT source, metric,
                  CASE WHEN metric IN ('ctr','position') THEN avg(value) ELSE sum(value) END AS value,
                  min(window_start) AS window_start, max(window_end) AS window_end,
                  max(ingested_at) AS ingested_at
             FROM metric_snapshots
            WHERE tenant_id = $1 AND site_id = $2 AND expires_at > now()
            GROUP BY source, metric ORDER BY source, metric`,
          [principal.tenantId, principal.siteId],
        ),
        client.query(
          `SELECT property_kind, status, last_synced_at, refresh_failure_code
             FROM integration_connections
            WHERE tenant_id = $1 AND site_id = $2 AND provider = 'google'
            ORDER BY property_kind`,
          [principal.tenantId, principal.siteId],
        ),
        client.query(
          `SELECT count(*)::integer AS count, max(completed_at) AS last_completed_at
             FROM publication_requests
            WHERE tenant_id = $1 AND site_id = $2 AND status = 'published'`,
          [principal.tenantId, principal.siteId],
        ),
        client.query(
          `SELECT count(*) FILTER (WHERE state <> 'resolved')::integer AS open_count,
                  count(*) FILTER (WHERE state <> 'resolved' AND rule_id LIKE 'structured-data%')::integer AS structured_count,
                  max(last_seen_at) AS last_seen_at
             FROM findings WHERE tenant_id = $1 AND site_id = $2`,
          [principal.tenantId, principal.siteId],
        ),
        client.query(
          `SELECT count(*) FILTER (WHERE state = 'completed')::integer AS completed_count,
                  count(*) FILTER (WHERE state = 'failed')::integer AS failed_count,
                  max(updated_at) AS last_updated_at
             FROM jobs WHERE tenant_id = $1 AND site_id = $2
              AND created_at > now() - interval '30 days'`,
          [principal.tenantId, principal.siteId],
        ),
      ]);
      const metricResult = metricRows as {
        rows: {
          ingested_at: Date;
          metric: string;
          source: 'ga4' | 'search_console';
          value: string;
          window_end: Date;
          window_start: Date;
        }[];
      };
      const connectionResult = connections as {
        rows: {
          last_synced_at: Date | null;
          property_kind: string;
          refresh_failure_code: string | null;
          status: string;
        }[];
      };
      const publicationResult = publications as {
        rows: { count: number; last_completed_at: Date | null }[];
      };
      const findingResult = findings as {
        rows: {
          last_seen_at: Date | null;
          open_count: number;
          structured_count: number;
        }[];
      };
      const jobResult = jobs as {
        rows: {
          completed_count: number;
          failed_count: number;
          last_updated_at: Date | null;
        }[];
      };
      const measurements: ReportMeasurement[] = [];
      for (const row of metricResult.rows) {
        measurements.push({
          caveat:
            row.source === 'ga4'
              ? 'GA4 modeled, thresholded, or consent-limited data can differ from server logs.'
              : 'Search Console data can be delayed, rounded, and omit low-volume queries.',
          freshness: reportFreshness(row.ingested_at, now),
          kind: 'traffic',
          label: `${row.source === 'ga4' ? 'GA4' : 'Search Console'} ${row.metric}`,
          source: row.source === 'ga4' ? 'Google Analytics 4' : 'Google Search Console',
          state: 'available',
          value: Number(row.value),
          windowEnd: row.window_end.toISOString(),
          windowStart: row.window_start.toISOString(),
        });
      }
      const referralRows = (await client.query(
        `SELECT dimensions->>'sessionSource' AS source, sum(value) AS sessions,
                min(window_start) AS window_start, max(window_end) AS window_end,
                max(ingested_at) AS ingested_at
           FROM metric_snapshots
          WHERE tenant_id = $1 AND site_id = $2 AND source = 'ga4' AND metric = 'sessions'
            AND expires_at > now() AND dimensions ? 'sessionSource'
          GROUP BY dimensions->>'sessionSource'`,
        [principal.tenantId, principal.siteId],
      )) as {
        rows: {
          ingested_at: Date;
          sessions: string;
          source: string;
          window_end: Date;
          window_start: Date;
        }[];
      };
      for (const row of referralRows.rows) {
        const classification = classifyAiReferral(row.source);
        if (!classification.classification) continue;
        measurements.push({
          caveat:
            'Observed GA4 referral sessions only; this is not an AI ranking or citation measurement.',
          freshness: reportFreshness(row.ingested_at, now),
          kind: 'ai_referral',
          label: `${classification.classification} referral sessions`,
          source: `GA4 sessionSource mapping v${classification.mappingVersion}`,
          state: 'available',
          value: Number(row.sessions),
          windowEnd: row.window_end.toISOString(),
          windowStart: row.window_start.toISOString(),
        });
      }
      const connectedKinds = new Set(
        connectionResult.rows
          .filter((connection) => connection.status === 'connected')
          .map((connection) => connection.property_kind),
      );
      for (const kind of ['ga4', 'search_console'] as const) {
        if (connectedKinds.has(kind)) continue;
        const connection = connectionResult.rows.find((item) => item.property_kind === kind);
        measurements.push({
          caveat: connection?.refresh_failure_code
            ? `Collection stopped safely: ${connection.refresh_failure_code}`
            : 'Connect an authorized matching property to collect data.',
          freshness: 'unknown',
          kind: 'integration',
          label: kind === 'ga4' ? 'Google Analytics 4' : 'Google Search Console',
          source: kind === 'ga4' ? 'Google Analytics 4' : 'Google Search Console',
          state: connection ? 'unavailable' : 'not_connected',
        });
      }
      const publication = publicationResult.rows[0];
      measurements.push({
        caveat: 'Counts successfully activated immutable publication requests.',
        freshness: publication?.last_completed_at ? 'current' : 'unknown',
        kind: 'publication',
        label: 'Successful publications',
        source: 'OmniReach publication history',
        state: 'available',
        value: publication?.count ?? 0,
      });
      const finding = findingResult.rows[0];
      measurements.push(
        {
          caveat: 'Deterministic audit findings are not a search-ranking guarantee.',
          freshness: reportFreshness(finding?.last_seen_at, now),
          kind: 'seo_finding',
          label: 'Open SEO findings',
          source: 'OmniReach deterministic SEO audit',
          state: 'available',
          value: finding?.open_count ?? 0,
        },
        {
          caveat: 'Open structured-data rule findings only.',
          freshness: reportFreshness(finding?.last_seen_at, now),
          kind: 'structured_data',
          label: 'Structured-data findings',
          source: 'OmniReach structured-data audit',
          state: 'available',
          value: finding?.structured_count ?? 0,
        },
      );
      const job = jobResult.rows[0];
      measurements.push({
        caveat: `Last 30 days; ${job?.failed_count ?? 0} failed jobs are reported separately to operations.`,
        freshness: reportFreshness(job?.last_updated_at, now),
        kind: 'usage',
        label: 'Completed scheduled jobs',
        source: 'OmniReach durable job ledger',
        state: 'available',
        value: job?.completed_count ?? 0,
      });
      return { generatedAt: now.toISOString(), measurements };
    });
  }

  async assetUpload(
    principal: CustomerPrincipal,
    input: { filename: string; stream: AsyncIterable<Uint8Array> },
  ): Promise<unknown> {
    const asset = await this.assets.upload(actorContext(principal), input);
    return {
      bytes: asset.bytes,
      filename: asset.filename,
      height: asset.height,
      id: asset.id,
      mime: asset.mime,
      reference: `asset:${asset.id}`,
      width: asset.width,
    };
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
    input: { draftId: string; expectedVersion: number; idempotencyKey: string; reason: string },
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

function reportFreshness(
  value: Date | null | undefined,
  now: Date,
): ReportMeasurement['freshness'] {
  if (!value) return 'unknown';
  const age = now.getTime() - value.getTime();
  if (age <= 36 * 60 * 60_000) return 'current';
  if (age <= 7 * 24 * 60 * 60_000) return 'delayed';
  return 'stale';
}
