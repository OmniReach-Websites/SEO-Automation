import { getOrapCapability, type OrapCapabilityKey } from '@omnireach/auth';

export interface OrapRoutePolicy {
  readonly capabilities: readonly OrapCapabilityKey[];
  readonly method: 'DELETE' | 'GET' | 'POST' | 'PUT';
  readonly ownerIdentityOnly?: boolean;
  readonly path: string;
}

export const orapRoutePolicyRegistry = [
  route('GET', '/v1/orap/operations', 'dashboard.view'),
  route('GET', '/v1/orap/analytics/sites', 'analytics.view'),
  route('GET', '/v1/orap/sites/:siteId/analytics', 'analytics.view'),
  route('GET', '/v1/orap/sites/:siteId/effective-settings', 'websites.view'),
  { capabilities: [], method: 'GET', ownerIdentityOnly: true, path: '/v1/orap/staff' },
  { capabilities: [], method: 'GET', ownerIdentityOnly: true, path: '/v1/orap/staff/roles' },
  {
    capabilities: [],
    method: 'PUT',
    ownerIdentityOnly: true,
    path: '/v1/orap/staff/:userId',
  },
  {
    capabilities: [],
    method: 'POST',
    ownerIdentityOnly: true,
    path: '/v1/orap/staff/invitations',
  },
  {
    capabilities: [],
    method: 'POST',
    ownerIdentityOnly: true,
    path: '/v1/orap/staff/:userId/role',
  },
  {
    capabilities: [],
    method: 'POST',
    ownerIdentityOnly: true,
    path: '/v1/orap/staff/:userId/disable',
  },
  {
    capabilities: [],
    method: 'POST',
    ownerIdentityOnly: true,
    path: '/v1/orap/staff/:userId/sessions/revoke-all',
  },
  {
    capabilities: [],
    method: 'POST',
    ownerIdentityOnly: true,
    path: '/v1/orap/staff/:userId/reset',
  },
  route('POST', '/v1/orap/alerts/:alertId/acknowledge', 'alerts.acknowledge'),
  route('POST', '/v1/orap/jobs/:jobId/cancel', 'automation.jobs.cancel'),
  route('POST', '/v1/orap/jobs/:jobId/replay', 'automation.jobs.replay'),
  route('POST', '/v1/orap/alerts/:alertId/resolve', 'alerts.resolve'),
  route('POST', '/v1/orap/plans', 'plans.edit'),
  route('GET', '/v1/orap/sites', 'websites.list'),
  {
    capabilities: ['customers.create', 'websites.create'],
    method: 'POST',
    path: '/v1/orap/sites',
  },
  route('POST', '/v1/orap/sites/:siteId/invitations', 'customers.users.manage'),
  route('PUT', '/v1/orap/sites/:siteId/memberships/:membershipId', 'customers.users.manage'),
  route(
    'POST',
    '/v1/orap/sites/:siteId/memberships/:membershipId/disable',
    'customers.users.manage',
  ),
  route('POST', '/v1/orap/sites/:siteId/users/:userId/reset', 'security.customer_access.manage'),
  route(
    'GET',
    '/v1/orap/tenants/:tenantId/sites/:siteId/users/:userId/sessions',
    'security.sessions.view',
  ),
  route(
    'POST',
    '/v1/orap/tenants/:tenantId/sites/:siteId/users/:userId/sessions/:sessionId/revoke',
    'security.sessions.revoke',
  ),
  route(
    'POST',
    '/v1/orap/tenants/:tenantId/sites/:siteId/users/:userId/sessions/revoke-all',
    'security.sessions.revoke',
  ),
  route('PUT', '/v1/orap/sites/:siteId/plan', 'subscriptions.edit'),
  route('PUT', '/v1/orap/sites/:siteId/features/:featureKey', 'entitlements.override'),
  route('PUT', '/v1/orap/sites/:siteId/emergency-controls', 'automation.emergency_controls.manage'),
  route('PUT', '/v1/orap/sites/:siteId/contact-forms/:formId', 'contact_forms.manage'),
  route(
    'PUT',
    '/v1/orap/sites/:siteId/contact-submissions/:submissionId/hold',
    'contact_forms.submissions.hold',
  ),
  route('PUT', '/v1/orap/sites/:siteId/quota-overrides/:quotaKey', 'entitlements.override'),
  route('PUT', '/v1/orap/sites/:siteId/subscription', 'subscriptions.edit'),
  route('PUT', '/v1/orap/sites/:siteId/ai-budget', 'ai_budget.site.edit'),
  route('PUT', '/v1/orap/platform/ai-budget', 'ai_budget.platform.edit'),
  route('GET', '/v1/orap/sites/:siteId/integrations', 'integrations.google.view'),
  route('POST', '/v1/orap/sites/:siteId/integrations/google/start', 'integrations.google.manage'),
  route('POST', '/v1/orap/sites/:siteId/integrations/google/select', 'integrations.google.manage'),
  route('GET', '/v1/orap/integrations/google/callback', 'integrations.google.manage'),
  route('DELETE', '/v1/orap/integrations/:connectionId', 'integrations.google.manage'),
] as const satisfies readonly OrapRoutePolicy[];

export function assertOrapRoutePolicyRegistry(): void {
  const identities = new Set<string>();
  for (const policy of orapRoutePolicyRegistry) {
    const identity = `${policy.method} ${policy.path}`;
    if (identities.has(identity)) throw new Error(`Duplicate ORAP route policy: ${identity}`);
    identities.add(identity);
    if ('ownerIdentityOnly' in policy && policy.ownerIdentityOnly) {
      if (policy.capabilities.length > 0) {
        throw new Error(`Owner-only ORAP route cannot delegate capabilities: ${identity}`);
      }
      continue;
    }
    if (policy.capabilities.length === 0) {
      throw new Error(`ORAP route has no authorization policy: ${identity}`);
    }
    for (const key of policy.capabilities) {
      const capability = getOrapCapability(key);
      if (!capability || capability.ownerOnly) {
        throw new Error(`ORAP route uses an invalid delegated capability: ${identity} -> ${key}`);
      }
    }
  }
}

function route(
  method: OrapRoutePolicy['method'],
  path: string,
  capability: OrapCapabilityKey,
): OrapRoutePolicy {
  return { capabilities: [capability], method, path };
}
