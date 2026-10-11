CREATE TABLE ai_model_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), model_alias varchar(120) NOT NULL, version integer NOT NULL,
  input_usd_micros_per_million bigint NOT NULL CHECK (input_usd_micros_per_million >= 0),
  output_usd_micros_per_million bigint NOT NULL CHECK (output_usd_micros_per_million >= 0),
  effective_at timestamptz(3) NOT NULL, source_reference varchar(500) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(), UNIQUE (model_alias, version)
);
CREATE TABLE site_ai_budgets (
  tenant_id uuid NOT NULL, site_id uuid NOT NULL, cap_usd_micros bigint NOT NULL DEFAULT 5000000 CHECK (cap_usd_micros >= 0),
  policy_version integer NOT NULL, override_reason varchar(500), override_actor_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz(3) NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, site_id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((override_reason IS NULL) = (override_actor_id IS NULL))
);
CREATE TABLE ai_budget_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  period_start timestamptz(3) NOT NULL, cap_usd_micros bigint NOT NULL CHECK (cap_usd_micros >= 0),
  reserved_usd_micros bigint NOT NULL DEFAULT 0 CHECK (reserved_usd_micros >= 0),
  used_usd_micros bigint NOT NULL DEFAULT 0 CHECK (used_usd_micros >= 0),
  UNIQUE (tenant_id, site_id, period_start), FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  CHECK (period_start = date_trunc('month', period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
);
CREATE TABLE ai_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  period_id uuid NOT NULL REFERENCES ai_budget_periods(id) ON DELETE RESTRICT, job_id uuid REFERENCES jobs(id) ON DELETE RESTRICT,
  amount_usd_micros bigint NOT NULL CHECK (amount_usd_micros > 0),
  state varchar(20) NOT NULL CHECK (state IN ('active','reconciled','released','expired')),
  expires_at timestamptz(3) NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT now(), reconciled_at timestamptz(3),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX ai_reservations_scope_state_expiry_idx ON ai_reservations (tenant_id, site_id, state, expires_at);
CREATE TABLE ai_usage_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  period_id uuid NOT NULL REFERENCES ai_budget_periods(id) ON DELETE RESTRICT,
  reservation_id uuid REFERENCES ai_reservations(id) ON DELETE RESTRICT,
  kind varchar(20) NOT NULL CHECK (kind IN ('charge','correction')), amount_usd_micros bigint NOT NULL,
  model_price_version integer NOT NULL, provider_request_hash char(64), correction_of uuid REFERENCES ai_usage_entries(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT now(), FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((kind = 'charge' AND amount_usd_micros >= 0) OR (kind = 'correction' AND amount_usd_micros <> 0))
);
CREATE INDEX ai_usage_scope_created_idx ON ai_usage_entries (tenant_id, site_id, created_at);

GRANT SELECT ON ai_model_prices TO omnireach_app, omnireach_worker;
GRANT SELECT, INSERT, UPDATE ON site_ai_budgets, ai_budget_periods, ai_reservations, ai_usage_entries TO omnireach_app, omnireach_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_model_prices, site_ai_budgets, ai_budget_periods, ai_reservations, ai_usage_entries TO omnireach_platform;
ALTER TABLE site_ai_budgets ENABLE ROW LEVEL SECURITY; ALTER TABLE site_ai_budgets FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_budget_periods ENABLE ROW LEVEL SECURITY; ALTER TABLE ai_budget_periods FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_reservations ENABLE ROW LEVEL SECURITY; ALTER TABLE ai_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_entries ENABLE ROW LEVEL SECURITY; ALTER TABLE ai_usage_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_site_ai_budgets ON site_ai_budgets USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_ai_budget_periods ON ai_budget_periods USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_ai_reservations ON ai_reservations USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_ai_usage_entries ON ai_usage_entries USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION prevent_ai_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AI usage ledger is immutable; insert a correction'; END $$;
CREATE TRIGGER ai_usage_no_update_delete BEFORE UPDATE OR DELETE ON ai_usage_entries FOR EACH ROW EXECUTE FUNCTION prevent_ai_ledger_mutation();

CREATE OR REPLACE FUNCTION reserve_ai_budget(p_tenant uuid, p_site uuid, p_amount bigint, p_expires timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_period timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
DECLARE v_period_id uuid; DECLARE v_cap bigint;
BEGIN
  IF p_tenant <> NULLIF(current_setting('app.tenant_id', true), '')::uuid OR p_site <> NULLIF(current_setting('app.site_id', true), '')::uuid THEN RAISE EXCEPTION 'scope mismatch'; END IF;
  SELECT cap_usd_micros INTO v_cap FROM site_ai_budgets WHERE tenant_id = p_tenant AND site_id = p_site;
  v_cap := COALESCE(v_cap, 5000000);
  INSERT INTO ai_budget_periods (tenant_id, site_id, period_start, cap_usd_micros) VALUES (p_tenant, p_site, v_period, v_cap)
    ON CONFLICT (tenant_id, site_id, period_start) DO NOTHING;
  SELECT id INTO v_period_id FROM ai_budget_periods WHERE tenant_id = p_tenant AND site_id = p_site AND period_start = v_period FOR UPDATE;
  UPDATE ai_reservations SET state = 'expired' WHERE period_id = v_period_id AND state = 'active' AND expires_at <= now();
  UPDATE ai_budget_periods SET reserved_usd_micros = COALESCE((SELECT sum(amount_usd_micros) FROM ai_reservations WHERE period_id = v_period_id AND state = 'active'),0) WHERE id = v_period_id;
  IF (SELECT reserved_usd_micros + used_usd_micros + p_amount > cap_usd_micros FROM ai_budget_periods WHERE id = v_period_id) THEN RAISE EXCEPTION 'AI budget hard cap exceeded'; END IF;
  INSERT INTO ai_reservations (tenant_id, site_id, period_id, amount_usd_micros, state, expires_at) VALUES (p_tenant, p_site, v_period_id, p_amount, 'active', p_expires) RETURNING id INTO v_period_id;
  UPDATE ai_budget_periods SET reserved_usd_micros = reserved_usd_micros + p_amount WHERE tenant_id = p_tenant AND site_id = p_site AND period_start = v_period;
  RETURN v_period_id;
END $$;
GRANT EXECUTE ON FUNCTION reserve_ai_budget(uuid, uuid, bigint, timestamptz) TO omnireach_app, omnireach_worker;
