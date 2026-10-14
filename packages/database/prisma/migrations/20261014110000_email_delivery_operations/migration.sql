CREATE TABLE email_delivery_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  provider varchar(30) NOT NULL DEFAULT 'resend' CHECK (provider = 'resend'),
  monthly_limit integer NOT NULL DEFAULT 3000 CHECK (monthly_limit BETWEEN 0 AND 100000),
  policy_version integer NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE email_delivery_periods (
  period_start timestamptz(3) PRIMARY KEY,
  cap_count integer NOT NULL CHECK (cap_count BETWEEN 0 AND 100000),
  sent_count integer NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  failed_attempt_count integer NOT NULL DEFAULT 0 CHECK (failed_attempt_count >= 0),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (period_start = date_trunc('month', period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
);

CREATE TABLE email_delivery_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start timestamptz(3) NOT NULL REFERENCES email_delivery_periods(period_start) ON DELETE RESTRICT,
  channel varchar(30) NOT NULL
    CHECK (channel IN ('alert', 'authentication', 'contact', 'platform_inquiry')),
  state varchar(20) NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'sent', 'failed', 'released')),
  provider_reference varchar(200),
  error_code varchar(100),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at timestamptz(3) NOT NULL,
  finalized_at timestamptz(3),
  CHECK (expires_at > created_at),
  CHECK ((state = 'active' AND finalized_at IS NULL) OR
         (state <> 'active' AND finalized_at IS NOT NULL))
);

CREATE INDEX email_delivery_reservations_period_state_idx
  ON email_delivery_reservations (period_start, state, created_at);

INSERT INTO email_delivery_policy (singleton, provider, monthly_limit, policy_version)
VALUES (true, 'resend', 3000, 1)
ON CONFLICT (singleton) DO NOTHING;

REVOKE ALL ON email_delivery_policy, email_delivery_periods, email_delivery_reservations FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON email_delivery_policy, email_delivery_periods, email_delivery_reservations
  TO omnireach_platform;

CREATE OR REPLACE FUNCTION reserve_email_delivery(
  p_channel varchar(30),
  p_expires timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cap integer;
  v_period timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_reservation_id uuid;
  v_reserved integer;
  v_sent integer;
BEGIN
  IF p_channel NOT IN ('alert', 'authentication', 'contact', 'platform_inquiry')
     OR p_expires <= now()
     OR p_expires > now() + interval '1 hour' THEN
    RAISE EXCEPTION 'invalid email delivery reservation';
  END IF;

  SELECT monthly_limit INTO v_cap
    FROM public.email_delivery_policy
   WHERE singleton = true
   FOR UPDATE;
  IF v_cap IS NULL THEN RAISE EXCEPTION 'email delivery policy is unavailable'; END IF;

  INSERT INTO public.email_delivery_periods (period_start, cap_count)
  VALUES (v_period, v_cap)
  ON CONFLICT (period_start) DO UPDATE
    SET cap_count = LEAST(public.email_delivery_periods.cap_count, EXCLUDED.cap_count),
        updated_at = now();
  SELECT sent_count INTO v_sent
    FROM public.email_delivery_periods
   WHERE period_start = v_period
   FOR UPDATE;

  UPDATE public.email_delivery_reservations
     SET state = 'released', error_code = 'reservation_expired', finalized_at = now()
   WHERE period_start = v_period AND state = 'active' AND expires_at <= now();

  SELECT count(*)::integer INTO v_reserved
    FROM public.email_delivery_reservations
   WHERE period_start = v_period AND state = 'active';
  IF v_sent + v_reserved >= v_cap THEN
    RAISE EXCEPTION 'email monthly quota exhausted';
  END IF;

  INSERT INTO public.email_delivery_reservations (period_start, channel, expires_at)
  VALUES (v_period, p_channel, p_expires)
  RETURNING id INTO v_reservation_id;
  RETURN v_reservation_id;
END
$$;

CREATE OR REPLACE FUNCTION finalize_email_delivery(
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
  v_period timestamptz;
  v_state varchar(20);
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

  SELECT period_start, state INTO v_period, v_state
    FROM public.email_delivery_reservations
   WHERE id = p_reservation_id
   FOR UPDATE;
  IF v_period IS NULL THEN RAISE EXCEPTION 'email delivery reservation was not found'; END IF;
  IF v_state <> 'active' THEN RETURN false; END IF;

  UPDATE public.email_delivery_reservations
     SET state = p_state,
         provider_reference = p_provider_reference,
         error_code = p_error_code,
         finalized_at = now()
   WHERE id = p_reservation_id;
  UPDATE public.email_delivery_periods
     SET sent_count = sent_count + CASE WHEN p_state = 'sent' THEN 1 ELSE 0 END,
         failed_attempt_count = failed_attempt_count + CASE WHEN p_state = 'failed' THEN 1 ELSE 0 END,
         updated_at = now()
   WHERE period_start = v_period;
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION reserve_email_delivery(varchar(30), timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION finalize_email_delivery(uuid, varchar(20), varchar(200), varchar(100)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_email_delivery(varchar(30), timestamptz)
  TO omnireach_app, omnireach_worker;
GRANT EXECUTE ON FUNCTION finalize_email_delivery(uuid, varchar(20), varchar(200), varchar(100))
  TO omnireach_app, omnireach_worker;
