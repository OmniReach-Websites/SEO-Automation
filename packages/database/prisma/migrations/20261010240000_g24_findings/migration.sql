CREATE TABLE audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  crawl_run_id uuid REFERENCES crawl_runs(id) ON DELETE RESTRICT, kind varchar(20) NOT NULL CHECK (kind IN ('seo','aio')),
  rule_set_version integer NOT NULL CHECK (rule_set_version > 0), state varchar(30) NOT NULL CHECK (state IN ('running','succeeded','failed','cancelled')),
  limitations jsonb NOT NULL DEFAULT '[]'::jsonb, started_at timestamptz(3) NOT NULL, completed_at timestamptz(3),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX audit_runs_scope_started_idx ON audit_runs (tenant_id, site_id, started_at);
CREATE TABLE findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  audit_run_id uuid NOT NULL REFERENCES audit_runs(id) ON DELETE RESTRICT, fingerprint char(64) NOT NULL,
  rule_id varchar(120) NOT NULL, rule_version integer NOT NULL, severity varchar(20) NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  state varchar(30) NOT NULL CHECK (state IN ('open','acknowledged','resolved','suppressed')),
  evidence jsonb NOT NULL, limitation text NOT NULL, remediation varchar(40) NOT NULL CHECK (remediation IN ('contract_metadata','contract_text','manual','none')),
  first_seen_at timestamptz(3) NOT NULL, last_seen_at timestamptz(3) NOT NULL, resolved_at timestamptz(3),
  UNIQUE (tenant_id, site_id, fingerprint), FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX findings_scope_state_severity_idx ON findings (tenant_id, site_id, state, severity);
GRANT SELECT, INSERT, UPDATE ON audit_runs, findings TO omnireach_app, omnireach_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_runs, findings TO omnireach_platform;
ALTER TABLE audit_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE findings ENABLE ROW LEVEL SECURITY; ALTER TABLE findings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_audit_runs ON audit_runs USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_findings ON findings USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
