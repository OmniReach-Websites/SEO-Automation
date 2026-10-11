CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(80) NOT NULL, name varchar(160) NOT NULL,
  version integer NOT NULL CHECK (version > 0), active boolean NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT now(), UNIQUE (code, version)
);
CREATE TABLE feature_definitions (
  key varchar(120) NOT NULL, version integer NOT NULL CHECK (version > 0), description text NOT NULL,
  overrideable boolean NOT NULL DEFAULT true, safe_default boolean NOT NULL DEFAULT false,
  created_at timestamptz(3) NOT NULL DEFAULT now(), PRIMARY KEY (key, version)
);
CREATE TABLE plan_features (
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT, feature_key varchar(120) NOT NULL,
  feature_version integer NOT NULL, enabled boolean NOT NULL,
  PRIMARY KEY (plan_id, feature_key), FOREIGN KEY (feature_key, feature_version) REFERENCES feature_definitions(key, version)
);
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status varchar(30) NOT NULL CHECK (status IN ('active','past_due','cancelled')),
  grace_ends_at timestamptz(3), created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (site_id), UNIQUE (tenant_id, site_id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
CREATE TABLE site_feature_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
  feature_key varchar(120) NOT NULL, feature_version integer NOT NULL, enabled boolean NOT NULL,
  reason varchar(500) NOT NULL, actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  effective_at timestamptz(3) NOT NULL DEFAULT now(), policy_version integer NOT NULL CHECK (policy_version > 0),
  UNIQUE (site_id, feature_key), FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (feature_key, feature_version) REFERENCES feature_definitions(key, version)
);
CREATE TABLE site_emergency_controls (
  tenant_id uuid NOT NULL, site_id uuid NOT NULL, editing_frozen boolean NOT NULL DEFAULT false,
  autonomous_changes_stopped boolean NOT NULL DEFAULT false, automation_stopped boolean NOT NULL DEFAULT false,
  reason varchar(500) NOT NULL, actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  policy_version integer NOT NULL CHECK (policy_version > 0), updated_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, site_id), FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
GRANT SELECT ON plans, feature_definitions, plan_features TO omnireach_app, omnireach_worker;
GRANT SELECT, INSERT, UPDATE ON subscriptions, site_feature_overrides, site_emergency_controls TO omnireach_app;
GRANT SELECT ON subscriptions, site_feature_overrides, site_emergency_controls TO omnireach_worker;
GRANT SELECT, INSERT, UPDATE ON plans, feature_definitions, plan_features, subscriptions,
  site_feature_overrides, site_emergency_controls TO omnireach_platform;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY; ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE site_feature_overrides ENABLE ROW LEVEL SECURITY; ALTER TABLE site_feature_overrides FORCE ROW LEVEL SECURITY;
ALTER TABLE site_emergency_controls ENABLE ROW LEVEL SECURITY; ALTER TABLE site_emergency_controls FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_subscriptions ON subscriptions
  USING ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member'))
  WITH CHECK ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member'));
CREATE POLICY tenant_scope_feature_overrides ON site_feature_overrides
  USING ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member'))
  WITH CHECK ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member'));
CREATE POLICY tenant_scope_emergency_controls ON site_emergency_controls
  USING ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member'))
  WITH CHECK ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member'));
