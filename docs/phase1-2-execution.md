# Phase 1–2 execution ledger

## Implemented

- Audited content, publication, Customer Admin, queue, worker, and deployment paths;
  retained established RLS, authorization, and immutable-artifact designs.
- Added bounded normalization for all field types and connected all 20 Coop fields to
  snapshot/fact-backed rendering with approved fallbacks.
- Corrected protected-field roles to the platform fact workflow and kept AIO disabled.
- Added idempotent onboarding and read-only readiness/DNS/worker diagnostics.
- Added category queues, durable execution, leases/heartbeats, timeout/retry/cancel
  transitions, and stalled-run recovery migration.
- Added scheduler and publisher/crawler/SEO/monitoring/runner processes and production
  Compose services with limits, health checks, and graceful shutdown.
- Connected Coop static serving to the active-artifact pointer with baked fallback.
- Added exact-host Coop Customer Admin Caddy configuration.
- Corrected publication to use the revision's historical fact snapshot.
- Added a bounded, accessible JPG/PNG/WebP upload control and immutable publication of
  referenced validated media.
- Proved owner/editor/viewer invitations and role restrictions, exact-host isolation,
  queued daemon publish/restore, durable retry/cancel transitions, and stale-lease
  recovery.
- Added mapping, onboarding, worker operations, acceptance, and planning-context docs.

## Remaining implementation/proof

- No non-human-blocked Phase 1/2 implementation item remains after the all-layer
  repository and disposable/staging verification pass.
- A richer visual asset-library picker is a future UX enhancement; the safe upload and
  managed-reference workflow required for this phase is implemented and tested.

## External waiting items

- Real Coop owner email, approved plan, and reviewed protected facts.
- Admin DNS/TLS and authorized VPS deployment window/access.
- Verified outbound email sender/provider credentials and delivery proof.
- Google properties/OAuth, off-site backup, billing, and AI activation are separately
  owner-gated.

## Evidence

On October 12, 2026: typecheck, lint, contracts, 323 tests, both site builds, 52
migrations, RLS/local-stack proof, onboarding idempotency, 20-field/media artifact proof,
queue/scheduler/durable-worker checks, daemon publish/restore, role-correct browser flows,
and all production Compose services healthy passed. Gate A and Gate B are complete; Gate
C is waiting on the named production prerequisites.
