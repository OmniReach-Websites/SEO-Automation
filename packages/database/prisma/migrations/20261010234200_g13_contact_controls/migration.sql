CREATE TABLE site_contact_forms (
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  form_id varchar(100) NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  declared_field_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled_field_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_field_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  confirmation_enabled boolean NOT NULL DEFAULT false,
  recipient_email varchar(320),
  recipient_verified_at timestamptz(3),
  retention_days integer NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 365),
  reason varchar(500) NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  policy_version integer NOT NULL CHECK (policy_version > 0),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, site_id, form_id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  CHECK (jsonb_typeof(declared_field_ids) = 'array'),
  CHECK (jsonb_typeof(enabled_field_ids) = 'array'),
  CHECK (jsonb_typeof(required_field_ids) = 'array'),
  CHECK (recipient_verified_at IS NULL OR recipient_email IS NOT NULL)
);

ALTER TABLE contact_submissions
  ADD COLUMN legal_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN hold_reason varchar(500),
  ADD COLUMN held_at timestamptz(3),
  ADD COLUMN held_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT contact_submission_hold_metadata CHECK (
    (NOT legal_hold AND hold_reason IS NULL AND held_at IS NULL AND held_by IS NULL) OR
    (legal_hold AND hold_reason IS NOT NULL AND held_at IS NOT NULL AND held_by IS NOT NULL)
  );

ALTER TABLE site_contact_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_contact_forms FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_site_contact_forms ON site_contact_forms
  USING ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member') OR pg_has_role(current_user, 'omnireach_worker', 'member'))
  WITH CHECK ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member') OR pg_has_role(current_user, 'omnireach_worker', 'member'));

GRANT SELECT, INSERT, UPDATE ON site_contact_forms TO omnireach_app, omnireach_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON site_contact_forms TO omnireach_platform;
GRANT DELETE ON contact_submissions TO omnireach_worker;
GRANT SELECT, UPDATE ON contact_submissions TO omnireach_platform;

DROP POLICY tenant_scope_contact_submissions ON contact_submissions;
CREATE POLICY tenant_scope_contact_submissions ON contact_submissions
  USING ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member'))
  WITH CHECK ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member'));

INSERT INTO feature_definitions
  (key, version, description, overrideable, safe_default, readiness)
VALUES
  ('contact.forms', 1, 'Centralized optional website contact forms', true, false, 'tested')
ON CONFLICT (key, version) DO UPDATE SET readiness = 'tested';
