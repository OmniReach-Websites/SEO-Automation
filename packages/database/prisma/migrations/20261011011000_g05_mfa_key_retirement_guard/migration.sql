CREATE TABLE mfa_encryption_key_retirements (
  key_version integer PRIMARY KEY CHECK (key_version > 0),
  change_id varchar(128) NOT NULL CHECK (change_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$'),
  retired_at timestamptz(3) NOT NULL DEFAULT now(),
  retired_by_role varchar(63) NOT NULL DEFAULT session_user
);

REVOKE ALL ON mfa_encryption_key_retirements FROM PUBLIC;
ALTER TABLE mfa_encryption_key_retirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_reads_mfa_encryption_key_retirements
  ON mfa_encryption_key_retirements
  FOR SELECT
  USING (pg_has_role(current_user, 'omnireach_auth', 'member'));
GRANT SELECT ON mfa_encryption_key_retirements TO omnireach_auth;

CREATE OR REPLACE FUNCTION prevent_mfa_encryption_key_retirement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'MFA encryption key retirement records are immutable'
    USING ERRCODE = '55000';
END
$$;
REVOKE ALL ON FUNCTION prevent_mfa_encryption_key_retirement_mutation() FROM PUBLIC;

CREATE TRIGGER mfa_encryption_key_retirements_are_immutable
BEFORE UPDATE OR DELETE ON mfa_encryption_key_retirements
FOR EACH ROW EXECUTE FUNCTION prevent_mfa_encryption_key_retirement_mutation();

-- This lock namespace must match PostgresMfaKeyRotator. Every ciphertext write
-- and retirement for one version serializes on the same transaction-scoped lock.
CREATE OR REPLACE FUNCTION guard_retired_mfa_encryption_key_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  candidate_version integer;
BEGIN
  candidate_version := (to_jsonb(NEW) ->> TG_ARGV[0])::integer;
  PERFORM pg_advisory_xact_lock(1331980113, candidate_version);
  IF EXISTS (
    SELECT 1
      FROM public.mfa_encryption_key_retirements
     WHERE key_version = candidate_version
  ) THEN
    RAISE EXCEPTION 'MFA encryption key version is retired'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION guard_retired_mfa_encryption_key_write() FROM PUBLIC;

CREATE TRIGGER mfa_factors_reject_retired_encryption_key
BEFORE INSERT OR UPDATE OF key_version ON mfa_factors
FOR EACH ROW EXECUTE FUNCTION guard_retired_mfa_encryption_key_write('key_version');

CREATE TRIGGER password_recovery_outbox_reject_retired_encryption_key
BEFORE INSERT OR UPDATE OF encryption_key_version ON password_recovery_delivery_outbox
FOR EACH ROW EXECUTE FUNCTION guard_retired_mfa_encryption_key_write('encryption_key_version');

CREATE OR REPLACE FUNCTION retire_mfa_encryption_key(
  retiring_version integer,
  active_version integer,
  operator_change_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  factor_references integer;
  delivery_references integer;
BEGIN
  IF retiring_version IS NULL OR retiring_version <= 0
     OR active_version IS NULL OR active_version <= 0
     OR retiring_version = active_version THEN
    RAISE EXCEPTION 'MFA encryption key retirement versions are invalid'
      USING ERRCODE = '22023';
  END IF;
  IF operator_change_id IS NULL
     OR operator_change_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$' THEN
    RAISE EXCEPTION 'MFA encryption key retirement change ID is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(1331980113, retiring_version);
  IF EXISTS (
    SELECT 1
      FROM public.mfa_encryption_key_retirements
     WHERE key_version = retiring_version
  ) THEN
    RAISE EXCEPTION 'MFA encryption key version is already retired'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*)::integer
    INTO factor_references
    FROM public.mfa_factors
   WHERE key_version = retiring_version;
  SELECT count(*)::integer
    INTO delivery_references
    FROM public.password_recovery_delivery_outbox
   WHERE encryption_key_version = retiring_version
     AND encrypted_token IS NOT NULL
     AND status IN ('queued', 'processing');

  IF factor_references <> 0 OR delivery_references <> 0 THEN
    RETURN false;
  END IF;

  INSERT INTO public.mfa_encryption_key_retirements
    (key_version, change_id)
  VALUES (retiring_version, operator_change_id);

  INSERT INTO public.audit_events
    (action, reason, trace_id, target_type, metadata)
  VALUES (
    'auth.mfa_encryption_key.retired',
    operator_change_id,
    operator_change_id,
    'mfa_encryption_key',
    jsonb_build_object(
      'activeVersion', active_version,
      'mfaFactorReferences', factor_references,
      'pendingDeliveryReferences', delivery_references,
      'retiredVersion', retiring_version
    )
  );
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION retire_mfa_encryption_key(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retire_mfa_encryption_key(integer, integer, text) TO omnireach_auth;

INSERT INTO schema_metadata (key, value)
VALUES (
  'g05_mfa_key_retirement_guard',
  '{"goal":"G05","version":1,"appendOnly":true}'::jsonb
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
