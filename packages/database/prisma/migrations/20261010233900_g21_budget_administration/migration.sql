DROP POLICY tenant_scope_site_ai_budgets ON site_ai_budgets;
CREATE POLICY tenant_scope_site_ai_budgets ON site_ai_budgets
  USING ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member'))
  WITH CHECK ((tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND site_id = NULLIF(current_setting('app.site_id', true), '')::uuid) OR pg_has_role(current_user, 'omnireach_platform', 'member'));
