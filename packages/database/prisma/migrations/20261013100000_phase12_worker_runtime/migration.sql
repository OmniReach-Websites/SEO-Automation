CREATE TABLE worker_heartbeats (
  instance_id varchar(160) PRIMARY KEY,
  worker_kind varchar(40) NOT NULL
    CHECK (worker_kind IN ('scheduler','runner','publisher','crawler','seo','monitoring')),
  release_sha varchar(64) NOT NULL,
  started_at timestamptz(3) NOT NULL,
  last_seen_at timestamptz(3) NOT NULL,
  state varchar(20) NOT NULL CHECK (state IN ('starting','healthy','draining','stopped')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX worker_heartbeats_kind_seen_idx
  ON worker_heartbeats (worker_kind, last_seen_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON worker_heartbeats TO omnireach_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON worker_heartbeats TO omnireach_platform;

CREATE OR REPLACE FUNCTION expire_stalled_job_runs(p_now timestamptz, p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE recovered integer;
BEGIN
  IF p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'invalid stalled job limit'; END IF;
  WITH stalled AS (
    SELECT run.id, run.job_id
      FROM public.job_runs run
      JOIN public.jobs job ON job.id = run.job_id
     WHERE run.state = 'running' AND run.lease_expires_at <= p_now
       AND job.state = 'running'
     ORDER BY run.lease_expires_at, run.id
     FOR UPDATE OF run, job SKIP LOCKED
     LIMIT p_limit
  ), closed AS (
    UPDATE public.job_runs run
       SET state = 'stalled', completed_at = p_now,
           error_category = 'retryable', safe_error = 'Worker lease expired'
      FROM stalled
     WHERE run.id = stalled.id
     RETURNING stalled.job_id
  )
  UPDATE public.jobs job
     SET state = CASE
           WHEN attempts.count < job.attempt_limit THEN 'queued'
           ELSE 'failed'
         END,
         completed_at = CASE
           WHEN attempts.count < job.attempt_limit THEN NULL
           ELSE p_now
         END,
         queue_dispatched_at = NULL,
         queue_claim_owner = NULL,
         queue_claimed_until = NULL,
         updated_at = p_now
    FROM closed,
         LATERAL (SELECT count(*)::integer AS count FROM public.job_runs r WHERE r.job_id = closed.job_id) attempts
   WHERE job.id = closed.job_id;
  GET DIAGNOSTICS recovered = ROW_COUNT;
  RETURN recovered;
END $$;

REVOKE ALL ON FUNCTION expire_stalled_job_runs(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_stalled_job_runs(timestamptz, integer) TO omnireach_worker;
