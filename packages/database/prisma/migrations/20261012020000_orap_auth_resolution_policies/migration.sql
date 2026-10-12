-- O02: allow the authentication transaction role to resolve effective ORAP
-- authorization read-only. No invitation, audit, credential, or session write
-- authority is added here.

GRANT SELECT ON
  permission_definitions, staff_roles, staff_role_versions, staff_role_permissions,
  staff_role_assignments, staff_resource_scopes
  TO omnireach_auth;

CREATE POLICY permission_definitions_auth_read_policy ON permission_definitions
  FOR SELECT TO omnireach_auth USING (true);
CREATE POLICY staff_roles_auth_read_policy ON staff_roles
  FOR SELECT TO omnireach_auth USING (true);
CREATE POLICY staff_role_versions_auth_read_policy ON staff_role_versions
  FOR SELECT TO omnireach_auth USING (true);
CREATE POLICY staff_role_permissions_auth_read_policy ON staff_role_permissions
  FOR SELECT TO omnireach_auth USING (true);
CREATE POLICY staff_role_assignments_auth_read_policy ON staff_role_assignments
  FOR SELECT TO omnireach_auth USING (true);
CREATE POLICY staff_resource_scopes_auth_read_policy ON staff_resource_scopes
  FOR SELECT TO omnireach_auth USING (true);

INSERT INTO schema_metadata (key, value)
VALUES ('orap_authorization_contract', to_jsonb('2-effective-resolution-ready'::text))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
