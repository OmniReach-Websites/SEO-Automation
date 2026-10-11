ALTER TABLE schedules
  ADD CONSTRAINT schedules_category_check
  CHECK (category IN ('aio_proposal','backup','crawl','health_check','metrics_sync','publish','seo_audit'));

CREATE OR REPLACE FUNCTION claim_scheduler_lease(
  p_owner_hash char(64),
  p_now timestamptz,
  p_lease_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  claimed boolean;
BEGIN
  IF p_owner_hash !~ '^[a-f0-9]{64}$' OR p_lease_seconds < 5 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'invalid scheduler lease request';
  END IF;
  UPDATE public.scheduler_lease
     SET owner_hash = p_owner_hash,
         expires_at = p_now + make_interval(secs => p_lease_seconds),
         updated_at = p_now
   WHERE singleton = true
     AND (expires_at IS NULL OR expires_at <= p_now OR owner_hash = p_owner_hash)
  RETURNING true INTO claimed;
  RETURN COALESCE(claimed, false);
END $$;

CREATE OR REPLACE FUNCTION release_scheduler_lease(p_owner_hash char(64))
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  released boolean;
BEGIN
  UPDATE public.scheduler_lease
     SET owner_hash = NULL, expires_at = NULL, updated_at = now()
   WHERE singleton = true AND owner_hash = p_owner_hash
  RETURNING true INTO released;
  RETURN COALESCE(released, false);
END $$;

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
      SET updated_at = public.jobs.updated_at
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

CREATE OR REPLACE FUNCTION complete_schedule_claim(
  p_owner_hash char(64),
  p_schedule_id uuid,
  p_window_key varchar(200),
  p_next_attempt_at timestamptz,
  p_now timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  completed boolean;
BEGIN
  IF p_next_attempt_at <= p_now THEN RAISE EXCEPTION 'next schedule attempt must be in the future'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.scheduler_lease sl
     WHERE sl.singleton = true AND sl.owner_hash = p_owner_hash AND sl.expires_at > p_now
  ) THEN
    RAISE EXCEPTION 'scheduler lease is not active';
  END IF;
  UPDATE public.schedules
     SET last_window_key = p_window_key, next_attempt_at = p_next_attempt_at, updated_at = p_now
   WHERE id = p_schedule_id
  RETURNING true INTO completed;
  RETURN COALESCE(completed, false);
END $$;

REVOKE ALL ON FUNCTION claim_scheduler_lease(char(64), timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_scheduler_lease(char(64)) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_due_schedules(char(64), timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_schedule_claim(char(64), uuid, varchar(200), timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_scheduler_lease(char(64), timestamptz, integer) TO omnireach_worker;
GRANT EXECUTE ON FUNCTION release_scheduler_lease(char(64)) TO omnireach_worker;
GRANT EXECUTE ON FUNCTION claim_due_schedules(char(64), timestamptz, integer) TO omnireach_worker;
GRANT EXECUTE ON FUNCTION complete_schedule_claim(char(64), uuid, varchar(200), timestamptz, timestamptz) TO omnireach_worker;
