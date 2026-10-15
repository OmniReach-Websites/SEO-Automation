-- Preserve historical subscriptions while making the owner-approved commercial
-- structure the active catalog. Existing subscriptions remain pinned to their
-- immutable plan version until explicitly reassigned.
WITH active_source AS (
  SELECT DISTINCT ON (code) *
    FROM plans
   WHERE active AND code IN ('STARTER', 'GROWTH', 'PRO', 'ELITE')
   ORDER BY code, version DESC
), inserted AS (
  INSERT INTO plans
    (code, name, version, active, monthly_price_cents, currency, commercial_status,
     customer_seat_limit, standard_page_limit, business_location_limit,
     seo_audit_interval_hours, ai_review_cycles_per_month,
     pending_invitations_count_as_seats)
  SELECT source.code, source.name, source.version + 1, true,
         CASE source.code
           WHEN 'STARTER' THEN 50000
           WHEN 'GROWTH' THEN 100000
           WHEN 'PRO' THEN 150000
           WHEN 'ELITE' THEN 200000
         END,
         'USD', 'approved',
         CASE source.code WHEN 'STARTER' THEN 2 WHEN 'GROWTH' THEN 5 WHEN 'PRO' THEN 10 ELSE 20 END,
         CASE source.code WHEN 'STARTER' THEN 5 WHEN 'GROWTH' THEN 10 WHEN 'PRO' THEN 20 ELSE 30 END,
         1,
         CASE source.code WHEN 'STARTER' THEN 168 ELSE 24 END,
         CASE source.code WHEN 'STARTER' THEN 2 WHEN 'GROWTH' THEN 8 WHEN 'PRO' THEN 16 ELSE 30 END,
         true
    FROM active_source source
  ON CONFLICT (code, version) DO NOTHING
  RETURNING id, code, version
)
INSERT INTO plan_features (plan_id, feature_key, feature_version, enabled)
SELECT destination.id, feature.feature_key, feature.feature_version,
       CASE WHEN definition.readiness = 'deployable' THEN feature.enabled ELSE false END
  FROM inserted destination
  JOIN active_source source ON source.code = destination.code
  JOIN plan_features feature ON feature.plan_id = source.id
  JOIN feature_definitions definition
    ON definition.key = feature.feature_key
   AND definition.version = feature.feature_version
ON CONFLICT (plan_id, feature_key) DO NOTHING;

UPDATE plans older
   SET active = false
 WHERE older.code IN ('STARTER', 'GROWTH', 'PRO', 'ELITE')
   AND older.active
   AND EXISTS (
     SELECT 1 FROM plans newer
      WHERE newer.code = older.code
        AND newer.active
        AND newer.commercial_status = 'approved'
        AND newer.version > older.version
   );
