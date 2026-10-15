ALTER TABLE email_delivery_reservations
  ADD COLUMN units integer NOT NULL DEFAULT 1 CHECK (units BETWEEN 1 AND 50);

DROP FUNCTION reserve_email_delivery(
  varchar(30), timestamptz, integer, integer, integer, integer
);
DROP FUNCTION finalize_email_delivery(uuid, varchar(20), varchar(200), varchar(100));

CREATE FUNCTION reserve_email_delivery(
  p_channel varchar(30),
  p_expires timestamptz,
  p_units integer,
  p_provider_daily_used integer,
  p_provider_daily_limit integer,
  p_provider_monthly_used integer,
  p_provider_monthly_limit integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_daily_cap integer;
  v_daily_reserved integer;
  v_daily_sent integer;
  v_day timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_monthly_cap integer;
  v_monthly_reserved integer;
  v_monthly_sent integer;
  v_period timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_reservation_id uuid;
BEGIN
  IF p_channel NOT IN ('alert', 'authentication', 'contact', 'platform_inquiry')
     OR p_expires <= now()
     OR p_expires > now() + interval '1 hour'
     OR p_units < 1
     OR p_units > 50
     OR p_provider_daily_used < 0
     OR p_provider_daily_limit < 0
     OR p_provider_monthly_used < 0
     OR p_provider_monthly_limit < 0 THEN
    RAISE EXCEPTION 'invalid email delivery reservation';
  END IF;

  SELECT LEAST(daily_limit, p_provider_daily_limit),
         LEAST(monthly_limit, p_provider_monthly_limit)
    INTO v_daily_cap, v_monthly_cap
    FROM public.email_delivery_policy
   WHERE singleton = true
   FOR UPDATE;
  IF v_daily_cap IS NULL OR v_monthly_cap IS NULL THEN
    RAISE EXCEPTION 'email delivery policy is unavailable';
  END IF;

  INSERT INTO public.email_delivery_periods
    (period_start, cap_count, provider_used_count, provider_limit, provider_observed_at)
  VALUES
    (v_period, v_monthly_cap, p_provider_monthly_used, p_provider_monthly_limit, now())
  ON CONFLICT (period_start) DO UPDATE
    SET cap_count = LEAST(public.email_delivery_periods.cap_count, EXCLUDED.cap_count),
        provider_used_count = GREATEST(
          public.email_delivery_periods.provider_used_count,
          EXCLUDED.provider_used_count
        ),
        provider_limit = LEAST(public.email_delivery_periods.provider_limit, EXCLUDED.provider_limit),
        provider_observed_at = now(),
        updated_at = now();

  INSERT INTO public.email_delivery_days
    (day_start, cap_count, provider_used_count, provider_limit, provider_observed_at)
  VALUES
    (v_day, v_daily_cap, p_provider_daily_used, p_provider_daily_limit, now())
  ON CONFLICT (day_start) DO UPDATE
    SET cap_count = LEAST(public.email_delivery_days.cap_count, EXCLUDED.cap_count),
        provider_used_count = GREATEST(
          public.email_delivery_days.provider_used_count,
          EXCLUDED.provider_used_count
        ),
        provider_limit = LEAST(public.email_delivery_days.provider_limit, EXCLUDED.provider_limit),
        provider_observed_at = now(),
        updated_at = now();

  UPDATE public.email_delivery_reservations
     SET state = 'released', error_code = 'reservation_expired', finalized_at = now()
   WHERE period_start = v_period AND state = 'active' AND expires_at <= now();

  SELECT GREATEST(sent_count, provider_used_count), cap_count
    INTO v_monthly_sent, v_monthly_cap
    FROM public.email_delivery_periods
   WHERE period_start = v_period
   FOR UPDATE;
  SELECT GREATEST(sent_count, provider_used_count), cap_count
    INTO v_daily_sent, v_daily_cap
    FROM public.email_delivery_days
   WHERE day_start = v_day
   FOR UPDATE;

  SELECT COALESCE(sum(units), 0)::integer INTO v_monthly_reserved
    FROM public.email_delivery_reservations
   WHERE period_start = v_period AND state = 'active';
  SELECT COALESCE(sum(units), 0)::integer INTO v_daily_reserved
    FROM public.email_delivery_reservations
   WHERE day_start = v_day AND state = 'active';

  IF v_daily_sent + v_daily_reserved + p_units > v_daily_cap THEN
    RAISE EXCEPTION 'email daily quota exhausted';
  END IF;
  IF v_monthly_sent + v_monthly_reserved + p_units > v_monthly_cap THEN
    RAISE EXCEPTION 'email monthly quota exhausted';
  END IF;

  INSERT INTO public.email_delivery_reservations
    (period_start, day_start, channel, expires_at, units)
  VALUES (v_period, v_day, p_channel, p_expires, p_units)
  RETURNING id INTO v_reservation_id;
  RETURN v_reservation_id;
END
$$;

CREATE FUNCTION finalize_email_delivery(
  p_reservation_id uuid,
  p_state varchar(20),
  p_provider_reference varchar(200),
  p_error_code varchar(100)
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_day timestamptz;
  v_period timestamptz;
  v_state varchar(20);
  v_units integer;
BEGIN
  IF p_state NOT IN ('sent', 'failed', 'released')
     OR p_provider_reference IS NOT NULL AND length(p_provider_reference) > 200
     OR p_error_code IS NOT NULL AND p_error_code NOT IN (
       'network_failure', 'provider_4xx', 'provider_429', 'provider_5xx',
       'provider_invalid_response', 'reservation_released'
     ) THEN
    RAISE EXCEPTION 'invalid email delivery finalization';
  END IF;
  IF p_state = 'sent' AND p_error_code IS NOT NULL THEN
    RAISE EXCEPTION 'sent email delivery cannot have an error code';
  END IF;
  IF p_state <> 'sent' AND p_provider_reference IS NOT NULL THEN
    RAISE EXCEPTION 'unsent email delivery cannot have a provider reference';
  END IF;

  SELECT period_start, day_start, state, units INTO v_period, v_day, v_state, v_units
    FROM public.email_delivery_reservations
   WHERE id = p_reservation_id
   FOR UPDATE;
  IF v_period IS NULL OR v_day IS NULL THEN
    RAISE EXCEPTION 'email delivery reservation was not found';
  END IF;
  IF v_state <> 'active' THEN RETURN false; END IF;

  UPDATE public.email_delivery_reservations
     SET state = p_state,
         provider_reference = p_provider_reference,
         error_code = p_error_code,
         finalized_at = now()
   WHERE id = p_reservation_id;
  UPDATE public.email_delivery_periods
     SET sent_count = sent_count + CASE WHEN p_state = 'sent' THEN v_units ELSE 0 END,
         failed_attempt_count = failed_attempt_count + CASE WHEN p_state = 'failed' THEN 1 ELSE 0 END,
         updated_at = now()
   WHERE period_start = v_period;
  UPDATE public.email_delivery_days
     SET sent_count = sent_count + CASE WHEN p_state = 'sent' THEN v_units ELSE 0 END,
         failed_attempt_count = failed_attempt_count + CASE WHEN p_state = 'failed' THEN 1 ELSE 0 END,
         updated_at = now()
   WHERE day_start = v_day;
  RETURN true;
END
$$;

CREATE FUNCTION active_platform_owner_alert_recipients()
RETURNS TABLE(normalized_email varchar(320))
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT users.normalized_email
    FROM public.users
    JOIN public.orap_staff_memberships staff
      ON staff.user_id = users.id
    JOIN public.platform_memberships legacy
      ON legacy.user_id = users.id
   WHERE users.status = 'active'
     AND staff.identity_kind = 'platform_owner'
     AND staff.status = 'active'
     AND legacy.role = 'platform_owner'
     AND legacy.active
   ORDER BY users.normalized_email
$$;

REVOKE ALL ON FUNCTION reserve_email_delivery(
  varchar(30), timestamptz, integer, integer, integer, integer, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION finalize_email_delivery(uuid, varchar(20), varchar(200), varchar(100))
  FROM PUBLIC;
REVOKE ALL ON FUNCTION active_platform_owner_alert_recipients() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_email_delivery(
  varchar(30), timestamptz, integer, integer, integer, integer, integer
) TO omnireach_app, omnireach_worker;
GRANT EXECUTE ON FUNCTION finalize_email_delivery(uuid, varchar(20), varchar(200), varchar(100))
  TO omnireach_app, omnireach_worker;
GRANT EXECUTE ON FUNCTION active_platform_owner_alert_recipients() TO omnireach_worker;
