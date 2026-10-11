# Tenant Package

**Status:** Local G06–G08 isolation, administration, and policy services implemented; database-runtime proof remains pending.

Provides verified-host customer context, tenant/platform transaction-local database context, staff administration services, membership lifecycle controls, deterministic entitlement precedence, subscription effects, and audited emergency/override mutations.

Validate with `npm run verify:goal -- G06`, `G07`, and `G08`. G06 is not complete until the disposable PostgreSQL RLS/adversarial suite passes. Rollback must preserve audit events and must never remove production RLS as a shortcut.
