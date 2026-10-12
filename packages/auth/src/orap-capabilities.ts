export type OrapCapabilityRisk = 'low' | 'medium' | 'high' | 'critical';
export type OrapCapabilityScope = 'platform' | 'tenant' | 'site' | 'mixed';

export interface OrapCapabilityDefinition {
  readonly description: string;
  readonly key: string;
  readonly label: string;
  readonly module: string;
  readonly ownerOnly: boolean;
  readonly requiresReason: boolean;
  readonly requiresStrongStepUp: boolean;
  readonly risk: OrapCapabilityRisk;
  readonly scope: OrapCapabilityScope;
  readonly version: number;
}

export interface OrapRoleTemplateDefinition {
  readonly description: string;
  readonly displayOrder: number;
  readonly name: string;
  readonly ownerIdentityOnly: boolean;
  readonly permissionKeys: readonly string[];
  readonly slug: string;
}

type CapabilityInput = Omit<
  OrapCapabilityDefinition,
  'ownerOnly' | 'requiresReason' | 'requiresStrongStepUp' | 'version'
> &
  Partial<
    Pick<
      OrapCapabilityDefinition,
      'ownerOnly' | 'requiresReason' | 'requiresStrongStepUp' | 'version'
    >
  >;

function capability(input: CapabilityInput): OrapCapabilityDefinition {
  return {
    ...input,
    ownerOnly: input.ownerOnly ?? false,
    requiresReason: input.requiresReason ?? false,
    requiresStrongStepUp: input.requiresStrongStepUp ?? false,
    version: input.version ?? 1,
  };
}

const view = (key: string, module: string, label: string, scope: OrapCapabilityScope) =>
  capability({
    description: `View authorized ${label.toLowerCase()}.`,
    key,
    label,
    module,
    risk: 'low',
    scope,
  });
const mutate = (
  key: string,
  module: string,
  label: string,
  scope: OrapCapabilityScope,
  risk: OrapCapabilityRisk = 'medium',
) =>
  capability({
    description: `Manage authorized ${label.toLowerCase()}.`,
    key,
    label,
    module,
    requiresReason: true,
    risk,
    scope,
  });
const owner = (key: string, module: string, label: string) =>
  capability({
    description: `${label} is reserved to a current verified Platform Owner identity.`,
    key,
    label,
    module,
    ownerOnly: true,
    requiresReason: true,
    requiresStrongStepUp: true,
    risk: 'critical',
    scope: 'platform',
  });

