-- G06 tenant-isolation hardening, forward-only slice 1.
--
-- Runtime roles are deliberately reduced to the verbs exercised by their
-- repositories. PostgreSQL ownership/migration credentials remain outside this
-- matrix and must never be used by an application process.

-- Preflight every newly constrained parent reference before DDL is installed.
-- Scalar foreign keys prove that the parent exists, but did not prove that it
-- belongs to the same tenant and site as the child row.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sessions child
    WHERE (child.tenant_id IS NULL) <> (child.site_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'sessions contains a partial tenant/site scope';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM sessions child
      JOIN sessions parent ON parent.id = child.rotated_from_id
     WHERE child.rotated_from_id IS NOT NULL
       AND (parent.tenant_id IS DISTINCT FROM child.tenant_id
         OR parent.site_id IS DISTINCT FROM child.site_id)
  ) THEN
    RAISE EXCEPTION 'sessions.rotated_from_id crosses a scope boundary';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM sessions child
      LEFT JOIN memberships parent
        ON parent.tenant_id = child.tenant_id
       AND parent.site_id = child.site_id
       AND parent.user_id = child.user_id
     WHERE child.tenant_id IS NOT NULL
       AND parent.id IS NULL
  ) THEN
    RAISE EXCEPTION 'customer session is not bound to a same-scope membership';
  END IF;

  IF EXISTS (
    SELECT 1 FROM domain_operations child
    JOIN domains parent ON parent.id = child.domain_id
    WHERE (parent.tenant_id, parent.site_id) <> (child.tenant_id, child.site_id)
  ) THEN RAISE EXCEPTION 'domain_operations.domain_id crosses a scope boundary'; END IF;

  IF EXISTS (
    SELECT 1 FROM job_runs child
    JOIN jobs parent ON parent.id = child.job_id
    WHERE (parent.tenant_id, parent.site_id) <> (child.tenant_id, child.site_id)
  ) THEN RAISE EXCEPTION 'job_runs.job_id crosses a scope boundary'; END IF;

  IF EXISTS (
    SELECT 1 FROM ai_reservations child
    JOIN ai_budget_periods parent ON parent.id = child.period_id
    WHERE (parent.tenant_id, parent.site_id) <> (child.tenant_id, child.site_id)
  ) THEN RAISE EXCEPTION 'ai_reservations.period_id crosses a scope boundary'; END IF;

  IF EXISTS (
    SELECT 1 FROM ai_reservations child
    JOIN jobs parent ON parent.id = child.job_id
    WHERE child.job_id IS NOT NULL
      AND (parent.tenant_id, parent.site_id) <> (child.tenant_id, child.site_id)
  ) THEN RAISE EXCEPTION 'ai_reservations.job_id crosses a scope boundary'; END IF;

  IF EXISTS (
    SELECT 1 FROM ai_usage_entries child
    JOIN ai_budget_periods parent ON parent.id = child.period_id
    WHERE (parent.tenant_id, parent.site_id) <> (child.tenant_id, child.site_id)
  ) THEN RAISE EXCEPTION 'ai_usage_entries.period_id crosses a scope boundary'; END IF;

  IF EXISTS (
    SELECT 1 FROM ai_usage_entries child
    JOIN ai_reservations parent ON parent.id = child.reservation_id
    WHERE child.reservation_id IS NOT NULL
      AND (parent.tenant_id, parent.site_id) <> (child.tenant_id, child.site_id)
  ) THEN RAISE EXCEPTION 'ai_usage_entries.reservation_id crosses a scope boundary'; END IF;

  IF EXISTS (
    SELECT 1 FROM ai_usage_entries child
    JOIN ai_usage_entries parent ON parent.id = child.correction_of
    WHERE child.correction_of IS NOT NULL
      AND (parent.tenant_id, parent.site_id) <> (child.tenant_id, child.site_id)
  ) THEN RAISE EXCEPTION 'ai_usage_entries.correction_of crosses a scope boundary'; END IF;

  IF EXISTS (
    SELECT 1 FROM crawl_runs child
    JOIN jobs parent ON parent.id = child.job_id
    WHERE child.job_id IS NOT NULL
      AND (parent.tenant_id, parent.site_id) <> (child.tenant_id, child.site_id)
  ) THEN RAISE EXCEPTION 'crawl_runs.job_id crosses a scope boundary'; END IF;

  IF EXISTS (
    SELECT 1 FROM crawl_pages child
    JOIN crawl_runs parent ON parent.id = child.crawl_run_id
    WHERE (parent.tenant_id, parent.site_id) <> (child.tenant_id, child.site_id)
  ) THEN RAISE EXCEPTION 'crawl_pages.crawl_run_id crosses a scope boundary'; END IF;

  IF EXISTS (
    SELECT 1 FROM crawl_link_edges child
    JOIN crawl_runs parent ON parent.id = child.crawl_run_id
    WHERE (parent.tenant_id, parent.site_id) <> (child.tenant_id, child.site_id)
  ) THEN RAISE EXCEPTION 'crawl_link_edges.crawl_run_id crosses a scope boundary'; END IF;

  IF EXISTS (
    SELECT 1 FROM audit_runs child
    JOIN crawl_runs parent ON parent.id = child.crawl_run_id
    WHERE child.crawl_run_id IS NOT NULL
      AND (parent.tenant_id, parent.site_id) <> (child.tenant_id, child.site_id)
  ) THEN RAISE EXCEPTION 'audit_runs.crawl_run_id crosses a scope boundary'; END IF;

  IF EXISTS (
    SELECT 1 FROM findings child
    JOIN audit_runs parent ON parent.id = child.audit_run_id
    WHERE (parent.tenant_id, parent.site_id) <> (child.tenant_id, child.site_id)
  ) THEN RAISE EXCEPTION 'findings.audit_run_id crosses a scope boundary'; END IF;

  IF EXISTS (
    SELECT 1 FROM content_proposals child
    JOIN publication_requests parent ON parent.id = child.publication_request_id
    WHERE child.publication_request_id IS NOT NULL
      AND (parent.tenant_id, parent.site_id) <> (child.tenant_id, child.site_id)
  ) THEN RAISE EXCEPTION 'content_proposals.publication_request_id crosses a scope boundary'; END IF;

  IF EXISTS (
    SELECT 1 FROM metric_snapshots child
    JOIN integration_connections parent ON parent.id = child.connection_id
    WHERE (parent.tenant_id, parent.site_id) <> (child.tenant_id, child.site_id)
  ) THEN RAISE EXCEPTION 'metric_snapshots.connection_id crosses a scope boundary'; END IF;
