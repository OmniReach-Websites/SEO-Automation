ALTER TABLE content_proposals
  ADD COLUMN effective_mode varchar(20) NOT NULL DEFAULT 'SUGGEST',
  ADD COLUMN validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN reviewed_value jsonb,
  ADD COLUMN publication_request_id uuid REFERENCES publication_requests(id) ON DELETE RESTRICT,
  ADD CONSTRAINT proposal_effective_mode_check CHECK (effective_mode IN ('AUTO','SUGGEST'));
CREATE UNIQUE INDEX content_proposals_dedupe_idx ON content_proposals (tenant_id, site_id, field_id, base_revision, policy_version, COALESCE(prompt_version,0)) WHERE state IN ('pending','approved');

CREATE OR REPLACE FUNCTION enforce_proposal_current_field_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_protected boolean; DECLARE v_mode varchar(20);
BEGIN
  SELECT protected, ai_mode INTO v_protected, v_mode FROM content_fields
  WHERE tenant_id = NEW.tenant_id AND site_id = NEW.site_id AND id = NEW.field_id;
  IF v_protected OR v_mode = 'disabled' THEN RAISE EXCEPTION 'protected fields can never receive AI proposals'; END IF;
  IF NEW.effective_mode = 'AUTO' AND v_mode <> 'auto' THEN RAISE EXCEPTION 'AUTO proposal is no longer authorized'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER content_proposals_current_policy_guard BEFORE INSERT OR UPDATE ON content_proposals
FOR EACH ROW EXECUTE FUNCTION enforce_proposal_current_field_policy();

-- The worker remains unable to INSERT/UPDATE/DELETE business_facts. Revoke again so
-- future broad grants cannot accidentally weaken this invariant.
REVOKE INSERT, UPDATE, DELETE ON business_facts FROM omnireach_worker;
