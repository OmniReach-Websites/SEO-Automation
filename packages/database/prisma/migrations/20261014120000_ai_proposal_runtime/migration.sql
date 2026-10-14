-- Durable, scope-bound material for the disabled-by-default AI proposal worker.
-- Provider credentials and responses never belong in this table.

ALTER TABLE ai_model_prices
  ADD COLUMN provider_model varchar(120);

UPDATE ai_model_prices
   SET provider_model = model_alias
 WHERE provider_model IS NULL;

ALTER TABLE ai_model_prices
  ALTER COLUMN provider_model SET NOT NULL;

INSERT INTO ai_model_prices
  (model_alias, version, provider_model, input_usd_micros_per_million,
   output_usd_micros_per_million, effective_at, source_reference)
VALUES
  ('content-review-balanced', 1, 'gpt-6.1-sol', 2000000, 10000000,
   '2026-10-14T00:00:00Z',
   'https://developers.openai.com/api/docs/models/gpt-6.1-sol'),
  ('content-review-economy', 1, 'gpt-6-luna', 100000, 500000,
   '2026-10-14T00:00:00Z',
   'https://developers.openai.com/api/docs/models/gpt-6-luna')
ON CONFLICT (model_alias, version) DO NOTHING;

ALTER TABLE content_proposals
  ADD CONSTRAINT content_proposals_runtime_scope_id_key
    UNIQUE (tenant_id, site_id, id);

CREATE TABLE ai_proposal_job_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  field_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_key char(64) NOT NULL CHECK (request_key ~ '^[a-f0-9]{64}$'),
  base_revision integer NOT NULL CHECK (base_revision > 0),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  field_purpose varchar(200) NOT NULL CHECK (length(trim(field_purpose)) > 0),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_value_hash char(64) NOT NULL CHECK (source_value_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz(3) NOT NULL,
  proposal_id uuid,
  completed_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, site_id, id),
  UNIQUE (tenant_id, site_id, request_key),
  FOREIGN KEY (tenant_id, site_id)
    REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, site_id, field_id)
    REFERENCES content_fields(tenant_id, site_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, site_id, base_revision)
    REFERENCES content_revisions(tenant_id, site_id, revision) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, site_id, proposal_id)
    REFERENCES content_proposals(tenant_id, site_id, id) ON DELETE RESTRICT,
  CHECK (jsonb_typeof(evidence) = 'array'),
  CHECK (jsonb_array_length(evidence) <= 10),
  CHECK (octet_length(evidence::text) <= 12000),
  CHECK (expires_at > created_at),
  CHECK ((proposal_id IS NULL) = (completed_at IS NULL))
);

CREATE INDEX ai_proposal_job_materials_scope_created_idx
  ON ai_proposal_job_materials (tenant_id, site_id, created_at DESC);

CREATE OR REPLACE FUNCTION protect_ai_proposal_job_material()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.site_id IS DISTINCT FROM OLD.site_id
     OR NEW.field_id IS DISTINCT FROM OLD.field_id
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.request_key IS DISTINCT FROM OLD.request_key
     OR NEW.base_revision IS DISTINCT FROM OLD.base_revision
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.field_purpose IS DISTINCT FROM OLD.field_purpose
     OR NEW.evidence IS DISTINCT FROM OLD.evidence
     OR NEW.source_value_hash IS DISTINCT FROM OLD.source_value_hash
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'AI proposal job material is immutable';
  END IF;
  IF OLD.proposal_id IS NOT NULL
     AND (NEW.proposal_id IS DISTINCT FROM OLD.proposal_id
       OR NEW.completed_at IS DISTINCT FROM OLD.completed_at) THEN
    RAISE EXCEPTION 'AI proposal job result is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER ai_proposal_job_materials_immutable
BEFORE UPDATE ON ai_proposal_job_materials
FOR EACH ROW EXECUTE FUNCTION protect_ai_proposal_job_material();

CREATE OR REPLACE FUNCTION enforce_ai_charge_within_reservation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reserved_amount bigint;
BEGIN
  IF NEW.kind = 'charge' AND NEW.reservation_id IS NOT NULL THEN
    SELECT amount_usd_micros INTO reserved_amount
      FROM ai_reservations
     WHERE tenant_id = NEW.tenant_id
       AND site_id = NEW.site_id
       AND id = NEW.reservation_id;
    IF reserved_amount IS NULL OR NEW.amount_usd_micros > reserved_amount THEN
      RAISE EXCEPTION 'AI charge exceeds its reservation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER ai_usage_charge_reservation_guard
BEFORE INSERT ON ai_usage_entries
FOR EACH ROW EXECUTE FUNCTION enforce_ai_charge_within_reservation();

GRANT SELECT, INSERT ON ai_proposal_job_materials TO omnireach_app;
GRANT SELECT, UPDATE ON ai_proposal_job_materials TO omnireach_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_proposal_job_materials TO omnireach_platform;

ALTER TABLE worker_heartbeats DROP CONSTRAINT IF EXISTS worker_heartbeats_worker_kind_check;
ALTER TABLE worker_heartbeats ADD CONSTRAINT worker_heartbeats_worker_kind_check
  CHECK (worker_kind IN ('scheduler','runner','publisher','crawler','seo','monitoring','aio'));

ALTER TABLE ai_proposal_job_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_proposal_job_materials FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope_ai_proposal_job_materials
ON ai_proposal_job_materials
USING (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid
);
