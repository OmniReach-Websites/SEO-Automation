CREATE TABLE site_plan_quota_overrides (
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  quota_key varchar(80) NOT NULL,
  quota_limit integer NOT NULL CHECK (quota_limit >= 0),
  reason varchar(500) NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  policy_version integer NOT NULL CHECK (policy_version > 0),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, site_id, quota_key),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  CHECK (quota_key IN ('ai_review_cycles_per_month'))
);

CREATE TABLE plan_quota_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  quota_key varchar(80) NOT NULL,
  period_start date NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  state varchar(20) NOT NULL DEFAULT 'active'
    CHECK (state IN ('active','consumed','expired','released')),
  expires_at timestamptz(3) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  finalized_at timestamptz(3),
  FOREIGN KEY (tenant_id, site_id, quota_key, period_start)
    REFERENCES plan_quota_usage(tenant_id, site_id, quota_key, period_start) ON DELETE RESTRICT,
  CHECK ((state = 'active' AND finalized_at IS NULL) OR
         (state <> 'active' AND finalized_at IS NOT NULL))
);

CREATE INDEX plan_quota_reservations_active_idx
  ON plan_quota_reservations (tenant_id, site_id, quota_key, period_start, expires_at)
  WHERE state = 'active';

ALTER TABLE site_plan_quota_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_plan_quota_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_site_plan_quota_overrides ON site_plan_quota_overrides
  USING ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member'))
  WITH CHECK ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member'));

ALTER TABLE plan_quota_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_quota_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_plan_quota_reservations ON plan_quota_reservations
  USING ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member') OR pg_has_role(current_user, 'omnireach_worker', 'member'))
  WITH CHECK ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member') OR pg_has_role(current_user, 'omnireach_worker', 'member'));

GRANT SELECT, INSERT, UPDATE ON site_plan_quota_overrides TO omnireach_platform;
GRANT SELECT ON site_plan_quota_overrides TO omnireach_app, omnireach_worker;
GRANT SELECT, INSERT, UPDATE ON plan_quota_reservations TO omnireach_platform, omnireach_worker;
GRANT SELECT ON plan_quota_reservations TO omnireach_app;

