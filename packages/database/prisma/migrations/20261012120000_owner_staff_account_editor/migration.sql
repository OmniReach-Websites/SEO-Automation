-- Give a Platform Owner a narrowly scoped recovery path for ORAP staff account
-- profile and password changes without granting the platform runtime direct read
-- or write access to credential hashes.

CREATE OR REPLACE FUNCTION orap_owner_update_staff_account(
  target_user_id uuid,
  requested_display_name text,
  requested_normalized_email text,
  requested_job_title text,
  requested_password_hash text,
  audit_reason text,
  audit_trace_id text
)
RETURNS TABLE (
  updated_display_name text,
  updated_normalized_email text,
  updated_job_title text,
  password_replaced boolean,
  revoked_sessions integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_user_id uuid;
  before_state jsonb;
  normalized_job_title text;
  normalized_reason text;
  password_was_replaced boolean := false;
  session_count integer := 0;
BEGIN
  actor_user_id := NULLIF(current_setting('app.platform_actor_id', true), '')::uuid;
  normalized_reason := btrim(audit_reason);
  normalized_job_title := NULLIF(btrim(requested_job_title), '');

  IF actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.platform_memberships legacy
      JOIN public.orap_staff_memberships membership
        ON membership.user_id = legacy.user_id
       AND membership.identity_kind = 'platform_owner'
       AND membership.status = 'active'
     WHERE legacy.user_id = actor_user_id
       AND legacy.role = 'platform_owner'
       AND legacy.active
  ) THEN
    RAISE EXCEPTION 'active Platform Owner identity required' USING ERRCODE = '42501';
  END IF;

  IF length(btrim(requested_display_name)) < 1
     OR length(btrim(requested_display_name)) > 160
     OR requested_normalized_email <> lower(requested_normalized_email)
     OR length(requested_normalized_email) < 3
     OR length(requested_normalized_email) > 320
     OR requested_normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR length(COALESCE(normalized_job_title, '')) > 160
     OR length(normalized_reason) < 3
     OR length(normalized_reason) > 500
     OR length(audit_trace_id) < 1
     OR length(audit_trace_id) > 128
  THEN
    RAISE EXCEPTION 'invalid staff account update' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
           'displayName', account.display_name,
           'normalizedEmail', account.normalized_email,
           'jobTitle', membership.job_title,
           'identityKind', membership.identity_kind,
           'status', membership.status
         )
    INTO before_state
    FROM public.users account
    JOIN public.orap_staff_memberships membership ON membership.user_id = account.id
   WHERE account.id = target_user_id
   FOR UPDATE OF account, membership;

  IF before_state IS NULL THEN
    RAISE EXCEPTION 'ORAP staff account was not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.users
     SET display_name = btrim(requested_display_name),
         normalized_email = requested_normalized_email,
         updated_at = now()
   WHERE id = target_user_id;

  UPDATE public.orap_staff_memberships
     SET job_title = normalized_job_title,
         updated_at = now()
   WHERE user_id = target_user_id;

  IF requested_password_hash IS NOT NULL THEN
    IF requested_password_hash !~ '^\$argon2id\$' THEN
      RAISE EXCEPTION 'password must be an Argon2id hash' USING ERRCODE = '22023';
    END IF;
    UPDATE public.credentials
       SET password_hash = requested_password_hash,
           password_changed_at = now(),
           failed_attempts = 0,
           blocked_until = NULL,
           updated_at = now()
     WHERE user_id = target_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'staff credential was not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.password_recovery_tokens
       SET used_at = COALESCE(used_at, now())
     WHERE user_id = target_user_id AND used_at IS NULL;
    password_was_replaced := true;
  ELSIF (before_state ->> 'normalizedEmail') IS DISTINCT FROM requested_normalized_email THEN
    UPDATE public.account_authentication_policies
       SET auth_state_version = auth_state_version + 1,
           updated_at = now()
     WHERE user_id = target_user_id;
  END IF;

  UPDATE public.sessions
     SET revoked_at = now(), revoke_reason = 'orap_owner_account_updated'
   WHERE user_id = target_user_id
     AND tenant_id IS NULL
     AND site_id IS NULL
     AND revoked_at IS NULL;
  GET DIAGNOSTICS session_count = ROW_COUNT;

  INSERT INTO public.staff_access_audits
    (actor_user_id, target_user_id, action, decision, reason, trace_id, before, after)
  SELECT actor_user_id,
         target_user_id,
         'staff.account_updated',
         'allowed',
         normalized_reason,
         audit_trace_id,
         before_state,
         jsonb_build_object(
           'displayName', account.display_name,
           'normalizedEmail', account.normalized_email,
           'jobTitle', membership.job_title,
           'identityKind', membership.identity_kind,
           'status', membership.status,
           'passwordReplaced', password_was_replaced,
           'revokedSessions', session_count
         )
    FROM public.users account
    JOIN public.orap_staff_memberships membership ON membership.user_id = account.id
   WHERE account.id = target_user_id;

  RETURN QUERY
  SELECT account.display_name::text,
         account.normalized_email::text,
         membership.job_title::text,
         password_was_replaced,
         session_count
    FROM public.users account
    JOIN public.orap_staff_memberships membership ON membership.user_id = account.id
   WHERE account.id = target_user_id;
END
$$;

REVOKE ALL ON FUNCTION orap_owner_update_staff_account(
  uuid, text, text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION orap_owner_update_staff_account(
  uuid, text, text, text, text, text, text
) TO omnireach_platform;

INSERT INTO schema_metadata (key, value)
VALUES ('orap_owner_staff_account_editor', to_jsonb('1-audited-session-revoking'::text))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
