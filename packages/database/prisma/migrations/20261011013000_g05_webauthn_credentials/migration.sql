-- Auth Contract v3 introduces RP-scoped WebAuthn credentials. The tables are
-- intentionally inert until a later release exposes enrollment or assertion routes.
-- Authentication code that only understands contract v2 must fail closed once this
-- durable state can exist.

CREATE TABLE webauthn_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tenant_id uuid,
  site_id uuid,
  rp_id varchar(253) NOT NULL,
  user_handle bytea NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT webauthn_scopes_site_scope_check CHECK (
    (tenant_id IS NULL AND site_id IS NULL)
    OR (tenant_id IS NOT NULL AND site_id IS NOT NULL)
  ),
  CONSTRAINT webauthn_scopes_site_fk
    FOREIGN KEY (tenant_id, site_id)
    REFERENCES sites(tenant_id, id)
    MATCH FULL
    ON DELETE RESTRICT,
  CONSTRAINT webauthn_scopes_rp_id_check CHECK (
    rp_id = lower(rp_id)
    AND length(rp_id) BETWEEN 1 AND 253
    AND rp_id ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
    AND rp_id !~ '\.\.'
  ),
  CONSTRAINT webauthn_scopes_user_handle_check CHECK (octet_length(user_handle) = 64),
  CONSTRAINT webauthn_scopes_rp_user_handle_unique UNIQUE (rp_id, user_handle)
);

-- NULLS NOT DISTINCT makes a platform scope (whose tenant/site are NULL) unique in
-- the same way as a customer site's scope.
CREATE UNIQUE INDEX webauthn_scopes_user_rp_site_unique
  ON webauthn_scopes (user_id, rp_id, tenant_id, site_id) NULLS NOT DISTINCT;
CREATE INDEX webauthn_scopes_site_idx
  ON webauthn_scopes (tenant_id, site_id, rp_id)
  WHERE tenant_id IS NOT NULL AND site_id IS NOT NULL;

CREATE TABLE webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id uuid NOT NULL REFERENCES webauthn_scopes(id) ON DELETE RESTRICT,
  credential_id bytea NOT NULL,
  public_key bytea NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0,
  transports varchar(32)[] NOT NULL DEFAULT '{}',
  device_type varchar(16) NOT NULL,
  backup_eligible boolean NOT NULL,
  backed_up boolean NOT NULL,
  name varchar(80) NOT NULL,
  verified_at timestamptz(3) NOT NULL,
  last_used_at timestamptz(3),
  revoked_at timestamptz(3),
  revoke_reason varchar(160),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT webauthn_credentials_scope_credential_unique UNIQUE (scope_id, credential_id),
  CONSTRAINT webauthn_credentials_id_size_check CHECK (
    octet_length(credential_id) BETWEEN 1 AND 1023
  ),
  CONSTRAINT webauthn_credentials_public_key_size_check CHECK (
    octet_length(public_key) BETWEEN 1 AND 4096
  ),
  CONSTRAINT webauthn_credentials_sign_count_check CHECK (
    sign_count BETWEEN 0 AND 4294967295
  ),
  CONSTRAINT webauthn_credentials_transports_check CHECK (
    array_position(transports, NULL) IS NULL AND cardinality(transports) <= 8
  ),
  CONSTRAINT webauthn_credentials_device_type_check CHECK (
    device_type IN ('singleDevice', 'multiDevice')
  ),
  CONSTRAINT webauthn_credentials_backup_flags_check CHECK (
    (device_type = 'multiDevice') = backup_eligible
    AND (NOT backed_up OR backup_eligible)
  ),
  CONSTRAINT webauthn_credentials_name_check CHECK (
    length(btrim(name)) BETWEEN 1 AND 80
  ),
  CONSTRAINT webauthn_credentials_revocation_check CHECK (
    (revoked_at IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);
CREATE INDEX webauthn_credentials_active_scope_idx
  ON webauthn_credentials (scope_id, created_at)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION protect_webauthn_scope_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.site_id IS DISTINCT FROM OLD.site_id
     OR NEW.rp_id IS DISTINCT FROM OLD.rp_id
     OR NEW.user_handle IS DISTINCT FROM OLD.user_handle
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'WebAuthn scope identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION protect_webauthn_scope_identity() FROM PUBLIC;

CREATE TRIGGER webauthn_scopes_protect_identity
BEFORE UPDATE ON webauthn_scopes
FOR EACH ROW EXECUTE FUNCTION protect_webauthn_scope_identity();

CREATE OR REPLACE FUNCTION protect_webauthn_credential_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.scope_id IS DISTINCT FROM OLD.scope_id
     OR NEW.credential_id IS DISTINCT FROM OLD.credential_id
     OR NEW.public_key IS DISTINCT FROM OLD.public_key
     OR NEW.device_type IS DISTINCT FROM OLD.device_type
     OR NEW.backup_eligible IS DISTINCT FROM OLD.backup_eligible
     OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'WebAuthn credential identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.sign_count < OLD.sign_count THEN
    RAISE EXCEPTION 'WebAuthn signature counter cannot decrease' USING ERRCODE = '23514';
  END IF;
  IF OLD.revoked_at IS NOT NULL
     AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
          OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason) THEN
    RAISE EXCEPTION 'WebAuthn credential revocation evidence is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION protect_webauthn_credential_identity() FROM PUBLIC;

