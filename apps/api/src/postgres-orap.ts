import { randomUUID } from 'node:crypto';

import { createOneTimeToken, normalizeEmail } from '@omnireach/auth';
import {
  assertPlanFeatureAllowed,
  defaultGraceEndsAt,
  withPlatformTransaction,
  type AdminActor,
  type CustomerRole,
  type TenantTransactionClient,
  type TenantTransactionPool,
} from '@omnireach/tenant';

import type { OrapAdministrationEndpointService, PlanEntitlementsInput } from './orap-routes.ts';

export interface InvitationNotifier {
  send(input: { host: string; normalizedEmail: string; token: string }): Promise<void>;
}

export class PostgresOrapService implements OrapAdministrationEndpointService {
  constructor(
    private readonly pool: TenantTransactionPool,
    private readonly invitations: InvitationNotifier,
    private readonly requestRecovery: (input: {
      host: string;
      networkIdentifier: string;
      normalizedEmail: string;
      traceId: string;
    }) => Promise<void>,
    private readonly siteContracts: ReadonlyMap<
      string,
      {
        businessLocationCount?: number;
        contactForms?: readonly {
          fieldIds: readonly string[];
          id: string;
          requiredFieldIds: readonly string[];
        }[];
        contractHash: string;
        contractVersion: string;
        standardPageCount?: number;
      }
    > = new Map(),
  ) {}

  createPlan(
    actor: AdminActor,
    input: {
      code: string;
      entitlements: PlanEntitlementsInput;
      features: { enabled: boolean; key: string; version: number }[];
      name: string;
      reason: string;
      version: number;
    },
  ): Promise<unknown> {
    for (const feature of input.features) assertPlanFeatureAllowed(feature.key);
    return this.transaction(actor, async (client) => {
      for (const requested of input.features) {
        const feature = required(
          (
            await query<{ key: string; readiness: 'deployable' | 'planned' | 'tested' }>(
              client,
              `SELECT key, readiness FROM feature_definitions
                WHERE key = $1 AND version = $2`,
              [requested.key, requested.version],
            )
          ).rows[0],
          `Feature definition was not found: ${requested.key}@${requested.version}`,
        );
        if (
          input.entitlements.commercialStatus === 'approved' &&
          requested.enabled &&
          feature.readiness !== 'deployable'
        ) {
          throw new Error(`Approved plans cannot enable a nondeployable feature: ${feature.key}`);
        }
      }
      const plan = required(
        (
          await query<{ code: string; id: string; name: string; version: number }>(
            client,
            `INSERT INTO plans
               (code, name, version, monthly_price_cents, currency, commercial_status,
                customer_seat_limit, standard_page_limit, business_location_limit,
                seo_audit_interval_hours, ai_review_cycles_per_month,
                pending_invitations_count_as_seats)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id, code, name, version`,
            [
              input.code,
              input.name.trim(),
              input.version,
              input.entitlements.monthlyPriceCents,
              input.entitlements.currency,
              input.entitlements.commercialStatus,
              input.entitlements.customerSeatLimit,
              input.entitlements.standardPageLimit,
              input.entitlements.businessLocationLimit,
              input.entitlements.seoAuditIntervalHours,
              input.entitlements.aiReviewCyclesPerMonth,
              input.entitlements.pendingInvitationsCountAsSeats,
            ],
          )
        ).rows[0],
        'Plan creation failed',
      );
      for (const feature of input.features) {
        await client.query(
          `INSERT INTO plan_features (plan_id, feature_key, feature_version, enabled)
           VALUES ($1, $2, $3, $4)`,
          [plan.id, feature.key, feature.version, feature.enabled],
        );
      }
      await audit(client, actor, {
        action: 'plan.created',
        after: { ...plan, entitlements: input.entitlements, features: input.features },
        before: null,
        reason: input.reason,
        targetId: plan.id,
        targetType: 'plan',
      });
      return { ...plan, entitlements: input.entitlements, features: input.features };
    });
  }

