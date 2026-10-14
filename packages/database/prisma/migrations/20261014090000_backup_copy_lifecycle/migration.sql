ALTER TABLE backup_records
  ADD COLUMN local_pruned_at timestamptz(3),
  ADD COLUMN off_server_pruned_at timestamptz(3);

COMMENT ON COLUMN backup_records.local_pruned_at IS
  'When the host-local encrypted copy was deleted by approved retention.';
COMMENT ON COLUMN backup_records.off_server_pruned_at IS
  'When the off-server encrypted copy was deleted by approved retention.';

CREATE OR REPLACE FUNCTION record_backup_alert(p_error_code varchar(100))
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_fingerprint char(64) := encode(digest('platform:backup:failure', 'sha256'), 'hex');
  v_message varchar(500);
BEGIN
  IF p_error_code IS NULL THEN
    UPDATE alerts
       SET state = 'resolved', resolved_at = now(), last_seen_at = now()
     WHERE tenant_id IS NULL AND site_id IS NULL
       AND fingerprint = v_fingerprint AND state <> 'resolved';
    RETURN;
  END IF;

  v_message := CASE p_error_code
    WHEN 'backup_resource_limit' THEN 'Backup stopped at an approved resource safety limit'
    WHEN 'database_dump_failed' THEN 'PostgreSQL logical backup failed'
    WHEN 'offsite_transfer_failed' THEN 'Encrypted off-site backup transfer or verification failed'
    WHEN 'integrity_verification_failed' THEN 'Encrypted backup integrity verification failed'
    WHEN 'backup_failed' THEN 'Platform backup failed'
    ELSE NULL
  END;
  IF v_message IS NULL THEN RAISE EXCEPTION 'invalid backup alert code'; END IF;

  INSERT INTO alerts
    (tenant_id, site_id, fingerprint, severity, state, source, safe_message,
     remediation_url, first_seen_at, last_seen_at)
  VALUES
    (NULL, NULL, v_fingerprint, 'error', 'open', 'backup.production', v_message,
     '/orap/operations', now(), now())
  ON CONFLICT (tenant_id, site_id, fingerprint) DO UPDATE
    SET occurrences = alerts.occurrences + 1,
        severity = EXCLUDED.severity,
        state = 'open',
        safe_message = EXCLUDED.safe_message,
        last_seen_at = EXCLUDED.last_seen_at,
        acknowledged_at = NULL,
        resolved_at = NULL;
END $$;

REVOKE ALL ON FUNCTION record_backup_alert(varchar(100)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_backup_alert(varchar(100)) TO omnireach_worker;
