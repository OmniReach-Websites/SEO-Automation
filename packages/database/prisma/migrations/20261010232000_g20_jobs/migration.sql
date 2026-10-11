CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  category varchar(40) NOT NULL CHECK (category IN ('aio_proposal','backup','crawl','health_check','metrics_sync','publish','seo_audit')),
  schema_version integer NOT NULL CHECK (schema_version > 0), record_id uuid NOT NULL,
  dedupe_key varchar(160) NOT NULL, trace_id varchar(128) NOT NULL,
  state varchar(30) NOT NULL CHECK (state IN ('queued','running','succeeded','failed','skipped','cancelled')),
  policy_version integer NOT NULL, attempt_limit integer NOT NULL CHECK (attempt_limit BETWEEN 1 AND 10),
  expires_at timestamptz(3) NOT NULL, hold boolean NOT NULL DEFAULT false,
  audit_referenced boolean NOT NULL DEFAULT false,
  created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
  completed_at timestamptz(3),
  UNIQUE (tenant_id, site_id, category, dedupe_key),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX jobs_scope_state_created_idx ON jobs (tenant_id, site_id, state, created_at);

CREATE TABLE job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT, attempt integer NOT NULL CHECK (attempt > 0),
  state varchar(30) NOT NULL CHECK (state IN ('running','succeeded','failed','stalled','cancelled')),
  worker_id_hash char(64), error_category varchar(40), safe_error varchar(500),
  started_at timestamptz(3) NOT NULL, lease_expires_at timestamptz(3), completed_at timestamptz(3),
  UNIQUE (job_id, attempt), FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX job_runs_scope_started_idx ON job_runs (tenant_id, site_id, started_at);

GRANT SELECT, INSERT, UPDATE ON jobs, job_runs TO omnireach_app, omnireach_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON jobs, job_runs TO omnireach_platform;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY; ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE job_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_jobs ON jobs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_job_runs ON job_runs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION prevent_job_history_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.hold OR OLD.audit_referenced OR OLD.completed_at IS NULL OR OLD.completed_at > now() - interval '90 days' THEN
    RAISE EXCEPTION 'job is retained';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER retained_job_no_delete BEFORE DELETE ON jobs FOR EACH ROW EXECUTE FUNCTION prevent_job_history_delete();
