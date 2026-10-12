-- Introduce account-level verification policy without rewriting the historical G05/G06
-- migrations. Existing TOTP and factor-scoped recovery data remains for preservation,
-- but authentication transactions must opt into contract version 2. An application
-- artifact that predates this migration therefore fails closed instead of silently
-- bypassing account policy, exact-host recovery, or session-idle enforcement.

CREATE TABLE account_authentication_policies (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  second_step_requirement varchar(16) NOT NULL DEFAULT 'optional'
    CHECK (second_step_requirement IN ('optional', 'required')),
  email_code_enabled boolean NOT NULL DEFAULT false,
  preferred_method varchar(32)
    CHECK (preferred_method IN ('email_code', 'totp', 'webauthn')),
  auth_state_version bigint NOT NULL DEFAULT 1 CHECK (auth_state_version > 0),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (preferred_method <> 'email_code' OR email_code_enabled),
  CONSTRAINT account_authentication_policies_email_requires_second_step CHECK (
    NOT email_code_enabled OR second_step_requirement = 'required'
  )
);

-- Reject replay of an already accepted TOTP time-step across separate challenges.
ALTER TABLE mfa_factors
  ADD COLUMN last_used_counter bigint,
  ADD CONSTRAINT mfa_factors_last_used_counter_check CHECK (
    last_used_counter IS NULL OR last_used_counter >= 0
  );

-- Preserve an already-enrolled customer's stronger posture, require verification for
-- every active platform identity, and make email code available to platform identities.
INSERT INTO account_authentication_policies
  (user_id, second_step_requirement, email_code_enabled, preferred_method)
SELECT
  u.id,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM platform_memberships pm
       WHERE pm.user_id = u.id AND pm.active
    ) OR EXISTS (
      SELECT 1 FROM mfa_factors mf
       WHERE mf.user_id = u.id AND mf.kind = 'totp'
         AND mf.verified_at IS NOT NULL AND mf.revoked_at IS NULL
    ) THEN 'required'
    ELSE 'optional'
  END,
  CASE
    -- Preserve TOTP as the only enabled second step for already-enrolled platform
    -- accounts. Email delivery is not available until the provider is activated.
    WHEN EXISTS (
      SELECT 1 FROM mfa_factors mf
       WHERE mf.user_id = u.id AND mf.kind = 'totp'
         AND mf.verified_at IS NOT NULL AND mf.revoked_at IS NULL
    ) THEN false
    WHEN EXISTS (
      SELECT 1 FROM platform_memberships pm
       WHERE pm.user_id = u.id AND pm.active
    ) THEN true
    ELSE false
  END,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM mfa_factors mf
       WHERE mf.user_id = u.id AND mf.kind = 'totp'
         AND mf.verified_at IS NOT NULL AND mf.revoked_at IS NULL
    ) THEN 'totp'
    WHEN EXISTS (
      SELECT 1 FROM platform_memberships pm
       WHERE pm.user_id = u.id AND pm.active
    ) THEN 'email_code'
    ELSE NULL
  END
