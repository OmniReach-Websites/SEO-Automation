CREATE TABLE customer_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  normalized_email varchar(320) NOT NULL,
  role varchar(64) NOT NULL CHECK (role IN ('customer_owner', 'customer_editor', 'customer_viewer')),
  token_hash char(64) NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at timestamptz(3) NOT NULL,
  accepted_at timestamptz(3),
  revoked_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  CHECK (normalized_email = lower(normalized_email))
);

CREATE UNIQUE INDEX customer_invitations_one_active_idx
  ON customer_invitations (site_id, normalized_email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX customer_invitations_expiry_idx
  ON customer_invitations (tenant_id, site_id, expires_at);

GRANT SELECT, INSERT, UPDATE ON customer_invitations TO omnireach_app, omnireach_auth, omnireach_platform;
ALTER TABLE customer_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_customer_invitations ON customer_invitations
  USING (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_auth', 'member')
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  )
  WITH CHECK (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_auth', 'member')
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  );