  assignPlan(
    actor: AdminActor,
    input: { planId: string; reason: string; siteId: string; tenantId: string },
  ): Promise<unknown> {
    return this.transaction(actor, async (client) => {
      await assertSite(client, input.tenantId, input.siteId);
      const plan = await query<{
        business_location_limit: number;
        id: string;
        standard_page_limit: number;
      }>(
        client,
        `SELECT id, standard_page_limit, business_location_limit
           FROM plans WHERE id = $1 AND active`,
        [input.planId],
      );
      const selectedPlan = required(plan.rows[0], 'Active plan was not found');
      const siteScope = required(
        (
          await query<{ business_location_count: number; standard_page_count: number }>(
            client,
            `SELECT standard_page_count, business_location_count FROM sites
              WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
            [input.tenantId, input.siteId],
          )
        ).rows[0],
        'Site was not found',
      );
      if (siteScope.standard_page_count > selectedPlan.standard_page_limit) {
        throw new Error('Site standard-page count exceeds plan entitlement');
      }
      if (siteScope.business_location_count > selectedPlan.business_location_limit) {
        throw new Error('Site business-location count exceeds plan entitlement');
      }
      const before =
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT * FROM subscriptions WHERE tenant_id = $1 AND site_id = $2 FOR UPDATE`,
            [input.tenantId, input.siteId],
          )
        ).rows[0] ?? null;
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `INSERT INTO subscriptions (tenant_id, site_id, plan_id, status)
             VALUES ($1, $2, $3, 'active')
             ON CONFLICT (site_id) DO UPDATE
               SET plan_id = EXCLUDED.plan_id, status = 'active', grace_ends_at = NULL,
                   updated_at = now()
             RETURNING *`,
            [input.tenantId, input.siteId, input.planId],
          )
        ).rows[0],
        'Plan assignment failed',
      );
      await audit(client, actor, {
        action: 'site.plan_assigned',
        after,
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: String(after.id),
        targetType: 'subscription',
        tenantId: input.tenantId,
      });
      return after;
    });
  }

  listSites(actor: AdminActor): Promise<unknown> {
    return this.transaction(actor, async (client) => {
      const result = await query<{
        id: string;
        name: string;
        status: string;
        tenant_id: string;
        tenant_name: string;
      }>(
        client,
        `SELECT s.id, s.tenant_id, s.name, s.status, t.name AS tenant_name
           FROM sites s JOIN tenants t ON t.id = s.tenant_id
          ORDER BY t.name, s.name`,
        [],
      );
      return result.rows.map((site) => ({
        id: site.id,
        name: site.name,
        status: site.status,
        tenantId: site.tenant_id,
        tenantName: site.tenant_name,
      }));
    });
  }

  createTenantAndSite(
    actor: AdminActor,
    input: { reason: string; siteName: string; sourcePath: string; tenantName: string },
  ): Promise<unknown> {
    const contract = this.siteContracts.get(input.sourcePath);
    if (!contract) throw new Error('Site source package is not registered');
    return this.transaction(actor, async (client) => {
      const tenant = required(
        (
          await query<{ id: string; name: string; status: string }>(
            client,
            `INSERT INTO tenants (name) VALUES ($1) RETURNING id, name, status`,
            [input.tenantName.trim()],
          )
        ).rows[0],
        'Tenant creation failed',
      );
      const site = required(
        (
          await query<{ id: string; name: string; status: string; tenant_id: string }>(
            client,
            `INSERT INTO sites
               (tenant_id, name, source_path, contract_version, contract_hash,
                standard_page_count, business_location_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, tenant_id, name, status`,
            [
              tenant.id,
              input.siteName.trim(),
              input.sourcePath,
              contract.contractVersion,
              contract.contractHash,
              contract.standardPageCount ?? 1,
              contract.businessLocationCount ?? 1,
            ],
          )
        ).rows[0],
        'Site creation failed',
      );
      await audit(client, actor, {
        action: 'site.created',
        after: { site, tenant },
        before: null,
        reason: input.reason,
        siteId: site.id,
        targetId: site.id,
        targetType: 'site',
        tenantId: tenant.id,
      });
      return { site, tenant };
    });
  }

  async inviteCustomer(
    actor: AdminActor,
    input: {
      email: string;
      reason: string;
      role: CustomerRole;
      siteId: string;
      tenantId: string;
    },
  ): Promise<unknown> {
    const normalizedEmail = normalizeEmail(input.email);
    const token = createOneTimeToken();
    const invitation = await this.transaction(actor, async (client) => {
      await assertSite(client, input.tenantId, input.siteId);
      const adminDomains = await query<{ hostname: string }>(
        client,
        `SELECT hostname FROM domains
          WHERE tenant_id = $1 AND site_id = $2 AND kind = 'admin'
            AND active AND verification_status = 'verified'
          LIMIT 2`,
        [input.tenantId, input.siteId],
      );
      if (adminDomains.rows.length !== 1 || !adminDomains.rows[0]) {
        throw new Error('Exactly one verified customer admin domain is required');
      }
      await client.query(
        `UPDATE customer_invitations SET revoked_at = now()
          WHERE tenant_id = $1 AND site_id = $2 AND normalized_email = $3
            AND accepted_at IS NULL AND revoked_at IS NULL`,
        [input.tenantId, input.siteId, normalizedEmail],
      );
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [input.siteId]);
      const seats = required(
        (
          await query<{
            customer_seat_limit: number;
            occupied: number;
          }>(
            client,
            `SELECT p.customer_seat_limit,
                    ((SELECT count(*) FROM memberships m
                       WHERE m.tenant_id = $1 AND m.site_id = $2 AND m.active) +
                     CASE WHEN p.pending_invitations_count_as_seats THEN
                       (SELECT count(*) FROM customer_invitations i
                         WHERE i.tenant_id = $1 AND i.site_id = $2
                           AND i.accepted_at IS NULL AND i.revoked_at IS NULL
                           AND i.expires_at > now())
                     ELSE 0 END)::integer AS occupied
               FROM subscriptions s JOIN plans p ON p.id = s.plan_id
              WHERE s.tenant_id = $1 AND s.site_id = $2 AND s.status IN ('active','past_due')`,
            [input.tenantId, input.siteId],
          )
        ).rows[0],
        'An active site subscription is required before inviting customers',
      );
      if (seats.occupied >= seats.customer_seat_limit) {
        throw new Error('Customer seat entitlement is exhausted');
      }
      const created = required(
        (
          await query<{ id: string }>(
            client,
            `INSERT INTO customer_invitations
               (tenant_id, site_id, normalized_email, role, token_hash, invited_by, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, now() + interval '7 days')
             RETURNING id`,
            [input.tenantId, input.siteId, normalizedEmail, input.role, token.digest, actor.id],
          )
        ).rows[0],
        'Invitation creation failed',
      );
      await audit(client, actor, {
        action: 'customer.invited',
        after: { normalizedEmail, role: input.role, status: 'pending' },
        before: null,
        reason: input.reason,
        siteId: input.siteId,
        targetId: created.id,
        targetType: 'customer_invitation',
        tenantId: input.tenantId,
      });
      return { ...created, host: adminDomains.rows[0].hostname };
    });
    await this.invitations.send({
      host: invitation.host,
      normalizedEmail,
      token: token.token,
    });
    return { invitationId: invitation.id, status: 'pending' };
  }

  changeCustomerRole(
    actor: AdminActor,
    input: { membershipId: string; reason: string; role: CustomerRole; siteId: string },
  ): Promise<unknown> {
    return this.transaction(actor, async (client) => {
      const before = await membership(client, input.membershipId, input.siteId);
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `UPDATE memberships SET role = $1, updated_at = now()
              WHERE id = $2 AND site_id = $3
              RETURNING id, tenant_id, site_id, user_id, role, active`,
            [input.role, input.membershipId, input.siteId],
          )
        ).rows[0],
        'Membership was not found',
      );
      const revoked = await query<{ id: string }>(
        client,
        `UPDATE sessions SET revoked_at = now(), revoke_reason = 'membership-role-changed'
          WHERE site_id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
        [input.siteId, after.user_id],
      );
      await audit(client, actor, {
        action: 'membership.role_changed',
        after: { membership: after, revokedSessions: revoked.rows.length },
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: input.membershipId,
        targetType: 'membership',
        tenantId: String(after.tenant_id),
      });
      return { membership: after, revokedSessions: revoked.rows.length };
    });
  }

  disableCustomer(
    actor: AdminActor,
    input: { membershipId: string; reason: string; siteId: string },
  ): Promise<unknown> {
    return this.transaction(actor, async (client) => {
      const before = await membership(client, input.membershipId, input.siteId);
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `UPDATE memberships SET active = false, updated_at = now()
              WHERE id = $1 AND site_id = $2
              RETURNING id, tenant_id, site_id, user_id, role, active`,
            [input.membershipId, input.siteId],
          )
        ).rows[0],
        'Membership was not found',
      );
      const revoked = await query<{ id: string }>(
        client,
        `UPDATE sessions SET revoked_at = now(), revoke_reason = 'membership-disabled'
          WHERE site_id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
        [input.siteId, after.user_id],
      );
      await audit(client, actor, {
        action: 'membership.disabled',
        after: { membership: after, revokedSessions: revoked.rows.length },
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: input.membershipId,
        targetType: 'membership',
        tenantId: String(after.tenant_id),
      });
      return { membership: after, revokedSessions: revoked.rows.length };
    });
  }

  async requestCustomerReset(
    actor: AdminActor,
    input: { networkIdentifier: string; reason: string; siteId: string; userId: string },
  ): Promise<unknown> {
    const customer = await this.transaction(actor, async (client) => {
      const result = await query<{
        hostname: string;
        normalized_email: string;
        tenant_id: string;
      }>(
        client,
        `SELECT u.normalized_email, m.tenant_id, d.hostname
           FROM memberships m
           JOIN users u ON u.id = m.user_id
           JOIN domains d ON d.tenant_id = m.tenant_id AND d.site_id = m.site_id
            AND d.kind = 'admin' AND d.active AND d.verification_status = 'verified'
          WHERE m.site_id = $1 AND m.user_id = $2 AND m.active AND u.status = 'active'
          LIMIT 2`,
        [input.siteId, input.userId],
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new Error('Customer or verified admin domain was not found');
      }
      const row = result.rows[0];
      await audit(client, actor, {
        action: 'customer.password_reset_requested',
        after: { status: 'requested' },
        before: null,
        reason: input.reason,
        siteId: input.siteId,
        targetId: input.userId,
        targetType: 'user',
        tenantId: row.tenant_id,
      });
      return row;
    });
    await this.requestRecovery({
      host: customer.hostname,
      networkIdentifier: input.networkIdentifier,
      normalizedEmail: customer.normalized_email,
      traceId: actor.traceId,
    });
    return { status: 'accepted' };
  }

  setFeatureOverride(
    actor: AdminActor,
    input: {
      cancelQueuedWork: boolean;
      enabled: boolean;
      featureKey: string;
      policyVersion: number;
      reason: string;
      siteId: string;
      tenantId: string;
    },
  ): Promise<unknown> {
    assertPlanFeatureAllowed(input.featureKey);
    return this.transaction(actor, async (client) => {
      const feature = required(
        (
          await query<{
            key: string;
            overrideable: boolean;
            readiness: 'deployable' | 'planned' | 'tested';
            version: number;
          }>(
            client,
            `SELECT key, version, overrideable, readiness FROM feature_definitions
              WHERE key = $1 ORDER BY version DESC LIMIT 1`,
            [input.featureKey],
          )
        ).rows[0],
        'Feature definition was not found',
      );
      if (!feature.overrideable || feature.key === 'content.ai.protected-facts') {
        throw new Error('Feature is protected by a nonoverrideable system rule');
      }
      if (input.enabled && feature.readiness !== 'deployable') {
        throw new Error('Feature is not deployable and cannot be enabled');
      }
      await assertSite(client, input.tenantId, input.siteId);
      const before =
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT * FROM site_feature_overrides
            WHERE tenant_id = $1 AND site_id = $2 AND feature_key = $3`,
            [input.tenantId, input.siteId, input.featureKey],
          )
        ).rows[0] ?? null;
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `INSERT INTO site_feature_overrides
               (tenant_id, site_id, feature_key, feature_version, enabled, reason, actor_id, policy_version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (site_id, feature_key) DO UPDATE
               SET feature_version = EXCLUDED.feature_version, enabled = EXCLUDED.enabled,
                   reason = EXCLUDED.reason, actor_id = EXCLUDED.actor_id,
                   effective_at = now(), policy_version = EXCLUDED.policy_version
             RETURNING *`,
            [
              input.tenantId,
              input.siteId,
              feature.key,
              feature.version,
              input.enabled,
              input.reason,
              actor.id,
              input.policyVersion,
            ],
          )
        ).rows[0],
        'Feature override failed',
      );
      await audit(client, actor, {
        action: 'site.feature_override_changed',
        after: { ...after, cancelQueuedWork: input.cancelQueuedWork },
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: String(after.id),
        targetType: 'site_feature_override',
        tenantId: input.tenantId,
      });
      return after;
    });
  }

  setContactForm(
    actor: AdminActor,
    input: {
      confirmationEnabled: boolean;
      enabled: boolean;
      fieldIds: string[];
      formId: string;
      policyVersion: number;
      reason: string;
      recipientEmail: string;
      recipientVerified: boolean;
      retentionDays: number;
      siteId: string;
      tenantId: string;
    },
  ): Promise<unknown> {
    if (input.enabled && !input.recipientVerified) {
      throw new Error('An enabled contact form requires a verified recipient');
    }
    return this.transaction(actor, async (client) => {
      const site = required(
        (
          await query<{ source_path: string }>(
            client,
            `SELECT source_path FROM sites
              WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
            [input.tenantId, input.siteId],
          )
        ).rows[0],
        'Site was not found',
      );
      const form = this.siteContracts
        .get(site.source_path)
        ?.contactForms?.find(({ id }) => id === input.formId);
      if (!form) throw new Error('Contact form is not declared by the site contract');
      const fieldIds = [...new Set(input.fieldIds)];
      if (
        fieldIds.some((id) => !form.fieldIds.includes(id)) ||
        form.requiredFieldIds.some((id) => !fieldIds.includes(id))
      ) {
        throw new Error('Contact form fields must be declared and include required fields');
      }
      const before =
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT * FROM site_contact_forms
              WHERE tenant_id = $1 AND site_id = $2 AND form_id = $3 FOR UPDATE`,
            [input.tenantId, input.siteId, input.formId],
          )
        ).rows[0] ?? null;
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `INSERT INTO site_contact_forms
               (tenant_id, site_id, form_id, enabled, declared_field_ids,
                enabled_field_ids, required_field_ids, confirmation_enabled,
                recipient_email, recipient_verified_at, retention_days, reason,
                actor_id, policy_version)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, lower($9),
                     CASE WHEN $10 THEN now() ELSE NULL END, $11, $12, $13, $14)
             ON CONFLICT (tenant_id, site_id, form_id) DO UPDATE
               SET enabled = EXCLUDED.enabled,
                   declared_field_ids = EXCLUDED.declared_field_ids,
                   enabled_field_ids = EXCLUDED.enabled_field_ids,
                   required_field_ids = EXCLUDED.required_field_ids,
                   confirmation_enabled = EXCLUDED.confirmation_enabled,
                   recipient_email = EXCLUDED.recipient_email,
                   recipient_verified_at = EXCLUDED.recipient_verified_at,
                   retention_days = EXCLUDED.retention_days, reason = EXCLUDED.reason,
                   actor_id = EXCLUDED.actor_id, policy_version = EXCLUDED.policy_version,
                   updated_at = now()
             RETURNING *`,
            [
              input.tenantId,
              input.siteId,
              input.formId,
              input.enabled,
              JSON.stringify(form.fieldIds),
              JSON.stringify(fieldIds),
              JSON.stringify(form.requiredFieldIds),
              input.confirmationEnabled,
              input.recipientEmail,
              input.recipientVerified,
              input.retentionDays,
              input.reason,
              actor.id,
              input.policyVersion,
            ],
          )
        ).rows[0],
        'Contact form configuration failed',
      );
      await audit(client, actor, {
        action: 'site.contact_form_changed',
        after: redactContactRecipient(after),
        before: redactContactRecipient(before),
        reason: input.reason,
        siteId: input.siteId,
        targetId: `${input.siteId}:${input.formId}`,
        targetType: 'site_contact_form',
        tenantId: input.tenantId,
      });
      return after;
    });
  }

  setContactSubmissionHold(
    actor: AdminActor,
    input: {
      hold: boolean;
      reason: string;
      siteId: string;
      submissionId: string;
      tenantId: string;
    },
  ): Promise<unknown> {
    assertBudgetAdministrator(actor);
    return this.transaction(actor, async (client) => {
      const before = required(
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT id, tenant_id, site_id, form_id, delivery_state, expires_at,
                    legal_hold, hold_reason, held_at, held_by
               FROM contact_submissions
              WHERE tenant_id = $1 AND site_id = $2 AND id = $3
              FOR UPDATE`,
            [input.tenantId, input.siteId, input.submissionId],
          )
        ).rows[0],
        'Contact submission was not found',
      );
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `UPDATE contact_submissions
                SET legal_hold = $4,
                    hold_reason = CASE WHEN $4 THEN $5 ELSE NULL END,
                    held_at = CASE WHEN $4 THEN now() ELSE NULL END,
                    held_by = CASE WHEN $4 THEN $6 ELSE NULL END
              WHERE tenant_id = $1 AND site_id = $2 AND id = $3
              RETURNING id, tenant_id, site_id, form_id, delivery_state, expires_at,
                        legal_hold, hold_reason, held_at, held_by`,
            [input.tenantId, input.siteId, input.submissionId, input.hold, input.reason, actor.id],
          )
        ).rows[0],
        'Contact submission hold update failed',
      );
      await audit(client, actor, {
        action: input.hold ? 'contact.legal_hold_applied' : 'contact.legal_hold_released',
        after,
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: input.submissionId,
        targetType: 'contact_submission',
        tenantId: input.tenantId,
      });
      return after;
    });
  }

  setQuotaOverride(
    actor: AdminActor,
    input: {
      policyVersion: number;
      quotaKey: 'ai_review_cycles_per_month';
      quotaLimit: number;
      reason: string;
      siteId: string;
      tenantId: string;
    },
  ): Promise<unknown> {
    return this.transaction(actor, async (client) => {
      await assertSite(client, input.tenantId, input.siteId);
      const before =
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT * FROM site_plan_quota_overrides
              WHERE tenant_id = $1 AND site_id = $2 AND quota_key = $3 FOR UPDATE`,
            [input.tenantId, input.siteId, input.quotaKey],
          )
        ).rows[0] ?? null;
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `INSERT INTO site_plan_quota_overrides
               (tenant_id, site_id, quota_key, quota_limit, reason, actor_id, policy_version)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (tenant_id, site_id, quota_key) DO UPDATE
               SET quota_limit = EXCLUDED.quota_limit, reason = EXCLUDED.reason,
                   actor_id = EXCLUDED.actor_id, policy_version = EXCLUDED.policy_version,
                   updated_at = now()
             RETURNING *`,
            [
              input.tenantId,
              input.siteId,
              input.quotaKey,
              input.quotaLimit,
              input.reason,
              actor.id,
              input.policyVersion,
            ],
          )
        ).rows[0],
        'Quota override failed',
      );
      await audit(client, actor, {
        action: 'site.quota_override_changed',
        after,
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: `${input.siteId}:${input.quotaKey}`,
        targetType: 'site_plan_quota_override',
        tenantId: input.tenantId,
      });
      return after;
    });
  }

  setSiteAiBudget(
    actor: AdminActor,
    input: {
      capUsdMicros: number;
      policyVersion: number;
      reason: string;
      siteId: string;
      tenantId: string;
    },
  ): Promise<unknown> {
    assertBudgetAdministrator(actor);
    return this.transaction(actor, async (client) => {
      await assertSite(client, input.tenantId, input.siteId);
      const before =
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT * FROM site_ai_budgets
              WHERE tenant_id = $1 AND site_id = $2 FOR UPDATE`,
            [input.tenantId, input.siteId],
          )
        ).rows[0] ?? null;
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `INSERT INTO site_ai_budgets
               (tenant_id, site_id, cap_usd_micros, policy_version, override_reason, override_actor_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (tenant_id, site_id) DO UPDATE
               SET cap_usd_micros = EXCLUDED.cap_usd_micros,
                   policy_version = EXCLUDED.policy_version,
                   override_reason = EXCLUDED.override_reason,
                   override_actor_id = EXCLUDED.override_actor_id,
                   updated_at = now()
             RETURNING *`,
            [
              input.tenantId,
              input.siteId,
              input.capUsdMicros,
              input.policyVersion,
              input.reason,
              actor.id,
            ],
          )
        ).rows[0],
        'Site AI budget update failed',
      );
      await client.query(
        `UPDATE ai_budget_periods SET cap_usd_micros = $3
          WHERE tenant_id = $1 AND site_id = $2
            AND period_start = date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
        [input.tenantId, input.siteId, input.capUsdMicros],
      );
      await audit(client, actor, {
        action: 'site.ai_budget_changed',
        after,
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: input.siteId,
        targetType: 'site_ai_budget',
        tenantId: input.tenantId,
      });
      return after;
    });
  }

  setPlatformAiBudget(
    actor: AdminActor,
    input: { capUsdMicros: number; policyVersion: number; reason: string },
  ): Promise<unknown> {
    assertBudgetAdministrator(actor);
    return this.transaction(actor, async (client) => {
      const before = required(
        (
          await query<Record<string, unknown>>(
            client,
            'SELECT * FROM platform_ai_budget WHERE singleton = true FOR UPDATE',
            [],
          )
        ).rows[0],
        'Platform AI budget was not found',
      );
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `UPDATE platform_ai_budget
                SET cap_usd_micros = $1, policy_version = $2, override_reason = $3,
                    override_actor_id = $4, updated_at = now()
              WHERE singleton = true
              RETURNING *`,
            [input.capUsdMicros, input.policyVersion, input.reason, actor.id],
          )
        ).rows[0],
        'Platform AI budget update failed',
      );
      await client.query(
        `UPDATE platform_ai_budget_periods SET cap_usd_micros = $1, updated_at = now()
          WHERE period_start = date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
        [input.capUsdMicros],
      );
      await audit(client, actor, {
        action: 'platform.ai_budget_changed',
        after,
        before,
        reason: input.reason,
        targetId: 'platform',
        targetType: 'platform_ai_budget',
      });
      return after;
    });
  }

  setEmergencyControls(
    actor: AdminActor,
    input: {
      autonomousChangesStopped: boolean;
      automationStopped: boolean;
      editingFrozen: boolean;
      policyVersion: number;
      reason: string;
      siteId: string;
      tenantId: string;
    },
  ): Promise<unknown> {
    return this.transaction(actor, async (client) => {
      await assertSite(client, input.tenantId, input.siteId);
      const before =
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT * FROM site_emergency_controls WHERE tenant_id = $1 AND site_id = $2`,
            [input.tenantId, input.siteId],
          )
        ).rows[0] ?? null;
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `INSERT INTO site_emergency_controls
               (tenant_id, site_id, editing_frozen, autonomous_changes_stopped,
                automation_stopped, reason, actor_id, policy_version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (tenant_id, site_id) DO UPDATE
               SET editing_frozen = EXCLUDED.editing_frozen,
                   autonomous_changes_stopped = EXCLUDED.autonomous_changes_stopped,
                   automation_stopped = EXCLUDED.automation_stopped,
                   reason = EXCLUDED.reason, actor_id = EXCLUDED.actor_id,
                   policy_version = EXCLUDED.policy_version, updated_at = now()
             RETURNING *`,
            [
              input.tenantId,
              input.siteId,
              input.editingFrozen,
              input.autonomousChangesStopped,
              input.automationStopped,
              input.reason,
              actor.id,
              input.policyVersion,
            ],
          )
        ).rows[0],
        'Emergency control update failed',
      );
      await audit(client, actor, {
        action: 'site.emergency_controls_changed',
        after,
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: input.siteId,
        targetType: 'site',
        tenantId: input.tenantId,
      });
      return after;
    });
  }

  setSubscriptionState(
    actor: AdminActor,
    input: {
      graceEndsAt?: Date;
      reason: string;
      siteId: string;
      status: 'active' | 'cancelled' | 'past_due';
      tenantId: string;
    },
  ): Promise<unknown> {
    const graceEndsAt =
      input.status === 'past_due'
        ? (input.graceEndsAt ?? defaultGraceEndsAt(new Date()))
        : input.graceEndsAt;
    return this.transaction(actor, async (client) => {
      const before = required(
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT * FROM subscriptions WHERE tenant_id = $1 AND site_id = $2 FOR UPDATE`,
            [input.tenantId, input.siteId],
          )
        ).rows[0],
        'Subscription is not configured for this site',
      );
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `UPDATE subscriptions
                SET status = $3, grace_ends_at = $4, updated_at = now()
              WHERE tenant_id = $1 AND site_id = $2 RETURNING *`,
            [input.tenantId, input.siteId, input.status, graceEndsAt ?? null],
          )
        ).rows[0],
        'Subscription update failed',
      );
      await audit(client, actor, {
        action: 'site.subscription_state_changed',
        after,
        before,
        reason: input.reason,
        siteId: input.siteId,
        targetId: String(after.id),
        targetType: 'subscription',
        tenantId: input.tenantId,
      });
      return after;
    });
  }

  listOperations(actor: AdminActor): Promise<unknown> {
    return this.transaction(actor, async (client) => {
      const alerts = await query<{
        fingerprint: string;
        id: string;
        message: string;
        occurrences: number;
        severity: string;
        state: string;
      }>(
        client,
        `SELECT id, fingerprint, severity, state, safe_message AS message, occurrences
           FROM alerts
          ORDER BY CASE state WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
                   last_seen_at DESC
          LIMIT 100`,
        [],
      );
      const jobs = await query<{
        category: string;
        id: string;
        state: string;
        trace_id: string;
        updated_at: Date;
      }>(
        client,
        `SELECT id, category, state, trace_id, updated_at
           FROM jobs ORDER BY updated_at DESC LIMIT 100`,
        [],
      );
      const budget = required(
        (
          await query<{
            cap_usd_micros: string;
            period_start: Date;
            reserved_usd_micros: string;
            used_usd_micros: string;
          }>(
            client,
            `SELECT COALESCE(p.cap_usd_micros, b.cap_usd_micros)::text AS cap_usd_micros,
                    date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS period_start,
                    COALESCE(p.reserved_usd_micros, 0)::text AS reserved_usd_micros,
                    COALESCE(p.used_usd_micros, 0)::text AS used_usd_micros
               FROM platform_ai_budget b
               LEFT JOIN platform_ai_budget_periods p
                 ON p.period_start = date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
              WHERE b.singleton = true`,
            [],
          )
        ).rows[0],
        'Platform AI budget is not configured',
      );
      return {
        alerts: alerts.rows,
        budget: {
          capUsdMicros: Number(budget.cap_usd_micros),
          periodStart: budget.period_start.toISOString(),
          reservedUsdMicros: Number(budget.reserved_usd_micros),
          usedUsdMicros: Number(budget.used_usd_micros),
        },
        jobs: jobs.rows.map((job) => ({
          category: job.category,
          id: job.id,
          state: job.state,
          traceId: job.trace_id,
          updatedAt: job.updated_at.toISOString(),
        })),
      };
    });
  }

  cancelJob(actor: AdminActor, input: { jobId: string; reason: string }): Promise<unknown> {
    return this.transaction(actor, async (client) => {
      const before = required(
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT id, tenant_id, site_id, category, state, trace_id
               FROM jobs WHERE id = $1 FOR UPDATE`,
            [input.jobId],
          )
        ).rows[0],
        'Job was not found',
      );
      if (before.state !== 'queued') throw new Error('Only queued jobs can be cancelled');
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `UPDATE jobs
                SET state = 'cancelled', completed_at = now(), updated_at = now(),
                    queue_claim_owner = NULL, queue_claimed_until = NULL
              WHERE id = $1 AND state = 'queued'
              RETURNING id, tenant_id, site_id, category, state, trace_id`,
            [input.jobId],
          )
        ).rows[0],
        'Queued job cancellation failed',
      );
      await audit(client, actor, {
        action: 'job.cancelled',
        after,
        before,
        reason: input.reason,
        ...(typeof after.site_id === 'string' ? { siteId: after.site_id } : {}),
        targetId: input.jobId,
        targetType: 'job',
        ...(typeof after.tenant_id === 'string' ? { tenantId: after.tenant_id } : {}),
      });
      return after;
    });
  }

  replayJob(actor: AdminActor, input: { jobId: string; reason: string }): Promise<unknown> {
    const replayTraceId = /^[A-Za-z0-9_-]{16,128}$/u.test(actor.traceId)
      ? actor.traceId
      : randomUUID();
    return this.transaction(actor, async (client) => {
      const before = required(
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT * FROM jobs WHERE id = $1 FOR UPDATE`,
            [input.jobId],
          )
        ).rows[0],
        'Job was not found',
      );
      if (!['cancelled', 'failed', 'skipped'].includes(String(before.state))) {
        throw new Error('Only cancelled, failed, or skipped jobs can be replayed');
      }
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `INSERT INTO jobs
               (tenant_id, site_id, category, schema_version, record_id, dedupe_key,
                trace_id, state, policy_version, attempt_limit, expires_at)
             SELECT tenant_id, site_id, category, schema_version, record_id,
                    left('replay:' || id::text || ':' || gen_random_uuid()::text, 160),
                    $2, 'queued', policy_version, attempt_limit, now() + interval '24 hours'
               FROM jobs WHERE id = $1
             RETURNING id, tenant_id, site_id, category, state, trace_id, dedupe_key`,
            [input.jobId, replayTraceId],
          )
        ).rows[0],
        'Job replay admission failed',
      );
      await audit(client, actor, {
        action: 'job.replayed',
        after: { ...after, replayOf: input.jobId },
        before,
        reason: input.reason,
        ...(typeof after.site_id === 'string' ? { siteId: after.site_id } : {}),
        targetId: String(after.id),
        targetType: 'job',
        ...(typeof after.tenant_id === 'string' ? { tenantId: after.tenant_id } : {}),
      });
      return after;
    });
  }

  acknowledgeAlert(
    actor: AdminActor,
    input: { alertId: string; reason: string },
  ): Promise<unknown> {
    return this.transitionAlert(actor, input, 'acknowledged');
  }

  resolveAlert(actor: AdminActor, input: { alertId: string; reason: string }): Promise<unknown> {
    return this.transitionAlert(actor, input, 'resolved');
  }

  private transitionAlert(
    actor: AdminActor,
    input: { alertId: string; reason: string },
    state: 'acknowledged' | 'resolved',
  ): Promise<unknown> {
    return this.transaction(actor, async (client) => {
      const before = required(
        (
          await query<Record<string, unknown>>(
            client,
            `SELECT id, tenant_id, site_id, fingerprint, severity, state, occurrences
               FROM alerts WHERE id = $1 FOR UPDATE`,
            [input.alertId],
          )
        ).rows[0],
        'Alert was not found',
      );
      if (before.state === 'resolved') throw new Error('Resolved alert cannot be transitioned');
      const after = required(
        (
          await query<Record<string, unknown>>(
            client,
            `UPDATE alerts
                SET state = $2,
                    owner_id = $3,
                    acknowledged_at = CASE WHEN $2 IN ('acknowledged','resolved')
                                           THEN COALESCE(acknowledged_at, now()) ELSE acknowledged_at END,
                    resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE NULL END
              WHERE id = $1
              RETURNING id, tenant_id, site_id, fingerprint, severity, state, occurrences`,
            [input.alertId, state, actor.id],
          )
        ).rows[0],
        'Alert transition failed',
      );
      await audit(client, actor, {
        action: `alert.${state}`,
        after,
        before,
        reason: input.reason,
        ...(typeof after.site_id === 'string' ? { siteId: after.site_id } : {}),
        targetId: input.alertId,
        targetType: 'alert',
        ...(typeof after.tenant_id === 'string' ? { tenantId: after.tenant_id } : {}),
      });
      return after;
    });
  }

  private transaction<T>(
    actor: AdminActor,
    operation: (client: TenantTransactionClient) => Promise<T>,
  ): Promise<T> {
    return withPlatformTransaction(this.pool, { actorId: actor.id }, operation);
  }
}

