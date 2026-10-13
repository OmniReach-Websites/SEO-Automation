ALTER TABLE integration_connections
  ADD COLUMN consented_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN consented_at timestamptz(3),
  ADD COLUMN token_expires_at timestamptz(3),
  ADD COLUMN refresh_failure_code varchar(80),
  ADD COLUMN collection_stopped_at timestamptz(3);

CREATE TABLE google_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash char(64) NOT NULL UNIQUE,
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  property_kind varchar(40) NOT NULL CHECK (property_kind IN ('search_console','ga4')),
  redirect_uri varchar(500) NOT NULL,
  encrypted_request bytea NOT NULL,
  key_version integer NOT NULL CHECK (key_version > 0),
  initiated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  scopes jsonb NOT NULL,
  expires_at timestamptz(3) NOT NULL,
  consumed_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE integration_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  provider varchar(40) NOT NULL CHECK (provider = 'google'),
  encrypted_payload bytea NOT NULL,
  key_version integer NOT NULL CHECK (key_version > 0),
  expires_at timestamptz(3),
  revoked_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX google_oauth_states_scope_expires_idx
  ON google_oauth_states (tenant_id, site_id, expires_at);
CREATE INDEX integration_credentials_scope_status_idx
  ON integration_credentials (tenant_id, site_id, revoked_at);

REVOKE ALL ON google_oauth_states, integration_credentials FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON google_oauth_states TO omnireach_platform;
GRANT SELECT, INSERT, UPDATE ON integration_credentials TO omnireach_platform, omnireach_worker;

ALTER TABLE google_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_oauth_states FORCE ROW LEVEL SECURITY;
ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_credentials FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_google_oauth_states ON google_oauth_states
  USING (pg_has_role(current_user, 'omnireach_platform', 'member'))
  WITH CHECK (pg_has_role(current_user, 'omnireach_platform', 'member'));

CREATE POLICY scoped_integration_credentials ON integration_credentials
  USING (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  )
  WITH CHECK (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  );

DROP POLICY tenant_scope_integration_connections ON integration_connections;
CREATE POLICY tenant_or_platform_integration_connections ON integration_connections
  USING (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  )
  WITH CHECK (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  );

DROP POLICY tenant_scope_metric_snapshots ON metric_snapshots;
CREATE POLICY tenant_or_platform_metric_snapshots ON metric_snapshots
  USING (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  )
  WITH CHECK (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  );

COMMENT ON TABLE google_oauth_states IS
  'Five-minute one-use Google OAuth/PKCE state. Request material is encrypted; plaintext verifier and provider tokens are never persisted.';
COMMENT ON TABLE integration_credentials IS
  'Versioned authenticated-encryption envelopes for provider tokens; customer/application roles have no direct access.';