FROM users u
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE account_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_version integer NOT NULL DEFAULT 1 CHECK (set_version > 0),
  code_hash char(64) NOT NULL UNIQUE,
  source_factor_id uuid REFERENCES mfa_factors(id) ON DELETE SET NULL,
  used_at timestamptz(3),
  revoked_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX account_recovery_codes_user_active_idx
  ON account_recovery_codes (user_id, set_version, created_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX account_recovery_codes_source_factor_idx
  ON account_recovery_codes (source_factor_id)
  WHERE source_factor_id IS NOT NULL;

-- Copy rather than move legacy rows. A revoked factor cannot yield an active account
-- recovery code, and used codes remain used after the migration.
INSERT INTO account_recovery_codes
  (id, user_id, code_hash, source_factor_id, used_at, revoked_at, created_at)
SELECT
  legacy.id,
  factor.user_id,
  legacy.code_hash,
  legacy.factor_id,
  legacy.used_at,
  factor.revoked_at,
  legacy.created_at
FROM mfa_recovery_codes legacy
JOIN mfa_factors factor ON factor.id = legacy.factor_id
ON CONFLICT (id) DO NOTHING;

ALTER TABLE sessions
  ADD COLUMN authentication_method varchar(32),
  ADD COLUMN authentication_assurance varchar(16),
  ADD COLUMN verified_at timestamptz(3),
  ADD COLUMN recovery_restricted boolean NOT NULL DEFAULT false;

-- Historical rows cannot be proven to have a stronger method because the old schema
-- did not persist it. Backfill conservatively so upgraded code can demand a new step-up.
UPDATE sessions
   SET authentication_method = 'password',
       authentication_assurance = 'basic'
 WHERE authentication_method IS NULL OR authentication_assurance IS NULL;

-- A legacy session has no proof that the newly required second step was completed.
-- Revoke it during the upgrade so both the new release and a code rollback fail closed.
UPDATE sessions session
   SET revoked_at = COALESCE(session.revoked_at, now()),
       revoke_reason = COALESCE(session.revoke_reason, 'authentication-policy-upgrade')
  FROM account_authentication_policies policy
 WHERE policy.user_id = session.user_id
   AND policy.second_step_requirement = 'required'
   AND session.revoked_at IS NULL;

ALTER TABLE sessions
  ALTER COLUMN authentication_method SET DEFAULT 'password',
  ALTER COLUMN authentication_method SET NOT NULL,
  ALTER COLUMN authentication_assurance SET DEFAULT 'basic',
  ALTER COLUMN authentication_assurance SET NOT NULL,
  ADD CONSTRAINT sessions_authentication_method_check CHECK (
    authentication_method IN ('password', 'email_code', 'totp', 'webauthn', 'recovery_code')
  ),
  ADD CONSTRAINT sessions_authentication_assurance_check CHECK (
    authentication_assurance IN ('basic', 'baseline', 'strong', 'recovery')
  ),
  ADD CONSTRAINT sessions_authentication_method_assurance_check CHECK (
    (authentication_method = 'password' AND authentication_assurance = 'basic'
      AND verified_at IS NULL AND NOT recovery_restricted)
    OR (authentication_method = 'email_code' AND authentication_assurance = 'baseline'
      AND verified_at IS NOT NULL AND NOT recovery_restricted)
    OR (authentication_method IN ('totp', 'webauthn') AND authentication_assurance = 'strong'
      AND verified_at IS NOT NULL AND NOT recovery_restricted)
    OR (authentication_method = 'recovery_code' AND authentication_assurance = 'recovery'
      AND verified_at IS NOT NULL AND recovery_restricted)
  );

CREATE OR REPLACE FUNCTION enforce_required_session_assurance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.revoked_at IS NULL
     AND NEW.authentication_assurance = 'basic'
     AND EXISTS (
       SELECT 1
         FROM public.account_authentication_policies policy
        WHERE policy.user_id = NEW.user_id
          AND policy.second_step_requirement = 'required'
     ) THEN
    RAISE EXCEPTION 'required account policy cannot create a basic session'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION enforce_required_session_assurance() FROM PUBLIC;

CREATE TRIGGER sessions_require_policy_assurance
BEFORE INSERT OR UPDATE OF user_id, authentication_assurance, revoked_at ON sessions
FOR EACH ROW EXECUTE FUNCTION enforce_required_session_assurance();

-- Earlier application artifacts do not understand assurance metadata or the idle
-- boundary. Restrict authentication-role access to transactions that explicitly opt
-- into this schema contract; other scoped roles retain their existing policies.
CREATE POLICY authentication_contract_v2_sessions ON sessions
  AS RESTRICTIVE
  FOR ALL
  USING (
    NOT pg_has_role(current_user, 'omnireach_auth', 'member')
    OR current_setting('app.authentication_contract_version', true) = '2'
  )
  WITH CHECK (
    NOT pg_has_role(current_user, 'omnireach_auth', 'member')
    OR current_setting('app.authentication_contract_version', true) = '2'
  );

-- Historical recovery tokens were not host-bound, so there is no safe value to
-- infer. Leave them NULL; upgraded authentication code only issues and accepts
-- tokens with an exact normalized host, making old unbound tokens unusable.
ALTER TABLE password_recovery_tokens
  ADD COLUMN host varchar(253),
  ADD CONSTRAINT password_recovery_tokens_host_check CHECK (
    host IS NULL OR (host = lower(host) AND host !~ '[:/]')
  );

-- Historical unbound tokens cannot be safely completed and are invalidated. Retain
-- their rows for audit/history, but require every newly active token to be host-bound.
UPDATE password_recovery_tokens
   SET used_at = now()
 WHERE host IS NULL AND used_at IS NULL;

ALTER TABLE password_recovery_tokens
  ADD CONSTRAINT active_password_recovery_tokens_require_host CHECK (
    host IS NOT NULL OR used_at IS NOT NULL
  );

CREATE POLICY authentication_contract_v2_password_recovery ON password_recovery_tokens
  AS RESTRICTIVE
  FOR ALL
  USING (
    NOT pg_has_role(current_user, 'omnireach_auth', 'member')
    OR current_setting('app.authentication_contract_version', true) = '2'
  )
  WITH CHECK (
    NOT pg_has_role(current_user, 'omnireach_auth', 'member')
    OR current_setting('app.authentication_contract_version', true) = '2'
  );

CREATE OR REPLACE FUNCTION create_default_account_authentication_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.account_authentication_policies (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION create_default_account_authentication_policy() FROM PUBLIC;

CREATE TRIGGER users_create_default_authentication_policy
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION create_default_account_authentication_policy();

CREATE OR REPLACE FUNCTION enforce_platform_second_step_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Both platform-membership activation and policy relaxation lock the same
  -- account row. This prevents write skew from committing an active privileged
  -- membership together with an optional second-step policy.
  PERFORM 1 FROM public.users WHERE id = NEW.user_id FOR UPDATE;
  IF NEW.active AND NOT EXISTS (
    SELECT 1
      FROM public.account_authentication_policies policy
     WHERE policy.user_id = NEW.user_id
       AND policy.second_step_requirement = 'required'
  ) THEN
    RAISE EXCEPTION 'active platform membership requires an account-level second-step policy'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.active AND EXISTS (
    SELECT 1
      FROM public.sessions session
     WHERE session.user_id = NEW.user_id
       AND session.revoked_at IS NULL
       AND session.expires_at > now()
       AND session.recovery_restricted
  ) THEN
    RAISE EXCEPTION 'active account recovery must finish before platform access is granted'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION enforce_platform_second_step_policy() FROM PUBLIC;

CREATE TRIGGER platform_membership_requires_second_step
BEFORE INSERT OR UPDATE OF user_id, active ON platform_memberships
FOR EACH ROW EXECUTE FUNCTION enforce_platform_second_step_policy();

CREATE OR REPLACE FUNCTION protect_required_platform_second_step_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  policy_user_id uuid;
BEGIN
  policy_user_id := OLD.user_id;
  PERFORM 1 FROM public.users WHERE id = policy_user_id FOR UPDATE;
  IF TG_OP = 'UPDATE' AND NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'authentication policy identity cannot be reassigned'
      USING ERRCODE = '23514';
  END IF;
  IF (TG_OP = 'DELETE' OR NEW.second_step_requirement <> 'required') AND EXISTS (
    SELECT 1
      FROM public.platform_memberships membership
     WHERE membership.user_id = policy_user_id AND membership.active
  ) THEN
    RAISE EXCEPTION 'active platform membership requires an account-level second-step policy'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION protect_required_platform_second_step_policy() FROM PUBLIC;

CREATE TRIGGER authentication_policy_protects_platform_membership
BEFORE UPDATE OF user_id, second_step_requirement OR DELETE ON account_authentication_policies
FOR EACH ROW EXECUTE FUNCTION protect_required_platform_second_step_policy();

CREATE OR REPLACE FUNCTION maintain_account_authentication_policy_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.auth_state_version < OLD.auth_state_version THEN
    RAISE EXCEPTION 'authentication state version cannot decrease'
      USING ERRCODE = '23514';
  END IF;
  IF (
    NEW.second_step_requirement IS DISTINCT FROM OLD.second_step_requirement
    OR NEW.email_code_enabled IS DISTINCT FROM OLD.email_code_enabled
    OR NEW.preferred_method IS DISTINCT FROM OLD.preferred_method
  ) AND NEW.auth_state_version = OLD.auth_state_version THEN
    NEW.auth_state_version := OLD.auth_state_version + 1;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION maintain_account_authentication_policy_version() FROM PUBLIC;

CREATE TRIGGER authentication_policy_versions_security_changes
BEFORE UPDATE ON account_authentication_policies
FOR EACH ROW EXECUTE FUNCTION maintain_account_authentication_policy_version();

CREATE OR REPLACE FUNCTION bump_related_account_authentication_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  affected_user_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected_user_id := OLD.user_id;
  ELSE
    affected_user_id := NEW.user_id;
  END IF;
  UPDATE public.account_authentication_policies
     SET auth_state_version = auth_state_version + 1,
         updated_at = now()
   WHERE user_id = affected_user_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION bump_related_account_authentication_state() FROM PUBLIC;

CREATE TRIGGER credentials_bump_authentication_state
AFTER UPDATE OF password_hash ON credentials
FOR EACH ROW EXECUTE FUNCTION bump_related_account_authentication_state();

CREATE TRIGGER memberships_bump_authentication_state
AFTER INSERT OR DELETE OR UPDATE OF role, active ON memberships
FOR EACH ROW EXECUTE FUNCTION bump_related_account_authentication_state();

CREATE TRIGGER platform_memberships_bump_authentication_state
AFTER INSERT OR DELETE OR UPDATE OF role, active ON platform_memberships
FOR EACH ROW EXECUTE FUNCTION bump_related_account_authentication_state();

CREATE TRIGGER mfa_factors_bump_authentication_state
AFTER INSERT OR DELETE OR UPDATE OF kind, encrypted_secret, key_version, verified_at, revoked_at
ON mfa_factors
FOR EACH ROW EXECUTE FUNCTION bump_related_account_authentication_state();

CREATE OR REPLACE FUNCTION bump_user_account_authentication_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.account_authentication_policies
     SET auth_state_version = auth_state_version + 1,
         updated_at = now()
   WHERE user_id = NEW.id;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION bump_user_account_authentication_state() FROM PUBLIC;

CREATE TRIGGER users_bump_authentication_state
AFTER UPDATE OF status ON users
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM OLD.status)
EXECUTE FUNCTION bump_user_account_authentication_state();

-- Keep the account-scoped copy coherent while an older release still consumes or
-- creates factor-scoped codes. New account-only codes intentionally do not populate
-- the legacy table because email-code-only accounts have no legacy factor to reference.
CREATE OR REPLACE FUNCTION sync_legacy_mfa_recovery_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  factor_user_id uuid;
  factor_revoked_at timestamptz(3);
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.account_recovery_codes
       SET revoked_at = COALESCE(revoked_at, now()),
           source_factor_id = NULL
     WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT factor.user_id, factor.revoked_at
    INTO STRICT factor_user_id, factor_revoked_at
    FROM public.mfa_factors factor
   WHERE factor.id = NEW.factor_id;

  INSERT INTO public.account_recovery_codes
    (id, user_id, code_hash, source_factor_id, used_at, revoked_at, created_at)
  VALUES
    (NEW.id, factor_user_id, NEW.code_hash, NEW.factor_id, NEW.used_at,
     factor_revoked_at, NEW.created_at)
  ON CONFLICT (id) DO UPDATE
    SET code_hash = EXCLUDED.code_hash,
        source_factor_id = EXCLUDED.source_factor_id,
        used_at = EXCLUDED.used_at,
        revoked_at = COALESCE(account_recovery_codes.revoked_at, EXCLUDED.revoked_at);
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION sync_legacy_mfa_recovery_code() FROM PUBLIC;

CREATE TRIGGER legacy_mfa_recovery_codes_account_sync
AFTER INSERT OR UPDATE OR DELETE ON mfa_recovery_codes
FOR EACH ROW EXECUTE FUNCTION sync_legacy_mfa_recovery_code();

-- A forward-schema application rollback still reads the legacy table. Mirror any
-- consumption, revocation, or deletion of a migrated legacy code back to that table
-- so rolling application code back cannot resurrect recovery capability. Account-only
-- codes have no source factor and intentionally remain invisible to older releases.
CREATE OR REPLACE FUNCTION sync_account_recovery_code_to_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  legacy_id uuid;
  legacy_factor_id uuid;
BEGIN
  legacy_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  legacy_factor_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.source_factor_id
    ELSE NEW.source_factor_id
  END;
  IF legacy_factor_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE public.mfa_recovery_codes
       SET used_at = COALESCE(used_at, now())
     WHERE id = legacy_id AND factor_id = legacy_factor_id AND used_at IS NULL;
    RETURN OLD;
  END IF;

  UPDATE public.mfa_recovery_codes
     SET code_hash = NEW.code_hash,
         used_at = CASE
           WHEN NEW.used_at IS NOT NULL THEN NEW.used_at
           WHEN NEW.revoked_at IS NOT NULL THEN COALESCE(used_at, NEW.revoked_at)
           ELSE used_at
         END
   WHERE id = NEW.id
     AND factor_id = NEW.source_factor_id
     AND (
       code_hash IS DISTINCT FROM NEW.code_hash
       OR (NEW.used_at IS NOT NULL AND used_at IS DISTINCT FROM NEW.used_at)
       OR (NEW.used_at IS NULL AND NEW.revoked_at IS NOT NULL AND used_at IS NULL)
     );
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION sync_account_recovery_code_to_legacy() FROM PUBLIC;

CREATE TRIGGER account_recovery_codes_legacy_sync
AFTER UPDATE OF code_hash, used_at, revoked_at OR DELETE ON account_recovery_codes
FOR EACH ROW EXECUTE FUNCTION sync_account_recovery_code_to_legacy();

CREATE OR REPLACE FUNCTION revoke_account_codes_for_revoked_factor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    UPDATE public.account_recovery_codes
       SET revoked_at = COALESCE(revoked_at, NEW.revoked_at)
     WHERE source_factor_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION revoke_account_codes_for_revoked_factor() FROM PUBLIC;

CREATE TRIGGER mfa_factor_revocation_revokes_account_codes
AFTER UPDATE OF revoked_at ON mfa_factors
FOR EACH ROW EXECUTE FUNCTION revoke_account_codes_for_revoked_factor();

REVOKE ALL ON account_authentication_policies, account_recovery_codes FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON account_authentication_policies, account_recovery_codes
  TO omnireach_auth;

-- ORAP administration can manage identities, memberships, and session revocation but
-- must not read or mutate password hashes, reset tokens, factor secrets, recovery
-- material, or owner-bootstrap authorization.
REVOKE ALL ON credentials, password_recovery_tokens, mfa_factors,
  mfa_recovery_codes, owner_bootstrap FROM omnireach_platform;

-- Session proof can only be minted by the authentication role. Platform
-- administration retains scoped revocation, while application and worker roles do
-- not need direct session-table access.
REVOKE ALL ON sessions FROM omnireach_app, omnireach_worker, omnireach_platform;
GRANT SELECT ON sessions TO omnireach_platform;
GRANT UPDATE (revoked_at, revoke_reason) ON sessions TO omnireach_platform;

ALTER TABLE account_authentication_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_authentication_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY own_or_auth_account_authentication_policies ON account_authentication_policies
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR pg_has_role(current_user, 'omnireach_auth', 'member')
  )
  WITH CHECK (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR pg_has_role(current_user, 'omnireach_auth', 'member')
  );

ALTER TABLE account_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_recovery_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY own_or_auth_account_recovery_codes ON account_recovery_codes
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR pg_has_role(current_user, 'omnireach_auth', 'member')
  )
  WITH CHECK (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR pg_has_role(current_user, 'omnireach_auth', 'member')
  );
