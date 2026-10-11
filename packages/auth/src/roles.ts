export const roles = [
  'platform_owner',
  'platform_admin',
  'staff',
  'customer_owner',
  'customer_editor',
  'customer_viewer',
] as const;

export type Role = (typeof roles)[number];

export const platformRoles = new Set<Role>(['platform_owner', 'platform_admin', 'staff']);

export type Action =
  | 'platform.manage'
  | 'tenant.manage'
  | 'site.manage'
  | 'customer.manage'
  | 'content.read'
  | 'content.edit'
  | 'content.publish'
  | 'fact.edit';

const grants: Readonly<Record<Role, ReadonlySet<Action>>> = {
  platform_owner: new Set<Action>([
    'platform.manage',
    'tenant.manage',
    'site.manage',
    'customer.manage',
    'content.read',
    'content.edit',
    'content.publish',
    'fact.edit',
  ]),
  platform_admin: new Set<Action>([
    'tenant.manage',
    'site.manage',
    'customer.manage',
    'content.read',
    'content.edit',
    'content.publish',
    'fact.edit',
  ]),
  staff: new Set<Action>([
    'tenant.manage',
    'site.manage',
    'customer.manage',
    'content.read',
    'content.edit',
    'content.publish',
    'fact.edit',
  ]),
  customer_owner: new Set<Action>([
    'customer.manage',
    'content.read',
    'content.edit',
    'content.publish',
    'fact.edit',
  ]),
  customer_editor: new Set<Action>(['content.read', 'content.edit']),
  customer_viewer: new Set<Action>(['content.read']),
};

export function hasPermission(
  role: Role,
  action: Action,
  siteGrants: ReadonlySet<Action> = new Set(),
): boolean {
  if (role === 'customer_editor' && action === 'content.publish') return siteGrants.has(action);
  return grants[role].has(action);
}

export function requiresMfa(role: Role): boolean {
  return platformRoles.has(role);
}
