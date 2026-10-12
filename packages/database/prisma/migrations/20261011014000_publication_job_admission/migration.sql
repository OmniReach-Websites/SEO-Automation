-- Publication requests are the PostgreSQL-authoritative outbox for immutable site builds.
-- Keep this migration additive so the preceding application release can continue to
-- insert its original publication_requests column set after a database-first rollout.
ALTER TABLE publication_requests
  ADD COLUMN trace_id varchar(128) NOT NULL
    DEFAULT replace(gen_random_uuid()::text, '-', ''),
  ADD COLUMN job_id uuid,
  ADD COLUMN job_category varchar(40) NOT NULL DEFAULT 'publish'
    CHECK (job_category = 'publish'),
  ADD CONSTRAINT publication_trace_id_envelope_safe
    CHECK (trace_id ~ '^[A-Za-z0-9_-]{16,128}$');

-- The redundant exact identity supports a composite foreign key that proves a linked
-- job is the precise durable work item admitted for its publication request.
ALTER TABLE jobs
  ADD CONSTRAINT jobs_publication_identity_key
    UNIQUE (id, tenant_id, site_id, category, record_id, dedupe_key, trace_id);

ALTER TABLE publication_requests
  ADD CONSTRAINT publication_requests_job_identity_fkey
    FOREIGN KEY
      (job_id, tenant_id, site_id, job_category, id, idempotency_key, trace_id)
    REFERENCES jobs
      (id, tenant_id, site_id, category, record_id, dedupe_key, trace_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT publication_requests_job_id_key UNIQUE (job_id),
  ADD CONSTRAINT publication_requests_job_relation_key
    UNIQUE (job_id, tenant_id, site_id, job_category, id, idempotency_key, trace_id);

CREATE OR REPLACE FUNCTION admit_publication_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  admitted public.jobs%ROWTYPE;
  existing_job_id uuid;
BEGIN
  -- The publisher's preceding release deliberately re-inserts an already queued
  -- request with ON CONFLICT DO NOTHING before it begins work. Reuse the existing
  -- database-managed link and let the outer statement reach its conflict handler.
  SELECT request.job_id
    INTO existing_job_id
    FROM public.publication_requests request
   WHERE request.tenant_id = NEW.tenant_id
     AND request.site_id = NEW.site_id
     AND request.idempotency_key = NEW.idempotency_key;
  IF FOUND THEN
    IF existing_job_id IS NULL THEN
      RAISE EXCEPTION 'existing publication request has no durable job';
    END IF;
    NEW.job_id := existing_job_id;
    RETURN NEW;
  END IF;

  IF NEW.job_id IS NOT NULL THEN
    RAISE EXCEPTION 'publication job identity is database-managed';
  END IF;

  INSERT INTO public.jobs
    (tenant_id, site_id, category, schema_version, record_id, dedupe_key, trace_id,
     state, policy_version, attempt_limit, expires_at, audit_referenced, completed_at)
  VALUES
    (NEW.tenant_id, NEW.site_id, 'publish', 1, NEW.id, NEW.idempotency_key, NEW.trace_id,
     CASE
       WHEN NEW.status = 'published' THEN 'succeeded'
       WHEN NEW.status = 'failed' THEN 'failed'
       ELSE 'queued'
     END,
     1, 3, GREATEST(NEW.created_at + interval '24 hours', now() + interval '24 hours'),
     true,
     CASE WHEN NEW.status IN ('published', 'failed')
       THEN COALESCE(NEW.completed_at, now())
       ELSE NULL
     END)
  ON CONFLICT (tenant_id, site_id, category, dedupe_key) DO UPDATE
    SET updated_at = public.jobs.updated_at
  RETURNING * INTO admitted;

  IF admitted.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR admitted.site_id IS DISTINCT FROM NEW.site_id
     OR admitted.category IS DISTINCT FROM 'publish'
     OR admitted.record_id IS DISTINCT FROM NEW.id
     OR admitted.dedupe_key IS DISTINCT FROM NEW.idempotency_key
     OR admitted.trace_id IS DISTINCT FROM NEW.trace_id THEN
    RAISE EXCEPTION 'publication job identity conflicts with an existing durable job';
  END IF;

  NEW.job_id := admitted.id;
  RETURN NEW;
END
$$;

CREATE TRIGGER publication_request_admit_job
BEFORE INSERT ON publication_requests
FOR EACH ROW EXECUTE FUNCTION admit_publication_job();

-- Admit work that was already queued by an earlier binary before this migration.
INSERT INTO jobs
  (tenant_id, site_id, category, schema_version, record_id, dedupe_key, trace_id,
   state, policy_version, attempt_limit, expires_at, audit_referenced)
SELECT request.tenant_id, request.site_id, 'publish', 1, request.id,
       request.idempotency_key, request.trace_id, 'queued', 1, 3,
       GREATEST(request.created_at + interval '24 hours', now() + interval '24 hours'),
       true
  FROM publication_requests request
 WHERE request.status IN ('queued', 'building')
   AND request.job_id IS NULL
ON CONFLICT (tenant_id, site_id, category, dedupe_key) DO NOTHING;

UPDATE publication_requests request
   SET job_id = job.id
  FROM jobs job
 WHERE request.status IN ('queued', 'building')
   AND request.job_id IS NULL
   AND job.tenant_id = request.tenant_id
   AND job.site_id = request.site_id
   AND job.category = 'publish'
   AND job.record_id = request.id
   AND job.dedupe_key = request.idempotency_key
   AND job.trace_id = request.trace_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM publication_requests
     WHERE status IN ('queued', 'building') AND job_id IS NULL
  ) THEN
    RAISE EXCEPTION 'active publication request could not be linked to a durable job';
  END IF;
END
$$;

ALTER TABLE publication_requests
  ADD CONSTRAINT publication_active_job_required
    CHECK (status NOT IN ('queued', 'building') OR job_id IS NOT NULL);

CREATE OR REPLACE FUNCTION preserve_publication_job_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.site_id IS DISTINCT FROM OLD.site_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.trace_id IS DISTINCT FROM OLD.trace_id
     OR NEW.job_category IS DISTINCT FROM OLD.job_category
     OR NEW.job_id IS DISTINCT FROM OLD.job_id THEN
    RAISE EXCEPTION 'publication job link is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER publication_request_preserve_job_identity
BEFORE UPDATE ON publication_requests
FOR EACH ROW EXECUTE FUNCTION preserve_publication_job_identity();

CREATE OR REPLACE FUNCTION preserve_linked_job_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.publication_requests request WHERE request.job_id = OLD.id)
     AND (
       NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.site_id IS DISTINCT FROM OLD.site_id
       OR NEW.category IS DISTINCT FROM OLD.category
       OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
       OR NEW.record_id IS DISTINCT FROM OLD.record_id
       OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
       OR NEW.trace_id IS DISTINCT FROM OLD.trace_id
     ) THEN
    RAISE EXCEPTION 'linked publication job identity is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER jobs_preserve_publication_identity
BEFORE UPDATE ON jobs
FOR EACH ROW EXECUTE FUNCTION preserve_linked_job_identity();

COMMENT ON COLUMN publication_requests.trace_id IS
  'Safe correlation identifier copied exactly into the opaque durable publish job.';
COMMENT ON COLUMN publication_requests.job_id IS
  'Database-managed link to the one durable publish job admitted with this request.';
