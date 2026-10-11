CREATE TABLE build_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  artifact_hash char(64) NOT NULL, snapshot_hash char(64) NOT NULL, code_sha varchar(64) NOT NULL,
  contract_version varchar(32) NOT NULL, content_revision integer NOT NULL, asset_manifest_hash char(64) NOT NULL,
  manifest jsonb NOT NULL, status varchar(30) NOT NULL CHECK (status IN ('building','verified','failed','active','superseded')),
  created_at timestamptz(3) NOT NULL DEFAULT now(), verified_at timestamptz(3),
  UNIQUE (tenant_id, site_id, artifact_hash), UNIQUE (tenant_id, site_id, id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE active_artifacts (
  tenant_id uuid NOT NULL, site_id uuid NOT NULL, artifact_id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1, updated_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, site_id), FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, site_id, artifact_id) REFERENCES build_artifacts(tenant_id, site_id, id) ON DELETE RESTRICT
);

CREATE TABLE contact_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  form_id varchar(100) NOT NULL, encrypted_payload bytea NOT NULL, key_version integer NOT NULL,
  consent_at timestamptz(3) NOT NULL, delivery_state varchar(30) NOT NULL CHECK (delivery_state IN ('pending','delivered','failed','discarded')),
  provider_reference varchar(200), attempts integer NOT NULL DEFAULT 0, last_error_code varchar(100),
  created_at timestamptz(3) NOT NULL DEFAULT now(), expires_at timestamptz(3) NOT NULL,
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX contact_submissions_retention_idx ON contact_submissions (expires_at);

GRANT SELECT, INSERT, UPDATE ON build_artifacts, active_artifacts, contact_submissions TO omnireach_app, omnireach_worker;
GRANT DELETE ON active_artifacts TO omnireach_app, omnireach_worker;
ALTER TABLE build_artifacts ENABLE ROW LEVEL SECURITY; ALTER TABLE build_artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE active_artifacts ENABLE ROW LEVEL SECURITY; ALTER TABLE active_artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY; ALTER TABLE contact_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_build_artifacts ON build_artifacts USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_active_artifacts ON active_artifacts USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_contact_submissions ON contact_submissions USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
