CREATE OR REPLACE FUNCTION claim_due_schedules(
  p_owner_hash char(64),
  p_now timestamptz,
  p_limit integer
) RETURNS TABLE (
  schedule_id uuid,
  job_id uuid,
  tenant_id uuid,
  site_id uuid,
  category varchar(40),
  timezone varchar(100),
  local_hour integer,
  local_minute integer,
  jitter_minutes integer,
  window_key varchar(200),
  dedupe_key varchar(160),
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
BEGIN
  IF p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'invalid schedule claim limit'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.scheduler_lease sl
     WHERE sl.singleton = true AND sl.owner_hash = p_owner_hash AND sl.expires_at > p_now
  ) THEN
    RAISE EXCEPTION 'scheduler lease is not active';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT s.*,
           (s.id::text || ':' || to_char(s.next_attempt_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI'))::varchar(200) AS claimed_window
      FROM public.schedules s
     WHERE s.enabled AND s.next_attempt_at <= p_now
     ORDER BY s.next_attempt_at, s.id
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  ), deferred AS (
    UPDATE public.schedules s
       SET next_attempt_at = p_now + interval '5 minutes', updated_at = p_now
      FROM due d
     WHERE s.id = d.id
     RETURNING d.*
  ), admitted AS (
    INSERT INTO public.jobs
      (tenant_id, site_id, category, schema_version, record_id, dedupe_key, trace_id,
       state, policy_version, attempt_limit, expires_at)
    SELECT d.tenant_id, d.site_id, d.category, 1, d.site_id,
           ('schedule:' || encode(digest(d.claimed_window, 'sha256'), 'hex'))::varchar(160),
           replace(gen_random_uuid()::text, '-', ''), 'queued', 1, 3,
           p_now + interval '24 hours'
      FROM deferred d
    ON CONFLICT (tenant_id, site_id, category, dedupe_key) DO UPDATE
      SET updated_at = EXCLUDED.updated_at
    RETURNING public.jobs.*
  )
  SELECT d.id, j.id, d.tenant_id, d.site_id, d.category, d.timezone,
         d.local_hour, d.local_minute, d.jitter_minutes, d.claimed_window,
         j.dedupe_key, j.expires_at
    FROM deferred d
    JOIN admitted j ON j.tenant_id = d.tenant_id AND j.site_id = d.site_id
                     AND j.category = d.category
                     AND j.dedupe_key = ('schedule:' || encode(digest(d.claimed_window, 'sha256'), 'hex'))::varchar(160);
END $$;
