-- O01: normalized ORAP staff authorization foundation.
-- This migration is forward-only and deliberately does not cut existing routes over to
-- the new policy evaluator. It preserves all identity, credential, factor, recovery,
-- challenge, and session records.

CREATE TABLE permission_definitions (
  key varchar(160) PRIMARY KEY,
  module varchar(80) NOT NULL,
  label varchar(160) NOT NULL,
  description varchar(1000) NOT NULL,
  risk_level varchar(20) NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  scope_type varchar(20) NOT NULL CHECK (scope_type IN ('platform','tenant','site','mixed')),
  is_owner_only boolean NOT NULL DEFAULT false,
  requires_step_up boolean NOT NULL DEFAULT false,
  requires_reason boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  compatibility_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  deprecated_at timestamptz(3),
  replacement_key varchar(160),
  CONSTRAINT permission_replacement_fk FOREIGN KEY (replacement_key)
    REFERENCES permission_definitions(key) ON DELETE RESTRICT,
  CONSTRAINT owner_permission_safeguard CHECK (
    NOT is_owner_only OR (requires_step_up AND requires_reason AND risk_level = 'critical')
  )
);
CREATE INDEX permission_definitions_module_idx
  ON permission_definitions(module, deprecated_at);

CREATE TABLE staff_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(100) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  description varchar(1000) NOT NULL,
  built_in boolean NOT NULL DEFAULT false,
  owner_identity_only boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  archived_at timestamptz(3),
  CONSTRAINT staff_role_archive_state CHECK ((archived_at IS NULL) = active)
);
CREATE INDEX staff_roles_active_order_idx ON staff_roles(active, display_order);

CREATE TABLE staff_role_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES staff_roles(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  name varchar(160) NOT NULL,
  description varchar(1000) NOT NULL,
  permission_count integer NOT NULL DEFAULT 0 CHECK (permission_count >= 0),
  change_reason varchar(500) NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (role_id, version),
  UNIQUE (role_id, id)
);

CREATE TABLE staff_role_permissions (
  role_version_id uuid NOT NULL REFERENCES staff_role_versions(id) ON DELETE RESTRICT,
  permission_key varchar(160) NOT NULL REFERENCES permission_definitions(key) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (role_version_id, permission_key)
);
CREATE INDEX staff_role_permissions_key_idx ON staff_role_permissions(permission_key);

CREATE OR REPLACE FUNCTION reject_owner_only_staff_role_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.permission_definitions definition
     WHERE definition.key = NEW.permission_key AND definition.is_owner_only
  ) THEN
    RAISE EXCEPTION 'owner-only capability cannot be assigned to a staff role'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION reject_owner_only_staff_role_permission() FROM PUBLIC;
CREATE TRIGGER staff_role_permissions_owner_only_guard
BEFORE INSERT OR UPDATE OF permission_key ON staff_role_permissions
FOR EACH ROW EXECUTE FUNCTION reject_owner_only_staff_role_permission();

CREATE TABLE orap_staff_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  identity_kind varchar(32) NOT NULL
    CHECK (identity_kind IN ('platform_owner','platform_admin','staff')),
  status varchar(32) NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending','active','disabled','archived')),
  job_title varchar(160),
  authorization_version integer NOT NULL DEFAULT 1 CHECK (authorization_version > 0),
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  disabled_at timestamptz(3),
  archived_at timestamptz(3),
  CONSTRAINT orap_staff_status_timestamps CHECK (
    (status <> 'disabled' OR disabled_at IS NOT NULL)
    AND (status <> 'archived' OR archived_at IS NOT NULL)
  )
);
CREATE INDEX orap_staff_kind_status_idx
  ON orap_staff_memberships(identity_kind, status);

-- Preserve the current account identity and role kind without touching authentication
-- material or sessions. Assignment grants are synchronized separately from the
-- source-defined catalog and remain unused until O02 performs the guarded cutover.
INSERT INTO orap_staff_memberships
  (user_id, identity_kind, status, created_at, updated_at, disabled_at)
SELECT user_id,
       CASE role
         WHEN 'platform_owner' THEN 'platform_owner'
         WHEN 'platform_admin' THEN 'platform_admin'
         ELSE 'staff'
       END,
       CASE WHEN active THEN 'active' ELSE 'disabled' END,
       created_at,
       updated_at,
       CASE WHEN active THEN NULL ELSE updated_at END
  FROM platform_memberships
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE staff_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_membership_id uuid NOT NULL REFERENCES orap_staff_memberships(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES staff_roles(id) ON DELETE RESTRICT,
  role_version_id uuid NOT NULL,
  primary_role boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  assigned_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at timestamptz(3) NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz(3),
  reason varchar(500) NOT NULL,
  CONSTRAINT staff_assignment_role_version_fk
    FOREIGN KEY (role_id, role_version_id)
    REFERENCES staff_role_versions(role_id, id) ON DELETE RESTRICT,
  CONSTRAINT staff_assignment_revocation_state CHECK (
    (active AND revoked_at IS NULL AND revoked_by IS NULL)
    OR (NOT active AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  )
);
CREATE INDEX staff_assignment_member_active_idx
  ON staff_role_assignments(staff_membership_id, active);
CREATE INDEX staff_assignment_role_active_idx ON staff_role_assignments(role_id, active);
CREATE UNIQUE INDEX staff_assignment_one_primary_idx
  ON staff_role_assignments(staff_membership_id) WHERE active AND primary_role;

CREATE TABLE staff_resource_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES staff_role_assignments(id) ON DELETE RESTRICT,
  scope_type varchar(20) NOT NULL CHECK (scope_type IN ('platform','tenant','site')),
  tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT staff_scope_shape CHECK (
    (scope_type = 'platform' AND tenant_id IS NULL AND site_id IS NULL)
    OR (scope_type = 'tenant' AND tenant_id IS NOT NULL AND site_id IS NULL)
    OR (scope_type = 'site' AND tenant_id IS NOT NULL AND site_id IS NOT NULL)
  ),
  CONSTRAINT staff_scope_site_fk FOREIGN KEY (tenant_id, site_id)
    REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE NULLS NOT DISTINCT (assignment_id, scope_type, tenant_id, site_id)
);
CREATE INDEX staff_resource_scope_target_idx ON staff_resource_scopes(tenant_id, site_id);

