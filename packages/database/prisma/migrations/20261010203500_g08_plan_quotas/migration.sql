ALTER TABLE plans
  ADD COLUMN monthly_price_cents integer NOT NULL DEFAULT 0 CHECK (monthly_price_cents >= 0),
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN commercial_status varchar(20) NOT NULL DEFAULT 'proposal'
    CHECK (commercial_status IN ('proposal','approved')),
  ADD COLUMN customer_seat_limit integer NOT NULL DEFAULT 1 CHECK (customer_seat_limit > 0),
  ADD COLUMN standard_page_limit integer NOT NULL DEFAULT 1 CHECK (standard_page_limit > 0),
  ADD COLUMN business_location_limit integer NOT NULL DEFAULT 1 CHECK (business_location_limit > 0),
  ADD COLUMN seo_audit_interval_hours integer NOT NULL DEFAULT 168
    CHECK (seo_audit_interval_hours IN (24,168)),
  ADD COLUMN ai_review_cycles_per_month integer NOT NULL DEFAULT 0
    CHECK (ai_review_cycles_per_month >= 0),
  ADD COLUMN pending_invitations_count_as_seats boolean NOT NULL DEFAULT true;

ALTER TABLE feature_definitions
  ADD COLUMN readiness varchar(20) NOT NULL DEFAULT 'planned'
    CHECK (readiness IN ('planned','tested','deployable'));

ALTER TABLE sites
  ADD COLUMN standard_page_count integer NOT NULL DEFAULT 1 CHECK (standard_page_count > 0),
  ADD COLUMN business_location_count integer NOT NULL DEFAULT 1 CHECK (business_location_count > 0);

CREATE TABLE plan_quota_usage (
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  quota_key varchar(80) NOT NULL,
  period_start date NOT NULL,
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, site_id, quota_key, period_start),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);

ALTER TABLE plan_quota_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_quota_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_plan_quota_usage ON plan_quota_usage
  USING ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member') OR pg_has_role(current_user, 'omnireach_worker', 'member'))
  WITH CHECK ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member') OR pg_has_role(current_user, 'omnireach_worker', 'member'));

GRANT SELECT, INSERT, UPDATE ON plan_quota_usage TO omnireach_platform, omnireach_worker;
GRANT SELECT ON plan_quota_usage TO omnireach_app;

UPDATE feature_definitions SET readiness = 'tested'
 WHERE key IN ('content.edit','content.publish','content.ai.auto','public.serving');

INSERT INTO plans
  (id, code, name, version, active, monthly_price_cents, currency, commercial_status,
   customer_seat_limit, standard_page_limit, business_location_limit,
   seo_audit_interval_hours, ai_review_cycles_per_month,
   pending_invitations_count_as_seats)
VALUES
  ('91000000-0000-4000-8000-000000000001', 'STARTER', 'Starter', 1, true,
   50000, 'USD', 'proposal', 2, 5, 1, 168, 2, true),
  ('91000000-0000-4000-8000-000000000002', 'GROWTH', 'Growth', 1, true,
   100000, 'USD', 'proposal', 5, 10, 1, 24, 8, true),
  ('91000000-0000-4000-8000-000000000003', 'PRO', 'Pro', 1, true,
   150000, 'USD', 'proposal', 10, 20, 1, 24, 16, true),
  ('91000000-0000-4000-8000-000000000004', 'ELITE', 'Elite', 1, true,
   200000, 'USD', 'proposal', 20, 30, 1, 24, 30, true)
ON CONFLICT (code, version) DO NOTHING;
