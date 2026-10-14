ALTER TABLE integration_connections
  ADD COLUMN last_attempted_at timestamptz(3);

ALTER TABLE integration_connections
  DROP CONSTRAINT integration_connections_status_check,
  ADD CONSTRAINT integration_connections_status_check
    CHECK (status IN (
      'connected',
      'disconnected',
      'expired',
      'insufficient_scope',
      'revoked',
      'error',
      'partial'
    ));

UPDATE integration_connections
   SET last_attempted_at = COALESCE(last_synced_at, updated_at)
 WHERE last_synced_at IS NOT NULL OR refresh_failure_code IS NOT NULL;

COMMENT ON COLUMN integration_connections.last_attempted_at IS
  'Most recent scheduled or manual provider collection attempt. A completed or partial stored result is recorded separately in last_synced_at and sync_cursor.';