END
$$;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_scope_pair_check
    CHECK ((tenant_id IS NULL) = (site_id IS NULL)),
  ADD CONSTRAINT sessions_scope_id_key
    UNIQUE NULLS NOT DISTINCT (tenant_id, site_id, id);
ALTER TABLE domains
  ADD CONSTRAINT domains_scope_id_key UNIQUE (tenant_id, site_id, id);
ALTER TABLE jobs
  ADD CONSTRAINT jobs_scope_id_key UNIQUE (tenant_id, site_id, id);
ALTER TABLE ai_budget_periods
  ADD CONSTRAINT ai_budget_periods_scope_id_key UNIQUE (tenant_id, site_id, id);
ALTER TABLE ai_reservations
  ADD CONSTRAINT ai_reservations_scope_id_key UNIQUE (tenant_id, site_id, id);
ALTER TABLE ai_usage_entries
  ADD CONSTRAINT ai_usage_entries_scope_id_key UNIQUE (tenant_id, site_id, id);
ALTER TABLE crawl_runs
  ADD CONSTRAINT crawl_runs_scope_id_key UNIQUE (tenant_id, site_id, id);
ALTER TABLE audit_runs
  ADD CONSTRAINT audit_runs_scope_id_key UNIQUE (tenant_id, site_id, id);
ALTER TABLE publication_requests
  ADD CONSTRAINT publication_requests_scope_id_key UNIQUE (tenant_id, site_id, id);
ALTER TABLE integration_connections
  ADD CONSTRAINT integration_connections_scope_id_key UNIQUE (tenant_id, site_id, id);