CREATE OR REPLACE FUNCTION reserve_plan_quota(
  p_tenant uuid, p_site uuid, p_quota_key varchar, p_amount integer, p_expires timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  v_limit integer;
  v_reservation_id uuid;
BEGIN
  IF p_quota_key <> 'ai_review_cycles_per_month' THEN
    RAISE EXCEPTION 'unsupported plan quota key';
  END IF;
  IF p_amount <= 0 OR p_expires <= now() THEN
    RAISE EXCEPTION 'invalid plan quota reservation';
  END IF;
  IF p_tenant <> NULLIF(current_setting('app.tenant_id', true), '')::uuid
     OR p_site <> NULLIF(current_setting('app.site_id', true), '')::uuid THEN
    RAISE EXCEPTION 'scope mismatch';
  END IF;

  SELECT COALESCE(site_override.quota_limit, plan.ai_review_cycles_per_month)
    INTO v_limit
    FROM subscriptions subscription
    JOIN plans plan ON plan.id = subscription.plan_id AND plan.active
    LEFT JOIN site_plan_quota_overrides site_override
      ON site_override.tenant_id = subscription.tenant_id
     AND site_override.site_id = subscription.site_id
     AND site_override.quota_key = p_quota_key
   WHERE subscription.tenant_id = p_tenant
     AND subscription.site_id = p_site
     AND (subscription.status = 'active' OR
          (subscription.status IN ('past_due','cancelled') AND subscription.grace_ends_at >= now()));
  IF v_limit IS NULL THEN
    RAISE EXCEPTION 'active subscription plan quota not found';
  END IF;

  INSERT INTO plan_quota_usage (tenant_id, site_id, quota_key, period_start)
  VALUES (p_tenant, p_site, p_quota_key, v_period)
  ON CONFLICT (tenant_id, site_id, quota_key, period_start) DO NOTHING;
  PERFORM 1 FROM plan_quota_usage
   WHERE tenant_id = p_tenant AND site_id = p_site
     AND quota_key = p_quota_key AND period_start = v_period
   FOR UPDATE;

  UPDATE plan_quota_reservations
     SET state = 'expired', finalized_at = now()
   WHERE tenant_id = p_tenant AND site_id = p_site
     AND quota_key = p_quota_key AND period_start = v_period
     AND state = 'active' AND expires_at <= now();
  UPDATE plan_quota_usage usage
     SET reserved = COALESCE((SELECT sum(reservation.amount)
                                FROM plan_quota_reservations reservation
                               WHERE reservation.tenant_id = p_tenant
                                 AND reservation.site_id = p_site
                                 AND reservation.quota_key = p_quota_key
                                 AND reservation.period_start = v_period
                                 AND reservation.state = 'active'), 0),
         updated_at = now()
   WHERE usage.tenant_id = p_tenant AND usage.site_id = p_site
     AND usage.quota_key = p_quota_key AND usage.period_start = v_period;

  IF (SELECT used + reserved + p_amount > v_limit
        FROM plan_quota_usage
       WHERE tenant_id = p_tenant AND site_id = p_site
         AND quota_key = p_quota_key AND period_start = v_period) THEN
    RAISE EXCEPTION 'plan quota hard cap exceeded';
  END IF;

  INSERT INTO plan_quota_reservations
    (tenant_id, site_id, quota_key, period_start, amount, expires_at)
  VALUES (p_tenant, p_site, p_quota_key, v_period, p_amount, p_expires)
  RETURNING id INTO v_reservation_id;
  UPDATE plan_quota_usage
     SET reserved = reserved + p_amount, updated_at = now()
   WHERE tenant_id = p_tenant AND site_id = p_site
     AND quota_key = p_quota_key AND period_start = v_period;
  RETURN v_reservation_id;
END $$;

CREATE OR REPLACE FUNCTION finalize_plan_quota(
  p_tenant uuid, p_site uuid, p_reservation uuid, p_consumed boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reservation plan_quota_reservations%ROWTYPE;
BEGIN
  IF p_tenant <> NULLIF(current_setting('app.tenant_id', true), '')::uuid
     OR p_site <> NULLIF(current_setting('app.site_id', true), '')::uuid THEN
    RAISE EXCEPTION 'scope mismatch';
  END IF;
  SELECT * INTO v_reservation FROM plan_quota_reservations
   WHERE id = p_reservation AND tenant_id = p_tenant AND site_id = p_site
   FOR UPDATE;
  IF NOT FOUND OR v_reservation.state <> 'active' THEN
    RAISE EXCEPTION 'active plan quota reservation not found';
  END IF;
  PERFORM 1 FROM plan_quota_usage
   WHERE tenant_id = v_reservation.tenant_id AND site_id = v_reservation.site_id
     AND quota_key = v_reservation.quota_key AND period_start = v_reservation.period_start
   FOR UPDATE;
  UPDATE plan_quota_reservations
     SET state = CASE WHEN p_consumed THEN 'consumed' ELSE 'released' END,
         finalized_at = now()
   WHERE id = p_reservation;
  UPDATE plan_quota_usage
     SET reserved = reserved - v_reservation.amount,
         used = used + CASE WHEN p_consumed THEN v_reservation.amount ELSE 0 END,
         updated_at = now()
   WHERE tenant_id = v_reservation.tenant_id AND site_id = v_reservation.site_id
     AND quota_key = v_reservation.quota_key AND period_start = v_reservation.period_start;
END $$;

REVOKE ALL ON FUNCTION reserve_plan_quota(uuid, uuid, varchar, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION finalize_plan_quota(uuid, uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_plan_quota(uuid, uuid, varchar, integer, timestamptz)
  TO omnireach_worker;
GRANT EXECUTE ON FUNCTION finalize_plan_quota(uuid, uuid, uuid, boolean)
  TO omnireach_worker;
