GRANT SELECT ON plans, subscriptions TO omnireach_auth;

DROP POLICY tenant_scope_subscriptions ON subscriptions;
CREATE POLICY tenant_scope_subscriptions ON subscriptions
  USING ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_auth', 'member') OR pg_has_role(current_user, 'omnireach_platform', 'member'))
  WITH CHECK ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member'));
