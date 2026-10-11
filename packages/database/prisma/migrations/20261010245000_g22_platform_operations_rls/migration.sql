DROP POLICY tenant_scope_jobs ON jobs;
CREATE POLICY tenant_scope_jobs ON jobs
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

DROP POLICY tenant_scope_job_runs ON job_runs;
CREATE POLICY tenant_scope_job_runs ON job_runs
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

DROP POLICY tenant_scope_schedules ON schedules;
CREATE POLICY tenant_scope_schedules ON schedules
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

DROP POLICY tenant_scope_alerts ON alerts;
CREATE POLICY tenant_scope_alerts ON alerts
  USING (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND (site_id IS NULL OR site_id = NULLIF(current_setting('app.site_id', true), '')::uuid))
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  )
  WITH CHECK (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND (site_id IS NULL OR site_id = NULLIF(current_setting('app.site_id', true), '')::uuid))
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  );

DROP POLICY tenant_scope_operational_logs ON operational_logs;
CREATE POLICY tenant_scope_operational_logs ON operational_logs
  USING (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND (site_id IS NULL OR site_id = NULLIF(current_setting('app.site_id', true), '')::uuid))
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  )
  WITH CHECK (
    (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND (site_id IS NULL OR site_id = NULLIF(current_setting('app.site_id', true), '')::uuid))
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  );
