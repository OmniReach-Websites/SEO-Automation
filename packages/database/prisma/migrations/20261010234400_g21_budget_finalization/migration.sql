CREATE OR REPLACE FUNCTION finalize_ai_budget(
  p_tenant uuid,
  p_site uuid,
  p_reservation uuid,
  p_actual bigint,
  p_model_price_version integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period_id uuid;
  v_period_start timestamptz;
  v_state varchar(20);
  v_usage_id uuid;
BEGIN
  IF p_tenant <> NULLIF(current_setting('app.tenant_id', true), '')::uuid
     OR p_site <> NULLIF(current_setting('app.site_id', true), '')::uuid THEN
    RAISE EXCEPTION 'scope mismatch';
  END IF;
  IF (p_actual IS NULL) <> (p_model_price_version IS NULL) THEN
    RAISE EXCEPTION 'invalid finalization';
  END IF;
  IF p_actual IS NOT NULL AND (p_actual < 0 OR p_model_price_version < 1) THEN
    RAISE EXCEPTION 'invalid usage';
  END IF;

  SELECT r.period_id, bp.period_start
    INTO v_period_id, v_period_start
    FROM ai_reservations r
    JOIN ai_budget_periods bp ON bp.id = r.period_id
   WHERE r.tenant_id = p_tenant AND r.site_id = p_site AND r.id = p_reservation;
  IF v_period_id IS NULL THEN RAISE EXCEPTION 'reservation not found'; END IF;

  PERFORM 1 FROM platform_ai_budget_periods
   WHERE period_start = v_period_start FOR UPDATE;
  SELECT r.state INTO v_state
    FROM ai_reservations r
    JOIN ai_budget_periods bp ON bp.id = r.period_id
   WHERE r.tenant_id = p_tenant AND r.site_id = p_site AND r.id = p_reservation
   FOR UPDATE OF r, bp;
  IF v_state <> 'active' THEN RAISE EXCEPTION 'reservation is not active'; END IF;

  IF p_actual IS NULL THEN
    UPDATE ai_reservations SET state = 'released', reconciled_at = now()
     WHERE id = p_reservation;
  ELSE
    INSERT INTO ai_usage_entries
      (tenant_id, site_id, period_id, reservation_id, kind,
       amount_usd_micros, model_price_version)
    VALUES
      (p_tenant, p_site, v_period_id, p_reservation, 'charge',
       p_actual, p_model_price_version)
    RETURNING id INTO v_usage_id;
    UPDATE ai_reservations SET state = 'reconciled', reconciled_at = now()
     WHERE id = p_reservation;
  END IF;

  UPDATE ai_budget_periods bp
     SET reserved_usd_micros = COALESCE((SELECT sum(r.amount_usd_micros)
                                          FROM ai_reservations r
                                         WHERE r.period_id = bp.id AND r.state = 'active'), 0),
         used_usd_micros = COALESCE((SELECT sum(u.amount_usd_micros)
                                      FROM ai_usage_entries u
                                     WHERE u.period_id = bp.id), 0)
   WHERE bp.id = v_period_id;
  UPDATE platform_ai_budget_periods pbp
     SET reserved_usd_micros = COALESCE((SELECT sum(r.amount_usd_micros)
                                          FROM ai_reservations r
                                          JOIN ai_budget_periods bp ON bp.id = r.period_id
                                         WHERE bp.period_start = pbp.period_start
                                           AND r.state = 'active'), 0),
         used_usd_micros = COALESCE((SELECT sum(u.amount_usd_micros)
                                      FROM ai_usage_entries u
                                      JOIN ai_budget_periods bp ON bp.id = u.period_id
                                     WHERE bp.period_start = pbp.period_start), 0),
         updated_at = now()
   WHERE pbp.period_start = v_period_start;
  RETURN v_usage_id;
END $$;

REVOKE ALL ON FUNCTION finalize_ai_budget(uuid, uuid, uuid, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_ai_budget(uuid, uuid, uuid, bigint, integer)
  TO omnireach_app, omnireach_worker;
