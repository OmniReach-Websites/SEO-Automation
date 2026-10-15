# ADR 0005: Static publication, previews, and contact forms

- **Status:** Accepted
- **Date:** 2026-10-10
- **Decisions:** D-009, D-010, D-020

## Context

Initial sites should remain online when control/worker/provider systems fail. Customers need previews and V1 contact forms without turning each site into an always-on application server.

## Decision

- Build immutable static artifacts from one frozen code/content/asset snapshot.
- Validate and health-check before atomically switching a site's active artifact.
- Keep the prior healthy artifact as rollback target; never mutate artifacts in place.
- Use authenticated, expiring, no-index previews isolated by origin and/or sandbox/CSP.
- Implement contact forms as optional reusable components declared by the site contract
  and backed by one centralized platform service, never a separate backend per customer.
  Static pages do not depend on form/API availability.
- ORAP administrators enable or disable forms per website. Authorized customer roles may
  configure only supported fields and view only submissions for their own site.
- Forms validate site/origin/schema, use Cloudflare Turnstile, honeypots and rate limits,
  redact logs, minimize retention, and deliver through an adapter. Attachments are off by
  default. Confirmation email is optional and disabled by default.
- R-009 selects Resend for production contact delivery from the
  `forms@updates.omnireach.cloud` sender to each site's verified business recipient.
  Submissions have a 30-day retention period and audited automatic deletion, subject to
  legal/security holds and owner-approved consent wording. The shared Resend domain and
  credential are verified; customer recipient verification, production Turnstile
  configuration, explicit contact-channel activation, and legal consent approval remain
  gated.

## Alternatives considered

1. **One SSR process per site:** rejected for initial resource cost and failure coupling.
2. **Render every public request from live PostgreSQL:** rejected because API/database failure would take sites offline.
3. **Public guessable preview URLs:** rejected due draft/content leakage.
4. **Per-site arbitrary form handlers:** rejected due credential, spam, tenant, and runtime risk.

## Consequences

- Content publication requires a build or an explicitly approved equivalent artifact refresh.
- Preview and contact services may fail independently while public content remains available.
- R-009 activation inputs are required before real contact delivery/retention.
- Dynamic sites beyond contact forms require separate architecture.

## Validation

G13 reproducibility/outage/form tests, G15 preview tests, G16 failure rollback, and G30 resilience/security suites prove the decision.
