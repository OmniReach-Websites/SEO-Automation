ALTER TABLE jobs
  ADD COLUMN queue_claim_owner char(64),
  ADD COLUMN queue_claimed_until timestamptz(3),
  ADD COLUMN queue_dispatched_at timestamptz(3);
CREATE INDEX jobs_dispatch_idx
  ON jobs (state, queue_dispatched_at, queue_claimed_until, created_at);

CREATE OR REPLACE FUNCTION claim_dispatchable_jobs(
  p_owner_hash char(64),
  p_now timestamptz,
  p_limit integer
) RETURNS TABLE (
  job_id uuid,
  tenant_id uuid,
  site_id uuid,
  category varchar(40),
  record_id uuid,
  dedupe_key varchar(160),
  trace_id varchar(128),
  schema_version integer,
  attempt_limit integer,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
BEGIN
  IF p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'invalid dispatch claim limit'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.scheduler_lease sl
     WHERE sl.singleton = true AND sl.owner_hash = p_owner_hash AND sl.expires_at > p_now
  ) THEN
    RAISE EXCEPTION 'scheduler lease is not active';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT j.id
      FROM public.jobs j
     WHERE j.state = 'queued'
       AND j.expires_at > p_now
       AND j.queue_dispatched_at IS NULL
       AND (j.queue_claimed_until IS NULL OR j.queue_claimed_until <= p_now)
     ORDER BY j.created_at, j.id
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  UPDATE public.jobs j
     SET queue_claim_owner = p_owner_hash,
         queue_claimed_until = p_now + interval '5 minutes',
         updated_at = p_now
    FROM candidates c
   WHERE j.id = c.id
  RETURNING j.id, j.tenant_id, j.site_id, j.category, j.record_id, j.dedupe_key,
            j.trace_id, j.schema_version, j.attempt_limit, j.expires_at;
END $$;

CREATE OR REPLACE FUNCTION finalize_job_dispatch(
  p_owner_hash char(64),
  p_job_id uuid,
  p_succeeded boolean,
  p_now timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  finalized boolean;
BEGIN
  UPDATE public.jobs j
     SET queue_dispatched_at = CASE WHEN p_succeeded THEN p_now ELSE NULL END,
         queue_claim_owner = NULL,
         queue_claimed_until = NULL,
         updated_at = p_now
   WHERE j.id = p_job_id AND j.queue_claim_owner = p_owner_hash AND j.state = 'queued'
  RETURNING true INTO finalized;
  RETURN COALESCE(finalized, false);
END $$;

REVOKE ALL ON FUNCTION claim_dispatchable_jobs(char(64), timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION finalize_job_dispatch(char(64), uuid, boolean, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_dispatchable_jobs(char(64), timestamptz, integer) TO omnireach_worker;
GRANT EXECUTE ON FUNCTION finalize_job_dispatch(char(64), uuid, boolean, timestamptz) TO omnireach_worker;
