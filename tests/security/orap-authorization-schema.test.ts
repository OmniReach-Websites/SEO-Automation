import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { orapCapabilityCatalog } from '@omnireach/auth';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261012010000_orap_staff_authorization_foundation/migration.sql',
  ),
  'utf8',
);
const resolutionMigration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261012020000_orap_auth_resolution_policies/migration.sql',
  ),
  'utf8',
);
const directoryProjectionMigration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261012030000_orap_staff_directory_projection/migration.sql',
  ),
  'utf8',
);
const schema = readFileSync(resolve(root, 'packages/database/prisma/schema.prisma'), 'utf8');

describe('ORAP authorization schema foundation', () => {
  it('contains every normalized staff authorization model', () => {
    for (const model of [
      'OrapStaffMembership',
      'StaffRole',
      'PermissionDefinition',
      'StaffRolePermission',
      'StaffRoleAssignment',
      'StaffResourceScope',
      'StaffInvitation',
      'StaffAccessAudit',
      'StaffRoleVersion',
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }
  });

  it('preserves existing platform identities and authentication state', () => {
    expect(migration).toContain('FROM platform_memberships');
    expect(migration).toContain('ON CONFLICT (user_id) DO NOTHING');
    expect(migration).not.toMatch(
      /(?:DELETE|TRUNCATE)\s+(?:FROM\s+)?(?:users|credentials|sessions|mfa_factors|webauthn_credentials)/iu,
    );
  });

  it('forces RLS and least privilege across every new authorization table', () => {
    for (const table of [
      'permission_definitions',
      'staff_roles',
      'staff_role_versions',
      'staff_role_permissions',
      'orap_staff_memberships',
      'staff_role_assignments',
      'staff_resource_scopes',
      'staff_invitations',
      'staff_access_audits',
    ]) {
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).not.toMatch(/GRANT\s+UPDATE[^;]+staff_access_audits/isu);
    expect(migration).not.toMatch(/GRANT\s+DELETE[^;]+staff_access_audits/isu);
  });

  it('enforces owner-only capability and resource-scope invariants in PostgreSQL', () => {
    expect(migration).toContain('staff_role_permissions_owner_only_guard');
    expect(migration).toContain("scope_type = 'platform'");
    expect(migration).toContain("scope_type = 'tenant'");
    expect(migration).toContain("scope_type = 'site'");
    expect(migration).toContain('UNIQUE NULLS NOT DISTINCT');
    expect(orapCapabilityCatalog.filter(({ ownerOnly }) => ownerOnly).length).toBeGreaterThan(8);
  });

  it('gives the authentication role read-only effective-authorization access', () => {
    expect(resolutionMigration).toMatch(/GRANT SELECT ON[\s\S]+TO omnireach_auth;/u);
    expect(resolutionMigration).not.toMatch(/GRANT\s+(?:INSERT|UPDATE|DELETE)/u);
    expect(resolutionMigration).not.toMatch(/staff_invitations|staff_access_audits/u);
    for (const policy of [
      'permission_definitions_auth_read_policy',
      'staff_roles_auth_read_policy',
      'staff_role_versions_auth_read_policy',
      'staff_role_permissions_auth_read_policy',
      'staff_role_assignments_auth_read_policy',
      'staff_resource_scopes_auth_read_policy',
    ]) {
      expect(resolutionMigration).toContain(policy);
    }
  });

  it('exposes only non-secret authentication posture to the owner staff directory', () => {
    expect(directoryProjectionMigration).toContain('orap_staff_directory_auth_status');
    expect(directoryProjectionMigration).toContain('security_barrier = true');
    expect(directoryProjectionMigration).toContain(
      'GRANT SELECT ON orap_staff_directory_auth_status TO omnireach_platform',
    );
    expect(directoryProjectionMigration).not.toMatch(
      /(?:encrypted_secret|public_key|credential_id|token_hash|recovery_code)/u,
    );
  });
});