ALTER TABLE sessions
  ADD CONSTRAINT sessions_rotation_scope_fk
    FOREIGN KEY (tenant_id, site_id, rotated_from_id)
    REFERENCES sessions(tenant_id, site_id, id) NOT VALID,
  ADD CONSTRAINT sessions_membership_scope_fk
    FOREIGN KEY (tenant_id, site_id, user_id)
    REFERENCES memberships(tenant_id, site_id, user_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE domain_operations
  ADD CONSTRAINT domain_operations_domain_scope_fk
    FOREIGN KEY (tenant_id, site_id, domain_id)
    REFERENCES domains(tenant_id, site_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE job_runs
  ADD CONSTRAINT job_runs_job_scope_fk
    FOREIGN KEY (tenant_id, site_id, job_id)
    REFERENCES jobs(tenant_id, site_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE ai_reservations
  ADD CONSTRAINT ai_reservations_period_scope_fk
    FOREIGN KEY (tenant_id, site_id, period_id)
    REFERENCES ai_budget_periods(tenant_id, site_id, id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT ai_reservations_job_scope_fk
    FOREIGN KEY (tenant_id, site_id, job_id)
    REFERENCES jobs(tenant_id, site_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE ai_usage_entries
  ADD CONSTRAINT ai_usage_period_scope_fk
    FOREIGN KEY (tenant_id, site_id, period_id)
    REFERENCES ai_budget_periods(tenant_id, site_id, id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT ai_usage_reservation_scope_fk
    FOREIGN KEY (tenant_id, site_id, reservation_id)
    REFERENCES ai_reservations(tenant_id, site_id, id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT ai_usage_correction_scope_fk
    FOREIGN KEY (tenant_id, site_id, correction_of)
    REFERENCES ai_usage_entries(tenant_id, site_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE crawl_runs
  ADD CONSTRAINT crawl_runs_job_scope_fk
    FOREIGN KEY (tenant_id, site_id, job_id)
    REFERENCES jobs(tenant_id, site_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE crawl_pages
  ADD CONSTRAINT crawl_pages_run_scope_fk
    FOREIGN KEY (tenant_id, site_id, crawl_run_id)
    REFERENCES crawl_runs(tenant_id, site_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE crawl_link_edges
  ADD CONSTRAINT crawl_edges_run_scope_fk
    FOREIGN KEY (tenant_id, site_id, crawl_run_id)
    REFERENCES crawl_runs(tenant_id, site_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE audit_runs
  ADD CONSTRAINT audit_runs_crawl_scope_fk
    FOREIGN KEY (tenant_id, site_id, crawl_run_id)
    REFERENCES crawl_runs(tenant_id, site_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE findings
  ADD CONSTRAINT findings_audit_scope_fk
    FOREIGN KEY (tenant_id, site_id, audit_run_id)
    REFERENCES audit_runs(tenant_id, site_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE content_proposals
  ADD CONSTRAINT content_proposals_publication_scope_fk
    FOREIGN KEY (tenant_id, site_id, publication_request_id)
    REFERENCES publication_requests(tenant_id, site_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE metric_snapshots
  ADD CONSTRAINT metric_snapshots_connection_scope_fk
    FOREIGN KEY (tenant_id, site_id, connection_id)
    REFERENCES integration_connections(tenant_id, site_id, id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE sessions VALIDATE CONSTRAINT sessions_rotation_scope_fk;
ALTER TABLE sessions VALIDATE CONSTRAINT sessions_membership_scope_fk;
ALTER TABLE domain_operations VALIDATE CONSTRAINT domain_operations_domain_scope_fk;
ALTER TABLE job_runs VALIDATE CONSTRAINT job_runs_job_scope_fk;
ALTER TABLE ai_reservations VALIDATE CONSTRAINT ai_reservations_period_scope_fk;
ALTER TABLE ai_reservations VALIDATE CONSTRAINT ai_reservations_job_scope_fk;
ALTER TABLE ai_usage_entries VALIDATE CONSTRAINT ai_usage_period_scope_fk;
ALTER TABLE ai_usage_entries VALIDATE CONSTRAINT ai_usage_reservation_scope_fk;
ALTER TABLE ai_usage_entries VALIDATE CONSTRAINT ai_usage_correction_scope_fk;
ALTER TABLE crawl_runs VALIDATE CONSTRAINT crawl_runs_job_scope_fk;
ALTER TABLE crawl_pages VALIDATE CONSTRAINT crawl_pages_run_scope_fk;
ALTER TABLE crawl_link_edges VALIDATE CONSTRAINT crawl_edges_run_scope_fk;
ALTER TABLE audit_runs VALIDATE CONSTRAINT audit_runs_crawl_scope_fk;
ALTER TABLE findings VALIDATE CONSTRAINT findings_audit_scope_fk;
ALTER TABLE content_proposals VALIDATE CONSTRAINT content_proposals_publication_scope_fk;
ALTER TABLE metric_snapshots VALIDATE CONSTRAINT metric_snapshots_connection_scope_fk;

-- MATCH SIMPLE intentionally permits platform sessions whose tenant/site are both
-- NULL. This trigger supplies the exact NULL-safe equality check that a composite
-- foreign key cannot express for that platform-session case.
CREATE OR REPLACE FUNCTION enforce_session_rotation_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.rotated_from_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sessions parent
     WHERE parent.id = NEW.rotated_from_id
       AND parent.tenant_id IS NOT DISTINCT FROM NEW.tenant_id
       AND parent.site_id IS NOT DISTINCT FROM NEW.site_id
  ) THEN
    RAISE EXCEPTION 'rotated session must have the same tenant/site scope'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION enforce_session_rotation_scope() FROM PUBLIC;
CREATE TRIGGER sessions_rotation_scope_guard
BEFORE INSERT OR UPDATE OF tenant_id, site_id, rotated_from_id ON sessions
FOR EACH ROW EXECUTE FUNCTION enforce_session_rotation_scope();

-- Replace worker-wide bypasses with exact transaction-local tenant/site policies.
DROP POLICY tenant_scope_plan_quota_usage ON plan_quota_usage;
CREATE POLICY tenant_scope_plan_quota_usage ON plan_quota_usage
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

DROP POLICY tenant_scope_plan_quota_reservations ON plan_quota_reservations;
CREATE POLICY tenant_scope_plan_quota_reservations ON plan_quota_reservations
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

DROP POLICY tenant_scope_site_contact_forms ON site_contact_forms;
CREATE POLICY tenant_scope_site_contact_forms ON site_contact_forms
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

-- Tenant-global and platform-global alerts/logs are control-plane records. A site
-- role may see only an exact site row; no tenant-wide customer permission exists.
DROP POLICY tenant_scope_alerts ON alerts;
CREATE POLICY tenant_scope_alerts ON alerts
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
COMMENT ON TABLE alerts IS
  'Site alerts are exact-site scoped. tenant-global and platform-global rows are platform-only until a tenant-wide permission is defined.';

DROP POLICY tenant_scope_operational_logs ON operational_logs;
CREATE POLICY tenant_scope_operational_logs ON operational_logs
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
COMMENT ON TABLE operational_logs IS
  'Site logs are exact-site scoped. tenant-global and platform-global rows are platform-only until a tenant-wide permission is defined.';

-- Delivery rows inherit scope indirectly through their alert. They are never a
-- customer-site API surface, but worker access must still be exact-site scoped.
ALTER TABLE alert_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY indirect_alert_delivery_scope ON alert_deliveries
  USING (
    EXISTS (
      SELECT 1 FROM alerts parent
       WHERE parent.id = alert_deliveries.alert_id
         AND (
           (parent.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND parent.site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
           OR pg_has_role(current_user, 'omnireach_platform', 'member')
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM alerts parent
       WHERE parent.id = alert_deliveries.alert_id
         AND (
           (parent.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND parent.site_id = NULLIF(current_setting('app.site_id', true), '')::uuid)
           OR pg_has_role(current_user, 'omnireach_platform', 'member')
         )
    )
  );
COMMENT ON TABLE alert_deliveries IS
  'Indirectly site-scoped through alerts; deliveries for tenant-global or platform-global alerts are platform-only.';

-- Authentication is the only global runtime role that needs tenant reads during
-- exact-host account resolution.
DROP POLICY tenant_scope_tenants ON tenants;
CREATE POLICY tenant_scope_tenants ON tenants
  USING (
    id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR pg_has_role(current_user, 'omnireach_auth', 'member')
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  )
  WITH CHECK (
    id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR pg_has_role(current_user, 'omnireach_platform', 'member')
  );

-- Explicit runtime role x table x verb matrix for legacy/control-plane relations.
REVOKE ALL ON TABLE users, tenants, sites, domains, memberships,
  platform_memberships, audit_events
  FROM omnireach_app, omnireach_worker, omnireach_auth, omnireach_platform;

GRANT SELECT ON tenants, sites, domains, memberships, platform_memberships
  TO omnireach_app;
GRANT SELECT, INSERT ON audit_events TO omnireach_app;

GRANT SELECT ON tenants, sites, domains, memberships, platform_memberships
  TO omnireach_worker;
GRANT INSERT ON audit_events TO omnireach_worker;

GRANT SELECT, INSERT, UPDATE ON users TO omnireach_auth;
GRANT SELECT ON tenants, sites, domains TO omnireach_auth;
GRANT SELECT, INSERT, UPDATE ON memberships, platform_memberships TO omnireach_auth;
GRANT INSERT ON audit_events TO omnireach_auth;

GRANT SELECT ON users TO omnireach_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, sites, domains, memberships,
  platform_memberships TO omnireach_platform;
GRANT SELECT, INSERT ON audit_events TO omnireach_platform;

-- Quota ledgers are mutated only through the scoped SECURITY DEFINER functions.
REVOKE ALL ON TABLE plan_quota_usage, plan_quota_reservations
  FROM omnireach_app, omnireach_worker, omnireach_auth, omnireach_platform;
GRANT SELECT ON plan_quota_usage, plan_quota_reservations
  TO omnireach_app, omnireach_worker, omnireach_platform;

-- Customer settings may be edited by the site application, public submission
-- processing is read-only, and ORAP owns provisioning/deletion.
REVOKE ALL ON TABLE site_contact_forms
  FROM omnireach_app, omnireach_worker, omnireach_auth, omnireach_platform;
GRANT SELECT, UPDATE ON site_contact_forms TO omnireach_app;
GRANT SELECT ON site_contact_forms TO omnireach_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON site_contact_forms TO omnireach_platform;

-- Subscription and entitlement controls are customer/worker read models. Only the
-- ORAP platform role mutates them; authentication retains its invitation-time plan
-- and subscription reads through the separately granted plans SELECT privilege.
REVOKE ALL ON TABLE subscriptions, site_feature_overrides, site_emergency_controls
  FROM omnireach_app, omnireach_worker, omnireach_auth, omnireach_platform;
GRANT SELECT ON subscriptions, site_feature_overrides, site_emergency_controls
  TO omnireach_app, omnireach_worker;
GRANT SELECT ON subscriptions TO omnireach_auth;
GRANT SELECT, INSERT, UPDATE ON subscriptions, site_feature_overrides,
  site_emergency_controls TO omnireach_platform;

-- Configurable reservation boundary for the canonical ORAP hostname. No hostname
-- is hard-coded or populated by this migration; privileged provisioning must store
-- the approved normalized value before any customer-domain onboarding.
CREATE TABLE platform_reserved_hostnames (
  purpose varchar(32) PRIMARY KEY CHECK (purpose = 'orap'),
  hostname varchar(253) NOT NULL UNIQUE,
  configured_at timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (hostname = lower(hostname) AND hostname !~ '[:/]')
);
REVOKE ALL ON TABLE platform_reserved_hostnames FROM PUBLIC,
  omnireach_app, omnireach_worker, omnireach_auth, omnireach_platform;
COMMENT ON TABLE platform_reserved_hostnames IS
  'Owner-provisioned hostname reservations. The canonical ORAP hostname must be configured here before customer-domain onboarding.';

CREATE OR REPLACE FUNCTION prevent_reserved_customer_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.platform_reserved_hostnames reserved
     WHERE reserved.hostname = NEW.hostname
  ) THEN
    RAISE EXCEPTION 'hostname is reserved for the platform control plane'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION prevent_reserved_customer_domain() FROM PUBLIC;
CREATE TRIGGER domains_reject_reserved_hostname
BEFORE INSERT OR UPDATE OF hostname ON domains
FOR EACH ROW EXECUTE FUNCTION prevent_reserved_customer_domain();

CREATE OR REPLACE FUNCTION prevent_conflicting_hostname_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.domains domain WHERE domain.hostname = NEW.hostname) THEN
    RAISE EXCEPTION 'reserved hostname is already assigned to a customer site'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION prevent_conflicting_hostname_reservation() FROM PUBLIC;
CREATE TRIGGER reserved_hostname_rejects_existing_domain
BEFORE INSERT OR UPDATE OF hostname ON platform_reserved_hostnames
FOR EACH ROW EXECUTE FUNCTION prevent_conflicting_hostname_reservation();

INSERT INTO schema_metadata (key, value)
VALUES (
  'g06_isolation_hardening',
  '{"goal":"G06","version":1,"runtimePrivilegeMatrix":"least-privilege","tenantGlobalOperations":"platform-only","orapHostnameReservation":"configurable"}'::jsonb
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = now();
