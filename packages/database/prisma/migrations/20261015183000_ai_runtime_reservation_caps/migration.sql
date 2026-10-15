-- Optional request-scoped ceilings let a one-off evaluation impose a stricter cap
-- than the durable site/platform policies. The original four-argument function remains
-- the single locking implementation. An exception here rolls back its reservation.
CREATE FUNCTION reserve_ai_budget(
  p_tenant uuid,
  p_site uuid,
  p_amount bigint,
  p_expires timestamptz,
  p_site_request_cap bigint,
  p_platform_request_cap bigint
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_reservation_id uuid;
BEGIN
  IF p_site_request_cap IS NOT NULL AND p_site_request_cap < 0 THEN
    RAISE EXCEPTION 'invalid site request cap';
  END IF;
  IF p_platform_request_cap IS NOT NULL AND p_platform_request_cap < 0 THEN
    RAISE EXCEPTION 'invalid platform request cap';
  END IF;

  v_reservation_id := reserve_ai_budget(p_tenant, p_site, p_amount, p_expires);

  IF p_site_request_cap IS NOT NULL AND EXISTS (
    SELECT 1 FROM ai_budget_periods
     WHERE tenant_id = p_tenant AND site_id = p_site AND period_start = v_period
       AND used_usd_micros + reserved_usd_micros > p_site_request_cap
  ) THEN
    RAISE EXCEPTION 'AI request-scoped site cap exceeded';
  END IF;

  IF p_platform_request_cap IS NOT NULL AND EXISTS (
    SELECT 1 FROM platform_ai_budget_periods
     WHERE period_start = v_period
       AND used_usd_micros + reserved_usd_micros > p_platform_request_cap
  ) THEN
    RAISE EXCEPTION 'AI request-scoped platform cap exceeded';
  END IF;

  RETURN v_reservation_id;
END $$;

REVOKE ALL ON FUNCTION reserve_ai_budget(
  uuid, uuid, bigint, timestamptz, bigint, bigint
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_ai_budget(
  uuid, uuid, bigint, timestamptz, bigint, bigint
) TO omnireach_app, omnireach_worker;
