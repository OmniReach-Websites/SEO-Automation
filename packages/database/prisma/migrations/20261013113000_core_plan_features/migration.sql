INSERT INTO feature_definitions
  (key, version, description, overrideable, safe_default, readiness)
VALUES
  ('content.edit', 1, 'Structured customer editing', true, false, 'deployable'),
  ('content.publish', 1, 'Authorized customer publication', true, false, 'deployable'),
  ('content.ai.auto', 1, 'Automatic AI edits for eligible fields', true, false, 'tested'),
  ('public.serving', 1, 'Immutable public website serving', false, true, 'deployable')
ON CONFLICT (key, version) DO UPDATE SET
  description = EXCLUDED.description,
  overrideable = EXCLUDED.overrideable,
  safe_default = EXCLUDED.safe_default,
  readiness = EXCLUDED.readiness;

INSERT INTO plan_features (plan_id, feature_key, feature_version, enabled)
SELECT plan.id, feature.key, feature.version, feature.enabled
  FROM plans plan
  CROSS JOIN (
    VALUES
      ('content.edit'::varchar(120), 1, true),
      ('content.publish'::varchar(120), 1, true),
      ('content.ai.auto'::varchar(120), 1, false),
      ('public.serving'::varchar(120), 1, true)
  ) AS feature(key, version, enabled)
 WHERE plan.code IN ('STARTER', 'GROWTH', 'PRO', 'ELITE')
ON CONFLICT (plan_id, feature_key) DO UPDATE SET
  feature_version = EXCLUDED.feature_version,
  enabled = EXCLUDED.enabled;
