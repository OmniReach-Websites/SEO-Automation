# Database Package

**Status:** G04–G16 local SQL migrations authored; live disposable-database verification is pending Docker repair.

Contains the PostgreSQL foundation, auth, tenant/platform RLS roles, invitations, entitlements, content/revisions/proposals, assets, artifacts/contact submissions, and publication history migrations. Site-scoped relationships use composite tenant/site foreign keys where applicable; immutable history tables have mutation guards.

Use only `npm run db:migrate`, `npm run db:seed`, and `npm run verify:local-stack` against the isolated development database. Never point these commands at production during G01–G16. Destructive schema rollback requires a reviewed data-preservation plan.
