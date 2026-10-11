ALTER TABLE content_proposals
  ADD COLUMN prompt_version integer,
  ADD COLUMN evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN rationale text,
  ADD COLUMN input_tokens integer,
  ADD COLUMN output_tokens integer,
  ADD COLUMN latency_ms integer,
  ADD COLUMN provider_request_hash char(64),
  ADD COLUMN expires_at timestamptz(3),
  ADD CONSTRAINT proposal_usage_nonnegative CHECK (input_tokens IS NULL OR (input_tokens >= 0 AND output_tokens >= 0 AND latency_ms >= 0));

CREATE TABLE ai_evaluation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fixture_id varchar(120) NOT NULL,
  model_alias varchar(120) NOT NULL, prompt_version integer NOT NULL, schema_version integer NOT NULL,
  passed boolean NOT NULL, safe_result jsonb NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (fixture_id, model_alias, prompt_version, schema_version)
);
CREATE TABLE sampled_ai_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  provider varchar(40) NOT NULL, model_alias varchar(120) NOT NULL, prompt_hash char(64) NOT NULL,
  geography varchar(120) NOT NULL, context varchar(200) NOT NULL, repetitions integer NOT NULL CHECK (repetitions BETWEEN 1 AND 20),
  observed jsonb NOT NULL, limitations text NOT NULL, sampled_at timestamptz(3) NOT NULL,
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
GRANT SELECT, INSERT ON ai_evaluation_results TO omnireach_worker;
GRANT SELECT, INSERT, UPDATE ON sampled_ai_mentions TO omnireach_app, omnireach_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_evaluation_results, sampled_ai_mentions TO omnireach_platform;
ALTER TABLE sampled_ai_mentions ENABLE ROW LEVEL SECURITY; ALTER TABLE sampled_ai_mentions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_sampled_ai_mentions ON sampled_ai_mentions USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
