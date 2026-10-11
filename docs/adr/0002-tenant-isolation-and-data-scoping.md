# ADR 0002: Tenant isolation and data scoping

- **Status:** Accepted
- **Date:** 2026-10-10
- **Decisions:** D-004, D-005, D-006, D-023

## Context

Users can belong to multiple tenants/sites, workers act asynchronously, and a tenant may own multiple separately subscribed websites. Authorization errors or pooled database context leakage would expose customer data.

## Decision

- Enforce site/tenant authorization in API/services, composite relational constraints, and PostgreSQL RLS.
- Establish tenant/site context transactionally using transaction-scoped settings or equivalently safe database roles; never retain context across pooled connections.
- Resolve customer site context from a verified normalized hostname and authenticated membership, not a query/body ID.
- Use fixed roles: Platform Owner, Platform Admin, Staff, Customer Owner, Customer Editor, Customer Viewer. Action grants are deny-by-default.
- Customer Owners may publish. Customer Editors require an explicit site-scoped publish grant. Customer Viewers are read-only.
- A tenant may own multiple sites; each website has exactly one subscription, independent effective entitlements/overrides, and a site AI budget.
- The selected commercial proposal uses four versioned plans: STARTER, GROWTH, PRO, and
  ELITE. Each subscription belongs to one website and includes one primary website and
  one business location by default. Proposed monthly price, seats, standard-page quota,
  SEO-audit cadence, and AI content-review cycles are plan data, not hardcoded branches.
- ORAP owns plan configuration and site-specific overrides. Nonoverrideable security,
  tenant isolation, protected-fact rules, and infrastructure safeguards are identical
  across plans. The 14-day nonpayment grace period remains.
- The proposed values are STARTER ($500, 2 seats, 5 pages, weekly audits, 2 AI cycles),
  GROWTH ($1,000, 5, 10, daily, 8), PRO ($1,500, 10, 20, daily, 16), and ELITE ($2,000,
  20, 30, daily, 30). Prices are not final until commercial approval before launch.
- Contact forms remain unavailable for sale until implementation, security testing, and
  deployment complete. Expansion features excluded by R-011 are not plan entitlements;
  sampled AI-answer measurements, if retained for internal evaluation under D-022, are
  not a customer package benefit.
- Retention defaults are 30 days operational logs, 90 days detailed jobs, 12 months audit events; content revisions follow site/legal policy and are never silently pruned.

## Alternatives considered

1. **Application checks only:** rejected because one missed filter becomes a breach.
2. **RLS only:** rejected because service authorization, host context, and meaningful denials are still required.
3. **Tenant-wide subscription only:** rejected by the approved one-subscription-per-website decision.
4. **Database/schema per tenant:** deferred; excessive operational overhead for initial scale and does not remove application authorization needs.
5. **A different security baseline by tier:** rejected because isolation, protected facts,
   backups, deployment safety, and other safeguards are mandatory for every website.

## Consequences

- Every site-scoped table needs a direct or unambiguous tenant/site path and isolation test.
- Worker/service roles and any bypass are explicitly enumerated and audited.
- Prisma access that depends on RLS context must remain inside the transaction that sets it.
- Cross-tenant adversarial tests become a reusable release gate.
- Price metadata does not imply billing/payment automation, and a documented entitlement
  is not deployable until its enforcement and dependent feature pass their release gates.

## Validation

G04 schema constraints, G06 API/RLS/pool tests, G08 subscription tests, G20 worker payload tests, and G30 acceptance scenario A prove the decision.
