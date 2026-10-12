CREATE TABLE password_recovery_delivery_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_token_id uuid NOT NULL UNIQUE
    REFERENCES password_recovery_tokens(id) ON DELETE CASCADE,
  encrypted_token bytea,
  encryption_key_version integer NOT NULL DEFAULT 1 CHECK (encryption_key_version > 0),
  status varchar(24) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'delivered', 'failed', 'expired')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz(3) NOT NULL DEFAULT now(),
  locked_until timestamptz(3),
  last_error_code varchar(64),
  delivered_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT password_recovery_delivery_outbox_payload_lifecycle CHECK (
    (status IN ('queued', 'processing') AND encrypted_token IS NOT NULL)
    OR (status IN ('delivered', 'failed', 'expired') AND encrypted_token IS NULL)
  ),
  CONSTRAINT password_recovery_delivery_outbox_lease CHECK (
    (status = 'processing' AND locked_until IS NOT NULL)
    OR (status <> 'processing' AND locked_until IS NULL)
  )
);

CREATE INDEX password_recovery_delivery_outbox_ready_idx
  ON password_recovery_delivery_outbox (available_at, created_at)
  WHERE status = 'queued';
CREATE INDEX password_recovery_delivery_outbox_lease_idx
  ON password_recovery_delivery_outbox (locked_until)
  WHERE status = 'processing';

REVOKE ALL ON password_recovery_delivery_outbox FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON password_recovery_delivery_outbox TO omnireach_auth;

ALTER TABLE password_recovery_delivery_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_recovery_delivery_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_only_password_recovery_delivery_outbox
  ON password_recovery_delivery_outbox
  USING (pg_has_role(current_user, 'omnireach_auth', 'member'))
  WITH CHECK (pg_has_role(current_user, 'omnireach_auth', 'member'));
