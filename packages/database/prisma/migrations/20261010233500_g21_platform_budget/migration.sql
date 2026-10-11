CREATE TABLE platform_ai_budget (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  cap_usd_micros bigint NOT NULL DEFAULT 50000000 CHECK (cap_usd_micros >= 0),
  policy_version integer NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  override_reason varchar(500),
  override_actor_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CHECK ((override_reason IS NULL) = (override_actor_id IS NULL))
);

CREATE TABLE platform_ai_budget_periods (
  period_start timestamptz(3) PRIMARY KEY,
  cap_usd_micros bigint NOT NULL CHECK (cap_usd_micros >= 0),
  reserved_usd_micros bigint NOT NULL DEFAULT 0 CHECK (reserved_usd_micros >= 0),
  used_usd_micros bigint NOT NULL DEFAULT 0 CHECK (used_usd_micros >= 0),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (period_start = date_trunc('month', period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
);

INSERT INTO platform_ai_budget (singleton, cap_usd_micros, policy_version)
VALUES (true, 50000000, 1)
ON CONFLICT (singleton) DO NOTHING;

REVOKE ALL ON platform_ai_budget, platform_ai_budget_periods FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_ai_budget, platform_ai_budget_periods TO omnireach_platform;

CREATE OR REPLACE FUNCTION reserve_ai_budget(
  p_tenant uuid, p_site uuid, p_amount bigint, p_expires timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_site_period_id uuid;
  v_reservation_id uuid;
  v_site_cap bigint;
  v_platform_cap bigint;
BEGIN
  IF p_amount <= 0 OR p_expires <= now() THEN
    RAISE EXCEPTION 'invalid reservation';
  END IF;
  IF p_tenant <> NULLIF(current_setting('app.tenant_id', true), '')::uuid
     OR p_site <> NULLIF(current_setting('app.site_id', true), '')::uuid THEN
    RAISE EXCEPTION 'scope mismatch';
  END IF;

  SELECT cap_usd_micros INTO v_platform_cap
    FROM platform_ai_budget WHERE singleton = true FOR UPDATE;
  v_platform_cap := COALESCE(v_platform_cap, 50000000);
  INSERT INTO platform_ai_budget_periods (period_start, cap_usd_micros)
  VALUES (v_period, v_platform_cap)
  ON CONFLICT (period_start) DO NOTHING;
  PERFORM 1 FROM platform_ai_budget_periods WHERE period_start = v_period FOR UPDATE;

  SELECT cap_usd_micros INTO v_site_cap
    FROM site_ai_budgets WHERE tenant_id = p_tenant AND site_id = p_site;
  v_site_cap := COALESCE(v_site_cap, 5000000);
  INSERT INTO ai_budget_periods (tenant_id, site_id, period_start, cap_usd_micros)
  VALUES (p_tenant, p_site, v_period, v_site_cap)
  ON CONFLICT (tenant_id, site_id, period_start) DO NOTHING;
  SELECT id INTO v_site_period_id FROM ai_budget_periods
   WHERE tenant_id = p_tenant AND site_id = p_site AND period_start = v_period
   FOR UPDATE;

  UPDATE ai_reservations r SET state = 'expired'
   WHERE r.state = 'active' AND r.expires_at <= now()
     AND EXISTS (SELECT 1 FROM ai_budget_periods bp
                  WHERE bp.id = r.period_id AND bp.period_start = v_period);

  UPDATE ai_budget_periods bp
     SET reserved_usd_micros = COALESCE((SELECT sum(r.amount_usd_micros)
                                          FROM ai_reservations r
                                         WHERE r.period_id = bp.id AND r.state = 'active'), 0)
   WHERE bp.id = v_site_period_id;

  UPDATE platform_ai_budget_periods pbp
     SET reserved_usd_micros = COALESCE((SELECT sum(r.amount_usd_micros)
                                          FROM ai_reservations r
                                          JOIN ai_budget_periods bp ON bp.id = r.period_id
                                         WHERE bp.period_start = v_period AND r.state = 'active'), 0),
         used_usd_micros = COALESCE((SELECT sum(u.amount_usd_micros)
                                      FROM ai_usage_entries u
                                      JOIN ai_budget_periods bp ON bp.id = u.period_id
                                     WHERE bp.period_start = v_period), 0),
         updated_at = now()
   WHERE pbp.period_start = v_period;

  IF (SELECT reserved_usd_micros + used_usd_micros + p_amount > cap_usd_micros
        FROM ai_budget_periods WHERE id = v_site_period_id) THEN
    RAISE EXCEPTION 'AI site budget hard cap exceeded';
  END IF;
  IF (SELECT reserved_usd_micros + used_usd_micros + p_amount > cap_usd_micros
        FROM platform_ai_budget_periods WHERE period_start = v_period) THEN
    RAISE EXCEPTION 'AI platform budget hard cap exceeded';
  END IF;

  INSERT INTO ai_reservations
    (tenant_id, site_id, period_id, amount_usd_micros, state, expires_at)
  VALUES (p_tenant, p_site, v_site_period_id, p_amount, 'active', p_expires)
  RETURNING id INTO v_reservation_id;
  UPDATE ai_budget_periods SET reserved_usd_micros = reserved_usd_micros + p_amount
   WHERE id = v_site_period_id;
  UPDATE platform_ai_budget_periods
     SET reserved_usd_micros = reserved_usd_micros + p_amount, updated_at = now()
   WHERE period_start = v_period;
  RETURN v_reservation_id;
END $$;

REVOKE ALL ON FUNCTION reserve_ai_budget(uuid, uuid, bigint, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_ai_budget(uuid, uuid, bigint, timestamptz)
  TO omnireach_app, omnireach_worker;
