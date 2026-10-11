CREATE TABLE integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  provider varchar(40) NOT NULL CHECK (provider IN ('google')), property_kind varchar(40) NOT NULL CHECK (property_kind IN ('search_console','ga4')),
  property_id varchar(300) NOT NULL, property_mapping varchar(500) NOT NULL, credential_ref varchar(200) NOT NULL,
  scopes jsonb NOT NULL, status varchar(30) NOT NULL CHECK (status IN ('connected','disconnected','expired','insufficient_scope','revoked','error')),
  permissions_provenance jsonb NOT NULL, sync_cursor jsonb, last_synced_at timestamptz(3), disconnected_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, site_id, provider, property_kind), FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
CREATE TABLE metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE RESTRICT,
  source varchar(40) NOT NULL CHECK (source IN ('search_console','ga4')), metric varchar(100) NOT NULL,
  dimensions jsonb NOT NULL, window_start timestamptz(3) NOT NULL, window_end timestamptz(3) NOT NULL,
  value numeric(20,6) NOT NULL, source_hash char(64) NOT NULL, ingested_at timestamptz(3) NOT NULL,
  expires_at timestamptz(3) NOT NULL, UNIQUE (connection_id, source_hash),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  CHECK (window_end >= window_start)
);
CREATE INDEX metric_snapshots_scope_metric_window_idx ON metric_snapshots (tenant_id, site_id, metric, window_start);
GRANT SELECT, INSERT, UPDATE ON integration_connections, metric_snapshots TO omnireach_app, omnireach_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON integration_connections, metric_snapshots TO omnireach_platform;
ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY; ALTER TABLE integration_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE metric_snapshots ENABLE ROW LEVEL SECURITY; ALTER TABLE metric_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_integration_connections ON integration_connections USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_metric_snapshots ON metric_snapshots USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
