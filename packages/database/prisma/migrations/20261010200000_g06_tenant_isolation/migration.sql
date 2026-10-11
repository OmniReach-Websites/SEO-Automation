DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnireach_app') THEN
    CREATE ROLE omnireach_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnireach_worker') THEN
    CREATE ROLE omnireach_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnireach_platform') THEN
    CREATE ROLE omnireach_platform NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnireach_auth') THEN
    CREATE ROLE omnireach_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO omnireach_app, omnireach_auth, omnireach_worker, omnireach_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, sites, domains, memberships, audit_events,
  sessions TO omnireach_app;
GRANT SELECT, INSERT, UPDATE ON sites, domains, memberships, audit_events, sessions TO omnireach_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, tenants, sites, domains, memberships, audit_events,
  credentials, sessions, password_recovery_tokens, mfa_factors, mfa_recovery_codes, owner_bootstrap, platform_memberships
  TO omnireach_platform;
GRANT SELECT, INSERT, UPDATE ON users, credentials, sessions, password_recovery_tokens,
  mfa_factors, mfa_recovery_codes, owner_bootstrap, platform_memberships, memberships, domains, sites
  TO omnireach_auth;
GRANT INSERT ON audit_events TO omnireach_auth;

ALTER TABLE platform_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY own_or_platform_memberships ON platform_memberships
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR pg_has_role(current_user, 'omnireach_auth', 'member')
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  )
  WITH CHECK (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR pg_has_role(current_user, 'omnireach_auth', 'member')
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  );

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_tenants ON tenants
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR pg_has_role(current_user, 'omnireach_platform', 'member'))
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR pg_has_role(current_user, 'omnireach_platform', 'member'));

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_sites ON sites
  USING ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_auth', 'member') OR pg_has_role(current_user, 'omnireach_platform', 'member'))
  WITH CHECK ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_auth', 'member') OR pg_has_role(current_user, 'omnireach_platform', 'member'));

ALTER TABLE domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE domains FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_domains ON domains
  USING ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_auth', 'member') OR pg_has_role(current_user, 'omnireach_platform', 'member'))
  WITH CHECK ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_auth', 'member') OR pg_has_role(current_user, 'omnireach_platform', 'member'));

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_memberships ON memberships
  USING ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_auth', 'member') OR pg_has_role(current_user, 'omnireach_platform', 'member'))
  WITH CHECK ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_auth', 'member') OR pg_has_role(current_user, 'omnireach_platform', 'member'));

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_audit_events ON audit_events
  USING ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member'))
  WITH CHECK ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_auth', 'member') OR pg_has_role(current_user, 'omnireach_platform', 'member'));

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_sessions ON sessions
  USING (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid
      AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_auth', 'member')
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  )
  WITH CHECK (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid
      AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_auth', 'member')
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  );

ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY own_or_auth_credentials ON credentials
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR pg_has_role(current_user, 'omnireach_auth', 'member')
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  )
  WITH CHECK (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR pg_has_role(current_user, 'omnireach_auth', 'member')
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  );

ALTER TABLE password_recovery_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_recovery_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY own_recovery_tokens ON password_recovery_tokens
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid OR pg_has_role(current_user, 'omnireach_auth', 'member'))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid OR pg_has_role(current_user, 'omnireach_auth', 'member'));

ALTER TABLE mfa_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_factors FORCE ROW LEVEL SECURITY;
CREATE POLICY own_mfa_factors ON mfa_factors
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid OR pg_has_role(current_user, 'omnireach_auth', 'member'))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid OR pg_has_role(current_user, 'omnireach_auth', 'member'));

ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_recovery_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY own_mfa_recovery_codes ON mfa_recovery_codes
  USING (
    EXISTS (
      SELECT 1 FROM mfa_factors
      WHERE mfa_factors.id = mfa_recovery_codes.factor_id
        AND mfa_factors.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
    OR pg_has_role(current_user, 'omnireach_auth', 'member')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM mfa_factors
      WHERE mfa_factors.id = mfa_recovery_codes.factor_id
        AND mfa_factors.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
    OR pg_has_role(current_user, 'omnireach_auth', 'member')
  );

ALTER TABLE owner_bootstrap ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_bootstrap FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_or_platform_owner_bootstrap ON owner_bootstrap
  USING (
    pg_has_role(current_user, 'omnireach_auth', 'member')
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  )
  WITH CHECK (
    pg_has_role(current_user, 'omnireach_auth', 'member')
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  );