export const orapCapabilityCatalog = [
  view('dashboard.view', 'dashboard', 'Operations overview', 'mixed'),
  view('dashboard.view_financials', 'dashboard', 'Financial overview', 'platform'),
  view('customers.list', 'customers', 'Customer directory', 'tenant'),
  view('customers.view', 'customers', 'Customer details', 'tenant'),
  mutate('customers.create', 'customers', 'Customer creation', 'platform'),
  mutate('customers.edit', 'customers', 'Customer records', 'tenant'),
  mutate('customers.disable', 'customers', 'Customer status', 'tenant', 'high'),
  view('customers.users.view', 'customers', 'Customer users', 'tenant'),
  mutate('customers.users.manage', 'customers', 'Customer users', 'tenant', 'high'),
  view('websites.list', 'websites', 'Website directory', 'site'),
  view('websites.view', 'websites', 'Website details', 'site'),
  mutate('websites.create', 'websites', 'Website registration', 'platform', 'high'),
  mutate('websites.edit', 'websites', 'Website settings', 'site'),
  mutate('websites.disable', 'websites', 'Website status', 'site', 'high'),
  view('websites.content.view', 'content', 'Website content', 'site'),
  mutate('websites.content.edit', 'content', 'Eligible website content', 'site'),
  mutate('websites.content.publish', 'content', 'Website publication', 'site', 'high'),
  mutate('websites.content.restore', 'content', 'Content restoration', 'site', 'high'),
  view('websites.facts.view', 'content', 'Protected business facts', 'site'),
  mutate('websites.facts.edit', 'content', 'Protected business facts', 'site', 'high'),
  mutate('websites.assets.manage', 'content', 'Website assets', 'site'),
  view('domains.view', 'domains', 'Domain records', 'site'),
  mutate('domains.plan_changes', 'domains', 'DNS change plans', 'site', 'high'),
  capability({
    description: 'Apply an independently approved DNS change plan.',
    key: 'domains.apply_changes',
    label: 'Apply DNS changes',
    module: 'domains',
    requiresReason: true,
    requiresStrongStepUp: true,
    risk: 'critical',
    scope: 'site',
  }),
  view('deployments.view', 'deployments', 'Deployment history', 'site'),
  mutate('deployments.request', 'deployments', 'Deployment requests', 'site', 'high'),
  capability({
    description: 'Request a rollback through the separately approved release controls.',
    key: 'deployments.rollback',
    label: 'Request deployment rollback',
    module: 'deployments',
    requiresReason: true,
    requiresStrongStepUp: true,
    risk: 'critical',
    scope: 'site',
  }),
  view('seo.view', 'seo', 'SEO evidence and findings', 'site'),
  mutate('seo.audit.run', 'seo', 'SEO audits', 'site'),
  mutate('seo.remediation.propose', 'seo', 'SEO remediation proposals', 'site'),
  mutate('seo.remediation.publish', 'seo', 'SEO remediation publication', 'site', 'high'),
  view('aio.view', 'aio', 'AIO evidence and proposals', 'site'),
  mutate('aio.proposals.review', 'aio', 'AIO proposal review', 'site'),
  mutate('aio.policies.edit', 'aio', 'Safe AIO site policies', 'site', 'high'),
  mutate('aio.autopublish.pause', 'aio', 'AIO automatic publication state', 'site', 'high'),
  view('automation.jobs.view', 'automation', 'Automation jobs', 'site'),
  mutate('automation.jobs.cancel', 'automation', 'Queued automation jobs', 'site', 'high'),
  mutate('automation.jobs.replay', 'automation', 'Failed automation jobs', 'site', 'high'),
  view('automation.schedules.view', 'automation', 'Automation schedules', 'site'),
  mutate('automation.schedules.edit', 'automation', 'Automation schedules', 'site', 'high'),
  view('automation.workers.view', 'automation', 'Worker health', 'platform'),
  mutate(
    'automation.emergency_controls.manage',
    'automation',
    'Per-site emergency controls',
    'site',
    'critical',
  ),
  view('analytics.view', 'analytics', 'Analytics reporting', 'site'),
  view('integrations.google.view', 'integrations', 'Google integration status', 'site'),
  mutate('integrations.google.manage', 'integrations', 'Google integrations', 'site', 'high'),
  view('plans.view', 'subscriptions', 'Subscription plans', 'platform'),
  mutate('plans.edit', 'subscriptions', 'Subscription plans', 'platform', 'high'),
  view('subscriptions.view', 'subscriptions', 'Website subscriptions', 'site'),
  mutate('subscriptions.edit', 'subscriptions', 'Website subscriptions', 'site', 'high'),
  view('entitlements.view', 'subscriptions', 'Website entitlements', 'site'),
  mutate('entitlements.override', 'subscriptions', 'Website entitlement overrides', 'site', 'high'),
  view('ai_usage.view', 'spending', 'AI usage ledger', 'mixed'),
  view('ai_budget.site.view', 'spending', 'Site AI budgets', 'site'),
  mutate('ai_budget.site.edit', 'spending', 'Site AI budgets', 'site', 'high'),
  view('ai_budget.platform.view', 'spending', 'Platform AI budget', 'platform'),
  mutate('ai_budget.platform.edit', 'spending', 'Platform AI budget', 'platform', 'high'),
  view('alerts.view', 'alerts', 'Operational alerts', 'mixed'),
  mutate('alerts.acknowledge', 'alerts', 'Alert acknowledgements', 'mixed'),
  mutate('alerts.resolve', 'alerts', 'Alert resolution', 'mixed'),
  mutate('alerts.configure_delivery', 'alerts', 'Alert delivery policy', 'platform', 'high'),
  view('contact_forms.view', 'contact_forms', 'Contact form configuration', 'site'),
  mutate('contact_forms.manage', 'contact_forms', 'Contact form configuration', 'site', 'high'),
  view('contact_forms.submissions.view', 'contact_forms', 'Contact form submissions', 'site'),
  mutate(
    'contact_forms.submissions.hold',
    'contact_forms',
    'Contact submission legal and security holds',
    'site',
    'high',
  ),
  view('security.audit.view', 'security', 'Security audit history', 'mixed'),
  view('security.sessions.view', 'security', 'Authorized sessions', 'mixed'),
  mutate('security.sessions.revoke', 'security', 'Authorized sessions', 'mixed', 'high'),
  mutate('security.customer_access.manage', 'security', 'Customer access', 'site', 'high'),
  view('backups.status.view', 'backups', 'Backup and restore status', 'platform'),
  mutate(
    'backups.restore.request',
    'backups',
    'Backup restoration requests',
    'platform',
    'critical',
  ),
  mutate('backups.delete.request', 'backups', 'Backup deletion requests', 'platform', 'critical'),
  view('settings.view', 'settings', 'Platform settings', 'platform'),
  mutate('settings.general.edit', 'settings', 'General platform settings', 'platform', 'high'),
  view('settings.integrations.view', 'settings', 'Integration configuration', 'platform'),
  mutate(
    'settings.integrations.manage',
    'settings',
    'Integration configuration',
    'platform',
    'high',
  ),
  view('settings.auth_policy.view', 'settings', 'Authentication policy', 'platform'),
  owner('settings.auth_policy.edit', 'settings', 'Change platform authentication policy'),
  owner('staff.invite', 'staff', 'Invite internal staff'),
  owner('staff.create', 'staff', 'Create internal staff'),
  owner('staff.activate', 'staff', 'Activate internal staff'),
  owner('staff.disable', 'staff', 'Disable internal staff'),
  owner('staff.credentials.reset', 'staff', 'Reset internal staff credentials'),
  owner('staff.roles.manage', 'staff', 'Manage staff roles'),
  owner('staff.permissions.manage', 'staff', 'Manage staff permissions'),
  owner('staff.assign_roles', 'staff', 'Assign staff roles and scopes'),
  owner('owners.manage', 'staff', 'Manage Platform Owners'),
  owner('break_glass.approve', 'security', 'Approve break-glass recovery'),
  owner('security.platform_policy.change', 'security', 'Change platform security policy'),
  owner('backups.delete.approve', 'backups', 'Approve manual backup deletion'),
] as const satisfies readonly OrapCapabilityDefinition[];

