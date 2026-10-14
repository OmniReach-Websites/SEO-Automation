-- Google may re-finalize a historical observation. Its identity is the connection,
-- source, metric, dimensions, and time window; the measured value is mutable evidence
-- and must not participate in idempotency.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY connection_id, source, metric, dimensions, window_start, window_end
           ORDER BY ingested_at DESC, id DESC
         ) AS ordinal
    FROM metric_snapshots
)
DELETE FROM metric_snapshots snapshot
 USING ranked
 WHERE snapshot.id = ranked.id
   AND ranked.ordinal > 1;

UPDATE metric_snapshots
   SET source_hash = encode(
         digest(
           concat_ws(
             chr(31),
             connection_id::text,
             source,
             metric,
             dimensions::text,
             extract(epoch FROM window_start)::text,
             extract(epoch FROM window_end)::text
           ),
           'sha256'
         ),
         'hex'
       );

CREATE INDEX metric_snapshots_scope_source_window_idx
  ON metric_snapshots (tenant_id, site_id, source, window_start);

COMMENT ON COLUMN metric_snapshots.source_hash IS
  'Stable observation identity derived from connection, source, metric, canonical JSON dimensions, and UTC window. The value is deliberately excluded so re-finalized provider data replaces the prior observation.';

-- ORAP analytics reads these records through the dedicated platform role. Customer and
-- worker roles remain transaction-scoped to one tenant/site; only the platform role gets
-- the explicit control-plane branch used after API capability authorization.
GRANT SELECT ON TABLE publication_requests TO omnireach_platform;

DROP POLICY tenant_scope_crawl_runs ON crawl_runs;
CREATE POLICY tenant_or_platform_crawl_runs ON crawl_runs
  USING (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  )
  WITH CHECK (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  );

DROP POLICY tenant_scope_crawl_pages ON crawl_pages;
CREATE POLICY tenant_or_platform_crawl_pages ON crawl_pages
  USING (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  )
  WITH CHECK (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  );

DROP POLICY tenant_scope_audit_runs ON audit_runs;
CREATE POLICY tenant_or_platform_audit_runs ON audit_runs
  USING (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  )
  WITH CHECK (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  );

DROP POLICY tenant_scope_findings ON findings;
CREATE POLICY tenant_or_platform_findings ON findings
  USING (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  )
  WITH CHECK (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  );

DROP POLICY tenant_scope_publication_requests ON publication_requests;
CREATE POLICY tenant_or_platform_publication_requests ON publication_requests
  USING (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  )
  WITH CHECK (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  );