CREATE TABLE staff_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_email varchar(320) NOT NULL,
  display_name varchar(160) NOT NULL,
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  exact_host varchar(253) NOT NULL,
  role_id uuid NOT NULL REFERENCES staff_roles(id) ON DELETE RESTRICT,
  role_version_id uuid NOT NULL,
  scope_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  state varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','accepted','expired','revoked')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at timestamptz(3) NOT NULL,
  accepted_at timestamptz(3),
  accepted_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz(3),
  revoked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  resend_count integer NOT NULL DEFAULT 0 CHECK (resend_count >= 0),
  last_sent_at timestamptz(3),
  CONSTRAINT staff_invitation_role_version_fk
    FOREIGN KEY (role_id, role_version_id)
    REFERENCES staff_role_versions(role_id, id) ON DELETE RESTRICT,
  CONSTRAINT staff_invitation_terminal_state CHECK (
    (state = 'pending' AND accepted_at IS NULL AND accepted_user_id IS NULL AND revoked_at IS NULL)
    OR (state = 'accepted' AND accepted_at IS NOT NULL AND accepted_user_id IS NOT NULL)
    OR (state = 'expired' AND accepted_at IS NULL AND accepted_user_id IS NULL)
    OR (state = 'revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  )
);
CREATE INDEX staff_invitations_email_state_idx
  ON staff_invitations(normalized_email, state);
CREATE INDEX staff_invitations_expiry_state_idx ON staff_invitations(expires_at, state);
CREATE UNIQUE INDEX staff_invitations_one_pending_email_idx
  ON staff_invitations(normalized_email) WHERE state = 'pending';

CREATE TABLE staff_access_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  target_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  target_role_id uuid REFERENCES staff_roles(id) ON DELETE RESTRICT,
  action varchar(160) NOT NULL,
  decision varchar(20) NOT NULL CHECK (decision IN ('allowed','denied')),
  capability_key varchar(160) REFERENCES permission_definitions(key) ON DELETE RESTRICT,
  tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid,
  reason varchar(500),
  trace_id varchar(128) NOT NULL,
  before jsonb,
  after jsonb,
  metadata jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT staff_access_audit_site_fk FOREIGN KEY (tenant_id, site_id)
    REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT staff_access_audit_scope_pair CHECK (site_id IS NULL OR tenant_id IS NOT NULL)
);
CREATE INDEX staff_access_audit_actor_idx ON staff_access_audits(actor_user_id, created_at);
CREATE INDEX staff_access_audit_target_idx ON staff_access_audits(target_user_id, created_at);
CREATE INDEX staff_access_audit_capability_idx
  ON staff_access_audits(capability_key, created_at);
CREATE INDEX staff_access_audit_scope_idx ON staff_access_audits(tenant_id, site_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  permission_definitions, staff_roles, staff_role_versions, staff_role_permissions,
  orap_staff_memberships, staff_role_assignments, staff_resource_scopes, staff_invitations
  TO omnireach_platform;
GRANT SELECT, INSERT ON staff_access_audits TO omnireach_platform;
GRANT SELECT ON orap_staff_memberships TO omnireach_auth;

ALTER TABLE permission_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_role_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_role_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE orap_staff_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE orap_staff_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_role_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_resource_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_resource_scopes FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_access_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_access_audits FORCE ROW LEVEL SECURITY;

CREATE POLICY permission_definitions_platform_policy ON permission_definitions
  FOR ALL TO omnireach_platform USING (true) WITH CHECK (true);
CREATE POLICY staff_roles_platform_policy ON staff_roles
  FOR ALL TO omnireach_platform USING (true) WITH CHECK (true);
CREATE POLICY staff_role_versions_platform_policy ON staff_role_versions
  FOR ALL TO omnireach_platform USING (true) WITH CHECK (true);
CREATE POLICY staff_role_permissions_platform_policy ON staff_role_permissions
  FOR ALL TO omnireach_platform USING (true) WITH CHECK (true);
CREATE POLICY orap_staff_platform_policy ON orap_staff_memberships
  FOR ALL TO omnireach_platform USING (true) WITH CHECK (true);
CREATE POLICY orap_staff_auth_read_policy ON orap_staff_memberships
  FOR SELECT TO omnireach_auth USING (true);
CREATE POLICY staff_role_assignments_platform_policy ON staff_role_assignments
  FOR ALL TO omnireach_platform USING (true) WITH CHECK (true);
CREATE POLICY staff_resource_scopes_platform_policy ON staff_resource_scopes
  FOR ALL TO omnireach_platform USING (true) WITH CHECK (true);
CREATE POLICY staff_invitations_platform_policy ON staff_invitations
  FOR ALL TO omnireach_platform USING (true) WITH CHECK (true);
CREATE POLICY staff_access_audits_platform_select ON staff_access_audits
  FOR SELECT TO omnireach_platform USING (true);
CREATE POLICY staff_access_audits_platform_insert ON staff_access_audits
  FOR INSERT TO omnireach_platform WITH CHECK (true);

-- Catalog synchronization records this only after the complete source catalog and role
-- template set have been written successfully.
INSERT INTO schema_metadata (key, value)
VALUES ('orap_authorization_contract', to_jsonb('1-schema-ready'::text))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
