CREATE TABLE crawl_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  job_id uuid REFERENCES jobs(id) ON DELETE RESTRICT, method_version integer NOT NULL CHECK (method_version > 0),
  source varchar(30) NOT NULL CHECK (source IN ('manifest','sitemap','internal_link','manual')),
  start_url varchar(2048) NOT NULL, scope jsonb NOT NULL, limits jsonb NOT NULL,
  state varchar(30) NOT NULL CHECK (state IN ('running','succeeded','failed','cancelled','truncated')),
  started_at timestamptz(3) NOT NULL, completed_at timestamptz(3),
  expires_at timestamptz(3) NOT NULL, hold boolean NOT NULL DEFAULT false,
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX crawl_runs_scope_started_idx ON crawl_runs (tenant_id, site_id, started_at);
CREATE TABLE crawl_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  crawl_run_id uuid NOT NULL REFERENCES crawl_runs(id) ON DELETE RESTRICT, url varchar(2048) NOT NULL,
  status integer NOT NULL, content_type varchar(120), evidence jsonb NOT NULL, body_hash char(64),
  truncated boolean NOT NULL DEFAULT false, fetched_at timestamptz(3) NOT NULL,
  UNIQUE (crawl_run_id, url), FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX crawl_pages_scope_run_idx ON crawl_pages (tenant_id, site_id, crawl_run_id);
CREATE TABLE crawl_link_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  crawl_run_id uuid NOT NULL REFERENCES crawl_runs(id) ON DELETE RESTRICT,
  source_url varchar(2048) NOT NULL, target_url varchar(2048) NOT NULL, relation varchar(30) NOT NULL,
  UNIQUE (crawl_run_id, source_url, target_url, relation), FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
GRANT SELECT, INSERT, UPDATE ON crawl_runs, crawl_pages, crawl_link_edges TO omnireach_app, omnireach_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON crawl_runs, crawl_pages, crawl_link_edges TO omnireach_platform;
ALTER TABLE crawl_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE crawl_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE crawl_pages ENABLE ROW LEVEL SECURITY; ALTER TABLE crawl_pages FORCE ROW LEVEL SECURITY;
ALTER TABLE crawl_link_edges ENABLE ROW LEVEL SECURITY; ALTER TABLE crawl_link_edges FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_crawl_runs ON crawl_runs USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_crawl_pages ON crawl_pages USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_crawl_link_edges ON crawl_link_edges USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