function assertBudgetAdministrator(actor: AdminActor): void {
  if (actor.role !== 'platform_owner' && actor.role !== 'platform_admin') {
    throw new Error('AI budget changes require a platform owner or platform admin');
  }
}

async function assertSite(
  client: TenantTransactionClient,
  tenantId: string,
  siteId: string,
): Promise<void> {
  const result = await query<{ id: string }>(
    client,
    `SELECT id FROM sites WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
    [tenantId, siteId],
  );
  if (result.rows.length !== 1) throw new Error('Site was not found');
}

async function membership(
  client: TenantTransactionClient,
  membershipId: string,
  siteId: string,
): Promise<Record<string, unknown>> {
  const result = await query<Record<string, unknown>>(
    client,
    `SELECT id, tenant_id, site_id, user_id, role, active
       FROM memberships WHERE id = $1 AND site_id = $2 FOR UPDATE`,
    [membershipId, siteId],
  );
  return required(result.rows[0], 'Membership was not found');
}

async function audit(
  client: TenantTransactionClient,
  actor: AdminActor,
  event: {
    action: string;
    after: unknown;
    before: unknown;
    reason: string;
    siteId?: string;
    targetId: string;
    targetType: string;
    tenantId?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (tenant_id, site_id, actor_id, action, reason, trace_id,
        target_type, target_id, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)`,
    [
      event.tenantId ?? null,
      event.siteId ?? null,
      actor.id,
      event.action,
      event.reason.trim(),
      actor.traceId,
      event.targetType,
      event.targetId,
      JSON.stringify(event.before),
      JSON.stringify(event.after),
    ],
  );
}

async function query<T extends Record<string, unknown>>(
  client: TenantTransactionClient,
  text: string,
  values: unknown[],
): Promise<{ rows: T[] }> {
  return (await client.query(text, values)) as { rows: T[] };
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function redactContactRecipient(
  value: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return value ? { ...value, recipient_email: '[REDACTED]' } : null;
}
