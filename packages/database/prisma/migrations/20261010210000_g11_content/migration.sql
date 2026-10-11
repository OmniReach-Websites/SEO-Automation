CREATE TABLE content_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  stable_id varchar(100) NOT NULL, route varchar(300) NOT NULL, schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, site_id, stable_id), UNIQUE (tenant_id, site_id, id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE content_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  page_id uuid NOT NULL, stable_id varchar(100) NOT NULL,
  field_type varchar(40) NOT NULL, protected boolean NOT NULL DEFAULT false,
  ai_mode varchar(20) NOT NULL CHECK (ai_mode IN ('auto', 'suggestion', 'disabled')),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, site_id, stable_id), UNIQUE (tenant_id, site_id, id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, site_id, page_id) REFERENCES content_pages(tenant_id, site_id, id) ON DELETE RESTRICT,
  CHECK (NOT protected OR ai_mode = 'disabled')
);

CREATE TABLE business_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  stable_id varchar(100) NOT NULL, kind varchar(30) NOT NULL CHECK (kind IN ('price','hours','address','contact','legal')),
  value jsonb NOT NULL, provenance text NOT NULL, verified_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  verified_at timestamptz(3) NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, site_id, stable_id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE content_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  base_revision integer NOT NULL, version integer NOT NULL DEFAULT 1 CHECK (version > 0), content jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE content_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0), schema_version integer NOT NULL,
  content jsonb NOT NULL, facts_snapshot jsonb NOT NULL, created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  origin varchar(30) NOT NULL CHECK (origin IN ('human','proposal','restore','seed')),
  restored_from integer, created_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, site_id, revision),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE content_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  field_id uuid NOT NULL,
  base_revision integer NOT NULL, state varchar(20) NOT NULL CHECK (state IN ('pending','approved','rejected','applied','stale')),
  proposed_value jsonb NOT NULL, provider varchar(80), model varchar(120), policy_version integer NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(), decided_at timestamptz(3), decided_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, site_id, field_id) REFERENCES content_fields(tenant_id, site_id, id) ON DELETE RESTRICT
);

CREATE INDEX content_drafts_scope_idx ON content_drafts (tenant_id, site_id, updated_at);
CREATE INDEX content_revisions_scope_idx ON content_revisions (tenant_id, site_id, revision DESC);
CREATE INDEX content_proposals_scope_state_idx ON content_proposals (tenant_id, site_id, state);

CREATE OR REPLACE FUNCTION prevent_protected_field_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM content_fields
    WHERE content_fields.tenant_id = NEW.tenant_id
      AND content_fields.site_id = NEW.site_id
      AND content_fields.id = NEW.field_id
      AND (content_fields.protected OR content_fields.ai_mode = 'disabled')
  ) THEN
    RAISE EXCEPTION 'protected or AI-disabled fields cannot receive proposals';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER content_proposals_protected_guard
BEFORE INSERT OR UPDATE OF tenant_id, site_id, field_id ON content_proposals
FOR EACH ROW EXECUTE FUNCTION prevent_protected_field_proposal();

GRANT SELECT, INSERT, UPDATE, DELETE ON content_pages, content_fields, business_facts, content_drafts, content_proposals TO omnireach_app;
GRANT SELECT, INSERT ON content_revisions TO omnireach_app;
GRANT SELECT ON content_pages, content_fields, business_facts TO omnireach_worker;
GRANT SELECT, INSERT, UPDATE ON content_drafts, content_proposals TO omnireach_worker;
GRANT SELECT, INSERT ON content_revisions TO omnireach_worker;

ALTER TABLE content_pages ENABLE ROW LEVEL SECURITY; ALTER TABLE content_pages FORCE ROW LEVEL SECURITY;
ALTER TABLE content_fields ENABLE ROW LEVEL SECURITY; ALTER TABLE content_fields FORCE ROW LEVEL SECURITY;
ALTER TABLE business_facts ENABLE ROW LEVEL SECURITY; ALTER TABLE business_facts FORCE ROW LEVEL SECURITY;
ALTER TABLE content_drafts ENABLE ROW LEVEL SECURITY; ALTER TABLE content_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE content_revisions ENABLE ROW LEVEL SECURITY; ALTER TABLE content_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE content_proposals ENABLE ROW LEVEL SECURITY; ALTER TABLE content_proposals FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope_content_pages ON content_pages USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_content_fields ON content_fields USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_business_facts ON business_facts USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_content_drafts ON content_drafts USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_content_revisions ON content_revisions USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_content_proposals ON content_proposals USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION prevent_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'content revisions are immutable'; END $$;
CREATE TRIGGER content_revisions_immutable BEFORE UPDATE OR DELETE ON content_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_revision_mutation();
