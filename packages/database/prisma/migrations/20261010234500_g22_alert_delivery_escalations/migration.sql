ALTER TABLE alerts
  ADD COLUMN email_escalation integer NOT NULL DEFAULT 1
  CHECK (email_escalation > 0);

ALTER TABLE alert_deliveries
  ADD COLUMN escalation integer NOT NULL DEFAULT 1
  CHECK (escalation > 0);

ALTER TABLE alert_deliveries
  DROP CONSTRAINT alert_deliveries_alert_id_channel_attempt_key;

ALTER TABLE alert_deliveries
  ADD CONSTRAINT alert_deliveries_alert_channel_escalation_attempt_key
  UNIQUE (alert_id, channel, escalation, attempt);

CREATE INDEX alert_deliveries_alert_channel_state_idx
  ON alert_deliveries (alert_id, channel, escalation, state);
