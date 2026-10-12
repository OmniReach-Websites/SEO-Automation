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
const staffOwnerSessionPolicyMigration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261012040000_orap_staff_owner_session_policy/migration.sql',
  ),
  'utf8',
);
const staffInvitationAcceptanceMigration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261012100000_staff_invitation_acceptance/migration.sql',
  ),
  'utf8',
);
const staffInvitationCatalogMigration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261012110000_staff_invitation_catalog_access/migration.sql',
  ),
  'utf8',
);
const ownerAccountEditorMigration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261012120000_owner_staff_account_editor/migration.sql',
  ),
  'utf8',
);
const invitationConsumptionGuardMigration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261012130000_staff_invitation_consumption_guard/migration.sql',
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

  it('limits the owner-session step-up exception to audited staff authority', () => {
    expect(staffOwnerSessionPolicyMigration).toContain(
      'DROP CONSTRAINT owner_permission_safeguard',
    );
    expect(staffOwnerSessionPolicyMigration).toContain("module = 'staff'");
    expect(staffOwnerSessionPolicyMigration).toContain('requires_reason');
    expect(staffOwnerSessionPolicyMigration).toContain("risk_level = 'critical'");
    expect(staffOwnerSessionPolicyMigration).toContain('requires_step_up OR');
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

  it('limits staff invitation acceptance to pending non-owner identities', () => {
    expect(staffInvitationAcceptanceMigration).toContain('staff_invitations_auth_accept_policy');
    expect(staffInvitationAcceptanceMigration).toContain("state = 'pending'");
    expect(staffInvitationAcceptanceMigration).toContain("state = 'accepted'");
    expect(staffInvitationAcceptanceMigration).toContain(
      "identity_kind IN ('platform_admin', 'staff')",
    );
    expect(staffInvitationAcceptanceMigration).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE)[^;]+staff_roles/isu,
    );
    expect(staffInvitationAcceptanceMigration).toContain('NOT role.owner_identity_only');
  });

  it('allows invitation acceptance to read but never mutate non-owner role catalog data', () => {
    expect(staffInvitationCatalogMigration).toContain(
      'GRANT SELECT ON staff_roles, staff_role_versions TO omnireach_auth',
    );
    expect(staffInvitationCatalogMigration).toContain('NOT owner_identity_only');
    expect(staffInvitationCatalogMigration).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE)[^;]+staff_roles/isu,
    );
  });

  it('consumes an invitation only after its complete non-owner authority state exists', () => {
    expect(invitationConsumptionGuardMigration).toContain('SECURITY DEFINER');
    expect(invitationConsumptionGuardMigration).toContain(
      "legacy.role IN ('platform_admin', 'staff')",
    );
    expect(invitationConsumptionGuardMigration).toContain(
      'assignment.role_version_id = invitation_record.role_version_id',
    );
    expect(invitationConsumptionGuardMigration).toContain("scope.scope_type = 'platform'");
    expect(invitationConsumptionGuardMigration).toContain(
      'GRANT EXECUTE ON FUNCTION accept_orap_staff_invitation',
    );
    expect(invitationConsumptionGuardMigration).toContain(
      'REVOKE UPDATE (state, accepted_at, accepted_user_id)',
    );
    expect(invitationConsumptionGuardMigration).toContain(
      'DROP POLICY staff_invitations_auth_update_policy',
    );
  });

  it('keeps owner password replacement behind a narrow audited function', () => {
    expect(ownerAccountEditorMigration).toContain('SECURITY DEFINER');
    expect(ownerAccountEditorMigration).toContain("legacy.role = 'platform_owner'");
    expect(ownerAccountEditorMigration).toContain("membership.status = 'active'");
    expect(ownerAccountEditorMigration).toContain("requested_password_hash !~ '^\\$argon2id\\$'");
    expect(ownerAccountEditorMigration).toContain("revoke_reason = 'orap_owner_account_updated'");
    expect(ownerAccountEditorMigration).toContain("'staff.account_updated'");
    expect(ownerAccountEditorMigration).not.toMatch(/password_hash[^;]+staff_access_audits/isu);
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
