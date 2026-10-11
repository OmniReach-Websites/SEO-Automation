ALTER TABLE domains DROP CONSTRAINT domains_verification_status_check;
ALTER TABLE domains
  ADD COLUMN onboarding_state varchar(32) NOT NULL DEFAULT 'requested',
  ADD COLUMN provider varchar(32),
  ADD COLUMN provider_zone_ref varchar(160),
  ADD COLUMN credential_ref varchar(200),
  ADD COLUMN verification_evidence jsonb,
  ADD COLUMN verified_at timestamptz(3),
  ADD COLUMN tls_checked_at timestamptz(3),
  ADD COLUMN retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN retry_after timestamptz(3),
  ADD COLUMN last_error_code varchar(100),
  ADD CONSTRAINT domains_verification_status_check CHECK (verification_status IN ('pending','verified','failed')),
  ADD CONSTRAINT domains_onboarding_state_check CHECK (onboarding_state IN ('requested','awaiting_ownership','dns_pending','verified','tls_pending','active','failed','disabled')),
  ADD CONSTRAINT domains_provider_reference_check CHECK (
    (provider IS NULL AND provider_zone_ref IS NULL AND credential_ref IS NULL)
    OR (provider IS NOT NULL AND provider_zone_ref IS NOT NULL AND credential_ref IS NOT NULL)
  );

CREATE TABLE domain_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  domain_id uuid NOT NULL REFERENCES domains(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key varchar(160) NOT NULL,
  operation varchar(40) NOT NULL CHECK (operation IN ('dns_plan','dns_apply','verify','disable','restore')),
  dry_run boolean NOT NULL,
  proposed_changes jsonb NOT NULL,
  outcome varchar(30) NOT NULL CHECK (outcome IN ('planned','applied','noop','failed')),
  provider_request_ref varchar(160),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, site_id, idempotency_key),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX domain_operations_scope_created_idx ON domain_operations (tenant_id, site_id, created_at);

GRANT SELECT, INSERT, UPDATE ON domain_operations TO omnireach_app, omnireach_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON domain_operations TO omnireach_platform;
ALTER TABLE domain_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_domain_operations ON domain_operations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION prevent_domain_operation_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'domain operation history cannot be deleted'; END $$;
CREATE TRIGGER domain_operation_no_delete BEFORE DELETE ON domain_operations
FOR EACH ROW EXECUTE FUNCTION prevent_domain_operation_delete();
