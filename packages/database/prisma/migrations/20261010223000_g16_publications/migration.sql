CREATE TABLE publication_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  idempotency_key varchar(160) NOT NULL, requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  origin varchar(30) NOT NULL CHECK (origin IN ('customer','orap','restore')), reason varchar(500) NOT NULL,
  content_revision integer NOT NULL, status varchar(30) NOT NULL CHECK (status IN ('queued','building','published','failed')),
  artifact_id uuid,
  previous_artifact_id uuid,
  validation jsonb, timing jsonb, error_code varchar(100),
  created_at timestamptz(3) NOT NULL DEFAULT now(), completed_at timestamptz(3),
  UNIQUE (tenant_id, site_id, idempotency_key), FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, site_id, artifact_id) REFERENCES build_artifacts(tenant_id, site_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, site_id, previous_artifact_id) REFERENCES build_artifacts(tenant_id, site_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX one_active_publication_per_site ON publication_requests (site_id) WHERE status IN ('queued','building');
GRANT SELECT, INSERT, UPDATE ON publication_requests TO omnireach_app, omnireach_worker;
ALTER TABLE publication_requests ENABLE ROW LEVEL SECURITY; ALTER TABLE publication_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_publication_requests ON publication_requests USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION prevent_publication_history_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'publication history cannot be deleted'; END $$;
CREATE TRIGGER publication_history_no_delete BEFORE DELETE ON publication_requests
FOR EACH ROW EXECUTE FUNCTION prevent_publication_history_delete();
