-- Staff invitation acceptance validates the owner-selected non-owner role and
-- immutable role version while running as the restricted authentication role.
-- Expose only that read-only catalog surface; role creation and mutation remain
-- exclusive to the platform boundary.

GRANT SELECT ON staff_roles, staff_role_versions TO omnireach_auth;

CREATE POLICY staff_roles_auth_invitation_read_policy ON staff_roles
  FOR SELECT TO omnireach_auth
  USING (active AND NOT owner_identity_only);

CREATE POLICY staff_role_versions_auth_invitation_read_policy ON staff_role_versions
  FOR SELECT TO omnireach_auth
  USING (
    EXISTS (
      SELECT 1
        FROM staff_roles role
       WHERE role.id = role_id
         AND role.active
         AND NOT role.owner_identity_only
    )
  );

INSERT INTO schema_metadata (key, value)
VALUES ('orap_staff_invitation_catalog_access', to_jsonb('1-read-only-non-owner'::text))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