CREATE TRIGGER webauthn_credentials_protect_identity
BEFORE UPDATE ON webauthn_credentials
FOR EACH ROW EXECUTE FUNCTION protect_webauthn_credential_identity();

CREATE OR REPLACE FUNCTION bump_webauthn_account_authentication_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  affected_user_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at THEN
    RETURN NEW;
  END IF;
  SELECT scope.user_id INTO STRICT affected_user_id
    FROM public.webauthn_scopes scope
   WHERE scope.id = NEW.scope_id;
  UPDATE public.account_authentication_policies
     SET auth_state_version = auth_state_version + 1,
         updated_at = now()
   WHERE user_id = affected_user_id;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION bump_webauthn_account_authentication_state() FROM PUBLIC;

CREATE TRIGGER webauthn_credentials_bump_authentication_state
AFTER INSERT OR UPDATE OF revoked_at ON webauthn_credentials
FOR EACH ROW EXECUTE FUNCTION bump_webauthn_account_authentication_state();

REVOKE ALL ON webauthn_scopes, webauthn_credentials FROM PUBLIC;
REVOKE ALL ON webauthn_scopes, webauthn_credentials
  FROM omnireach_app, omnireach_platform, omnireach_worker;
GRANT SELECT, INSERT ON webauthn_scopes TO omnireach_auth;
GRANT SELECT, INSERT ON webauthn_credentials TO omnireach_auth;
GRANT UPDATE (name, sign_count, backed_up, last_used_at, revoked_at, revoke_reason, updated_at)
  ON webauthn_credentials TO omnireach_auth;

ALTER TABLE webauthn_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_scopes FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_contract_v3_webauthn_scopes ON webauthn_scopes
  FOR ALL
  USING (
    pg_has_role(current_user, 'omnireach_auth', 'member')
    AND current_setting('app.authentication_contract_version', true) = '3'
  )
  WITH CHECK (
    pg_has_role(current_user, 'omnireach_auth', 'member')
    AND current_setting('app.authentication_contract_version', true) = '3'
  );

ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_contract_v3_webauthn_credentials ON webauthn_credentials
  FOR ALL
  USING (
    pg_has_role(current_user, 'omnireach_auth', 'member')
    AND current_setting('app.authentication_contract_version', true) = '3'
  )
  WITH CHECK (
    pg_has_role(current_user, 'omnireach_auth', 'member')
    AND current_setting('app.authentication_contract_version', true) = '3'
  );

-- Contract v2 cannot safely mint or recover sessions after RP-scoped credentials may
-- exist. Replace both restrictive policies atomically with the v3 gate.
DROP POLICY authentication_contract_v2_sessions ON sessions;
CREATE POLICY authentication_contract_v3_sessions ON sessions
  AS RESTRICTIVE
  FOR ALL
  USING (
    NOT pg_has_role(current_user, 'omnireach_auth', 'member')
    OR current_setting('app.authentication_contract_version', true) = '3'
  )
  WITH CHECK (
    NOT pg_has_role(current_user, 'omnireach_auth', 'member')
    OR current_setting('app.authentication_contract_version', true) = '3'
  );

DROP POLICY authentication_contract_v2_password_recovery ON password_recovery_tokens;
CREATE POLICY authentication_contract_v3_password_recovery ON password_recovery_tokens
  AS RESTRICTIVE
  FOR ALL
  USING (
    NOT pg_has_role(current_user, 'omnireach_auth', 'member')
    OR current_setting('app.authentication_contract_version', true) = '3'
  )
  WITH CHECK (
    NOT pg_has_role(current_user, 'omnireach_auth', 'member')
    OR current_setting('app.authentication_contract_version', true) = '3'
  );
