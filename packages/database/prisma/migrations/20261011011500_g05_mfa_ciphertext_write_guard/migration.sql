CREATE OR REPLACE FUNCTION guard_retired_mfa_encryption_key_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  candidate_version integer;
BEGIN
  -- Terminal outbox rows intentionally erase their encrypted payload while retaining
  -- the historical version number. Erasure is always safe; recreating ciphertext is not.
  IF TG_NARGS > 1 AND (to_jsonb(NEW) ->> TG_ARGV[1]) IS NULL THEN
    RETURN NEW;
  END IF;

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

DROP TRIGGER mfa_factors_reject_retired_encryption_key ON mfa_factors;
CREATE TRIGGER mfa_factors_reject_retired_encryption_key
BEFORE INSERT OR UPDATE OF key_version, encrypted_secret ON mfa_factors
FOR EACH ROW EXECUTE FUNCTION guard_retired_mfa_encryption_key_write(
  'key_version',
  'encrypted_secret'
);

DROP TRIGGER password_recovery_outbox_reject_retired_encryption_key
  ON password_recovery_delivery_outbox;
CREATE TRIGGER password_recovery_outbox_reject_retired_encryption_key
BEFORE INSERT OR UPDATE OF encryption_key_version, encrypted_token
ON password_recovery_delivery_outbox
FOR EACH ROW EXECUTE FUNCTION guard_retired_mfa_encryption_key_write(
  'encryption_key_version',
  'encrypted_token'
);

INSERT INTO schema_metadata (key, value)
VALUES (
  'g05_mfa_ciphertext_write_guard',
  '{"goal":"G05","version":1,"appendOnly":true}'::jsonb
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
