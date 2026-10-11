# ORAP

**Status:** G07 accessible administration shell and service/API contract implemented locally.

The current server-rendered shell lists authorized sites and links to staff workflows. Tenant/site and customer-access mutations are implemented through transaction/audit service boundaries and API routes; credentials and invitation tokens are never rendered.

Validate with `npm run verify:goal -- G07`. Roll back by disabling ORAP mutation routes while preserving identities and audit records. A production hostname, owner bootstrap, and live staff access remain gated by G31.