export type OrapCapabilityKey = (typeof orapCapabilityCatalog)[number]['key'];

const keys = new Set<string>(orapCapabilityCatalog.map(({ key }) => key));

export function getOrapCapability(key: string): OrapCapabilityDefinition | undefined {
  return orapCapabilityCatalog.find((definition) => definition.key === key);
}

export function isRegisteredOrapCapability(key: string): key is OrapCapabilityKey {
  return keys.has(key);
}

export function isAssignableOrapCapability(key: string): key is OrapCapabilityKey {
  const definition = getOrapCapability(key);
  return definition !== undefined && !definition.ownerOnly;
}

const permissions = (...permissionKeys: OrapCapabilityKey[]) => permissionKeys;

export const orapRoleTemplates = [
  {
    description:
      'Non-grantable Platform Owner identity. Functional access is derived from verified ownership, not role grants.',
    displayOrder: 0,
    name: 'Platform Owner',
    ownerIdentityOnly: true,
    permissionKeys: [],
    slug: 'platform-owner',
  },
  {
    description:
      'Broad staff-grade operational template. It cannot manage internal staff, owners, roles, or protected platform security authority.',
    displayOrder: 10,
    name: 'Platform Admin',
    ownerIdentityOnly: false,
    permissionKeys: permissions(
      'dashboard.view',
      'dashboard.view_financials',
      'customers.list',
      'customers.view',
      'customers.create',
      'customers.edit',
      'customers.disable',
      'customers.users.view',
      'customers.users.manage',
      'websites.list',
      'websites.view',
      'websites.create',
      'websites.edit',
      'websites.disable',
      'websites.content.view',
      'websites.content.edit',
      'websites.content.publish',
      'websites.content.restore',
      'websites.facts.view',
      'websites.facts.edit',
      'websites.assets.manage',
      'domains.view',
      'domains.plan_changes',
      'deployments.view',
      'deployments.request',
      'seo.view',
      'seo.audit.run',
      'seo.remediation.propose',
      'seo.remediation.publish',
      'aio.view',
      'aio.proposals.review',
      'aio.policies.edit',
      'aio.autopublish.pause',
      'automation.jobs.view',
      'automation.jobs.cancel',
      'automation.jobs.replay',
      'automation.schedules.view',
      'automation.schedules.edit',
      'automation.workers.view',
      'automation.emergency_controls.manage',
      'analytics.view',
      'integrations.google.view',
      'integrations.google.manage',
      'plans.view',
      'plans.edit',
      'subscriptions.view',
      'subscriptions.edit',
      'entitlements.view',
      'entitlements.override',
      'ai_usage.view',
      'ai_budget.site.view',
      'ai_budget.site.edit',
      'ai_budget.platform.view',
      'ai_budget.platform.edit',
      'alerts.view',
      'alerts.acknowledge',
      'alerts.resolve',
      'alerts.configure_delivery',
      'contact_forms.view',
      'contact_forms.manage',
      'contact_forms.submissions.view',
      'contact_forms.submissions.hold',
      'security.audit.view',
      'security.sessions.view',
      'security.sessions.revoke',
      'security.customer_access.manage',
      'backups.status.view',
      'backups.restore.request',
      'backups.delete.request',
      'settings.view',
      'settings.general.edit',
      'settings.integrations.view',
      'settings.integrations.manage',
      'settings.auth_policy.view',
    ),
    slug: 'platform-admin',
  },
  {
    description:
      'Portfolio operations, health, alerts, jobs, schedules, and approved non-security recovery actions.',
    displayOrder: 20,
    name: 'Operations Manager',
    ownerIdentityOnly: false,
    permissionKeys: permissions(
      'dashboard.view',
      'websites.list',
      'websites.view',
      'deployments.view',
      'automation.jobs.view',
      'automation.jobs.cancel',
      'automation.jobs.replay',
      'automation.schedules.view',
      'automation.schedules.edit',
      'automation.workers.view',
      'alerts.view',
      'alerts.acknowledge',
      'alerts.resolve',
      'backups.status.view',
    ),
    slug: 'operations-manager',
  },
  {
    description:
      'Technical work on assigned sites, manifests, content, assets, builds, and explicitly authorized publication.',
    displayOrder: 30,
    name: 'Website Developer',
    ownerIdentityOnly: false,
    permissionKeys: permissions(
      'dashboard.view',
      'websites.list',
      'websites.view',
      'websites.edit',
      'websites.content.view',
      'websites.content.edit',
      'websites.content.publish',
      'websites.content.restore',
      'websites.facts.view',
      'websites.assets.manage',
      'domains.view',
      'deployments.view',
      'deployments.request',
      'seo.view',
      'automation.jobs.view',
    ),
    slug: 'website-developer',
  },
  {
    description:
      'Eligible content, media, drafts, proposals, and preview for assigned websites. Publishing remains separately grantable.',
    displayOrder: 40,
    name: 'Content Editor',
    ownerIdentityOnly: false,
    permissionKeys: permissions(
      'dashboard.view',
      'customers.view',
      'websites.list',
      'websites.view',
      'websites.content.view',
      'websites.content.edit',
      'websites.assets.manage',
      'aio.view',
      'aio.proposals.review',
    ),
    slug: 'content-editor',
  },
  {
    description:
      'SEO evidence, audits, analytics, and remediation proposals for assigned websites.',
    displayOrder: 50,
    name: 'SEO Specialist',
    ownerIdentityOnly: false,
    permissionKeys: permissions(
      'dashboard.view',
      'websites.list',
      'websites.view',
      'seo.view',
      'seo.audit.run',
      'seo.remediation.propose',
      'analytics.view',
      'automation.jobs.view',
    ),
    slug: 'seo-specialist',
  },
  {
    description:
      'AIO evidence, eligible proposal review, and explicitly granted safe site-level policy controls.',
    displayOrder: 60,
    name: 'AIO Specialist',
    ownerIdentityOnly: false,
    permissionKeys: permissions(
      'dashboard.view',
      'websites.list',
      'websites.view',
      'websites.content.view',
      'aio.view',
      'aio.proposals.review',
      'ai_usage.view',
      'ai_budget.site.view',
    ),
    slug: 'aio-specialist',
  },
  {
    description:
      'Scoped customer onboarding, customer people, website status, and subscription visibility.',
    displayOrder: 70,
    name: 'Account Manager',
    ownerIdentityOnly: false,
    permissionKeys: permissions(
      'dashboard.view',
      'customers.list',
      'customers.view',
      'customers.create',
      'customers.edit',
      'customers.users.view',
      'customers.users.manage',
      'websites.list',
      'websites.view',
      'subscriptions.view',
      'entitlements.view',
      'alerts.view',
    ),
    slug: 'account-manager',
  },
  {
    description:
      'Scoped support visibility, customer account assistance, site health, jobs, and alerts.',
    displayOrder: 80,
    name: 'Support Representative',
    ownerIdentityOnly: false,
    permissionKeys: permissions(
      'dashboard.view',
      'customers.list',
      'customers.view',
      'customers.users.view',
      'websites.list',
      'websites.view',
      'deployments.view',
      'automation.jobs.view',
      'alerts.view',
      'security.customer_access.manage',
    ),
    slug: 'support-representative',
  },
  {
    description:
      'Subscription plans, assignments, entitlements, and approved manual commercial status changes.',
    displayOrder: 90,
    name: 'Billing Manager',
    ownerIdentityOnly: false,
    permissionKeys: permissions(
      'dashboard.view',
      'dashboard.view_financials',
      'customers.list',
      'customers.view',
      'websites.list',
      'websites.view',
      'plans.view',
      'plans.edit',
      'subscriptions.view',
      'subscriptions.edit',
      'entitlements.view',
      'entitlements.override',
      'ai_usage.view',
      'ai_budget.site.view',
      'ai_budget.platform.view',
    ),
    slug: 'billing-manager',
  },
  {
    description: 'Read-only scoped reports, metrics, status, and audit evidence.',
    displayOrder: 100,
    name: 'Analyst / Read-Only Auditor',
    ownerIdentityOnly: false,
    permissionKeys: permissions(
      'dashboard.view',
      'customers.list',
      'customers.view',
      'websites.list',
      'websites.view',
      'websites.content.view',
      'domains.view',
      'deployments.view',
      'seo.view',
      'aio.view',
      'automation.jobs.view',
      'automation.schedules.view',
      'automation.workers.view',
      'analytics.view',
      'integrations.google.view',
      'plans.view',
      'subscriptions.view',
      'entitlements.view',
      'ai_usage.view',
      'ai_budget.site.view',
      'alerts.view',
      'security.audit.view',
      'backups.status.view',
    ),
    slug: 'analyst-read-only-auditor',
  },
] as const satisfies readonly OrapRoleTemplateDefinition[];
