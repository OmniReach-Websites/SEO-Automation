-- Allow the authentication boundary to consume an owner-issued ORAP staff
-- invitation. The auth role cannot create invitations, choose roles, or update
-- existing staff authority; it can only accept a pending token prepared by the
-- Platform Owner workflow.

GRANT SELECT ON staff_invitations TO omnireach_auth;
GRANT UPDATE (state, accepted_at, accepted_user_id) ON staff_invitations
  TO omnireach_auth;
GRANT INSERT ON orap_staff_memberships, staff_role_assignments, staff_resource_scopes
  TO omnireach_auth;

CREATE POLICY staff_invitations_auth_accept_policy ON staff_invitations
  FOR SELECT TO omnireach_auth
  USING (state = 'pending' AND expires_at > now());

CREATE POLICY staff_invitations_auth_update_policy ON staff_invitations
  FOR UPDATE TO omnireach_auth
  USING (state = 'pending' AND expires_at > now())
  WITH CHECK (
    state = 'accepted'
    AND accepted_at IS NOT NULL
    AND accepted_user_id IS NOT NULL
    AND revoked_at IS NULL
    AND revoked_by IS NULL
  );

CREATE POLICY orap_staff_auth_accept_policy ON orap_staff_memberships
  FOR INSERT TO omnireach_auth
  WITH CHECK (
    status = 'active'
    AND identity_kind IN ('platform_admin', 'staff')
    AND EXISTS (
      SELECT 1 FROM platform_memberships owner_membership
       WHERE owner_membership.user_id = created_by
         AND owner_membership.role = 'platform_owner'
         AND owner_membership.active
    )
  );

CREATE POLICY staff_assignments_auth_accept_policy ON staff_role_assignments
  FOR INSERT TO omnireach_auth
  WITH CHECK (
    active
    AND primary_role
    AND revoked_by IS NULL
    AND revoked_at IS NULL
    AND assigned_by IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM staff_roles role
       WHERE role.id = role_id
         AND role.active
         AND NOT role.owner_identity_only
    )
  );

CREATE POLICY staff_scopes_auth_accept_policy ON staff_resource_scopes
  FOR INSERT TO omnireach_auth
  WITH CHECK (
    scope_type = 'platform'
    AND tenant_id IS NULL
    AND site_id IS NULL
    AND created_by IS NOT NULL
  );

INSERT INTO schema_metadata (key, value)
VALUES ('orap_staff_invitation_acceptance', to_jsonb('1-owner-issued-token'::text))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
