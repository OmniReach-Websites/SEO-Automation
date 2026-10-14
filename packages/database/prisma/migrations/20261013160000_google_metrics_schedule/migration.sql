-- Admit Google metric collection only for sites with an active, consented connection.
-- The first run is due immediately; the scheduler advances it to the next 04:00 UTC
-- occurrence with deterministic per-site jitter after admitting the durable job.
INSERT INTO schedules
  (tenant_id, site_id, category, timezone, local_hour, local_minute,
   jitter_minutes, enabled, next_attempt_at)
SELECT DISTINCT connection.tenant_id, connection.site_id, 'metrics_sync',
       'Etc/UTC', 4, 0, 30, true, now()
  FROM integration_connections connection
  JOIN sites site
    ON site.tenant_id = connection.tenant_id
   AND site.id = connection.site_id
 WHERE connection.provider = 'google'
   AND connection.status = 'connected'
   AND connection.collection_stopped_at IS NULL
   AND site.status = 'active'
ON CONFLICT (tenant_id, site_id, category) DO NOTHING;
