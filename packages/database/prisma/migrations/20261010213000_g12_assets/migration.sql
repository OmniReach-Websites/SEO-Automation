CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  storage_key varchar(700) NOT NULL, original_filename varchar(160) NOT NULL, mime varchar(100) NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0), checksum char(64) NOT NULL,
  width integer, height integer, integrity_state varchar(30) NOT NULL CHECK (integrity_state IN ('quarantined','validated','rejected')),
  alt_text varchar(500), attribution text, quarantine_reason varchar(500),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz(3) NOT NULL DEFAULT now(),
  unreferenced_at timestamptz(3), deleted_at timestamptz(3),
  UNIQUE (tenant_id, site_id, storage_key), UNIQUE (tenant_id, site_id, checksum), UNIQUE (tenant_id, site_id, id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  CHECK (storage_key LIKE site_id::text || '/%')
);

CREATE TABLE asset_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  asset_id uuid NOT NULL, variant varchar(60) NOT NULL,
  storage_key varchar(700) NOT NULL, mime varchar(100) NOT NULL, byte_size bigint NOT NULL CHECK (byte_size > 0),
  checksum char(64) NOT NULL, width integer, height integer, created_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (asset_id, variant), FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, site_id, asset_id) REFERENCES assets(tenant_id, site_id, id) ON DELETE RESTRICT
);

CREATE TABLE asset_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  reference_type varchar(30) NOT NULL CHECK (reference_type IN ('draft','revision','artifact')),
  reference_id uuid NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (asset_id, reference_type, reference_id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, site_id, asset_id) REFERENCES assets(tenant_id, site_id, id) ON DELETE RESTRICT
);

GRANT SELECT, INSERT, UPDATE ON assets, asset_variants, asset_references TO omnireach_app;
GRANT SELECT, INSERT, UPDATE ON assets, asset_variants, asset_references TO omnireach_worker;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY; ALTER TABLE assets FORCE ROW LEVEL SECURITY;
ALTER TABLE asset_variants ENABLE ROW LEVEL SECURITY; ALTER TABLE asset_variants FORCE ROW LEVEL SECURITY;
ALTER TABLE asset_references ENABLE ROW LEVEL SECURITY; ALTER TABLE asset_references FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_assets ON assets USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_asset_variants ON asset_variants USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_asset_references ON asset_references USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
