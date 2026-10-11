import type { TenantTransactionClient } from './transaction.ts';

export class SitePolicyDeniedError extends Error {
  override readonly name = 'SitePolicyDeniedError';
}

export async function assertSiteFeatureEnabled(
  client: TenantTransactionClient,
  context: { siteId: string; tenantId: string },
  featureKey: string,
): Promise<void> {
  const result = (await client.query(
    `WITH latest_feature AS (
       SELECT key, version, overrideable, safe_default
         FROM feature_definitions
        WHERE key = $3
        ORDER BY version DESC
        LIMIT 1
     )
     SELECT sub.status AS subscription_status, sub.grace_ends_at,
            COALESCE(ctrl.editing_frozen, false) AS editing_frozen,
            COALESCE(
              CASE WHEN feature.overrideable THEN site_override.enabled END,
              plan.enabled,
              feature.safe_default,
              false
            ) AS feature_enabled
       FROM sites site
       LEFT JOIN subscriptions sub
         ON sub.tenant_id = site.tenant_id AND sub.site_id = site.id
       LEFT JOIN site_emergency_controls ctrl
         ON ctrl.tenant_id = site.tenant_id AND ctrl.site_id = site.id
       LEFT JOIN latest_feature feature ON true
       LEFT JOIN site_feature_overrides site_override
         ON site_override.tenant_id = site.tenant_id AND site_override.site_id = site.id
        AND site_override.feature_key = feature.key AND site_override.feature_version = feature.version
       LEFT JOIN plan_features plan
         ON plan.plan_id = sub.plan_id AND plan.feature_key = feature.key
        AND plan.feature_version = feature.version
      WHERE site.tenant_id = $1 AND site.id = $2 AND site.status = 'active'`,
    [context.tenantId, context.siteId, featureKey],
  )) as {
    rows: {
      editing_frozen: boolean;
      feature_enabled: boolean;
      grace_ends_at: Date | null;
      subscription_status: 'active' | 'cancelled' | 'past_due' | null;
    }[];
  };
  const policy = result.rows[0];
  const withinGrace = Boolean(policy?.grace_ends_at && policy.grace_ends_at >= new Date());
  const subscriptionAllows =
    policy?.subscription_status === 'active' ||
    ((policy?.subscription_status === 'past_due' || policy?.subscription_status === 'cancelled') &&
      withinGrace);
  if (!policy || policy.editing_frozen || !subscriptionAllows || !policy.feature_enabled) {
    throw new SitePolicyDeniedError(`Site policy denies ${featureKey}`);
  }
}
