CREATE TABLE schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  category varchar(40) NOT NULL, timezone varchar(100) NOT NULL, local_hour integer NOT NULL CHECK (local_hour BETWEEN 0 AND 23),
  local_minute integer NOT NULL CHECK (local_minute BETWEEN 0 AND 59), jitter_minutes integer NOT NULL CHECK (jitter_minutes BETWEEN 0 AND 120),
  enabled boolean NOT NULL DEFAULT true, next_attempt_at timestamptz(3) NOT NULL, last_window_key varchar(200),
  created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, site_id, category), FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
CREATE TABLE scheduler_lease (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), owner_hash char(64), expires_at timestamptz(3), updated_at timestamptz(3) NOT NULL DEFAULT now()
);
INSERT INTO scheduler_lease(singleton) VALUES (true);
CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, site_id uuid, fingerprint char(64) NOT NULL,
  severity varchar(20) NOT NULL CHECK (severity IN ('info','warning','error','critical')),
  state varchar(20) NOT NULL CHECK (state IN ('open','acknowledged','resolved')), source varchar(80) NOT NULL,
  safe_message varchar(500) NOT NULL, occurrences integer NOT NULL DEFAULT 1 CHECK (occurrences > 0),
  owner_id uuid REFERENCES users(id) ON DELETE RESTRICT, remediation_url varchar(500),
  first_seen_at timestamptz(3) NOT NULL, last_seen_at timestamptz(3) NOT NULL,
  acknowledged_at timestamptz(3), resolved_at timestamptz(3), hold boolean NOT NULL DEFAULT false,
  UNIQUE NULLS NOT DISTINCT (tenant_id, site_id, fingerprint), FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX alerts_scope_state_seen_idx ON alerts (tenant_id, site_id, state, last_seen_at);
CREATE TABLE alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), alert_id uuid NOT NULL REFERENCES alerts(id) ON DELETE RESTRICT,
  channel varchar(20) NOT NULL CHECK (channel IN ('orap','email')), state varchar(20) NOT NULL CHECK (state IN ('pending','sent','failed','suppressed')),
  provider_reference varchar(200), attempt integer NOT NULL DEFAULT 1, error_code varchar(100), created_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (alert_id, channel, attempt)
);
CREATE TABLE operational_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, site_id uuid, trace_id varchar(128) NOT NULL,
  category varchar(80) NOT NULL, safe_detail jsonb NOT NULL, hold boolean NOT NULL DEFAULT false,
  created_at timestamptz(3) NOT NULL DEFAULT now(), expires_at timestamptz(3) NOT NULL DEFAULT (now() + interval '30 days'),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);

GRANT SELECT, INSERT, UPDATE ON schedules, alerts, operational_logs TO omnireach_app, omnireach_worker;
GRANT SELECT, INSERT, UPDATE ON alert_deliveries TO omnireach_worker;
GRANT SELECT, UPDATE ON scheduler_lease TO omnireach_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON schedules, alerts, alert_deliveries, operational_logs TO omnireach_platform;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY; ALTER TABLE schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY; ALTER TABLE alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE operational_logs ENABLE ROW LEVEL SECURITY; ALTER TABLE operational_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_schedules ON schedules USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid);
CREATE POLICY tenant_scope_alerts ON alerts USING ((tenant_id IS NULL AND current_setting('app.platform_role', true) <> '') OR (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND (site_id IS NULL OR site_id = NULLIF(current_setting('app.site_id', true), '')::uuid))) WITH CHECK ((tenant_id IS NULL AND current_setting('app.platform_role', true) <> '') OR (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND (site_id IS NULL OR site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)));
CREATE POLICY tenant_scope_operational_logs ON operational_logs USING ((tenant_id IS NULL AND current_setting('app.platform_role', true) <> '') OR (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND (site_id IS NULL OR site_id = NULLIF(current_setting('app.site_id', true), '')::uuid))) WITH CHECK ((tenant_id IS NULL AND current_setting('app.platform_role', true) <> '') OR (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND (site_id IS NULL OR site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)));
