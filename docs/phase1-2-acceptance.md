# Phase 1–2 acceptance record

**Recorded:** October 12, 2026

Passing repository evidence: typecheck; ESLint; all five site contracts; production
Compose static check; 59 test files and 323 tests (one skipped); seven-page Coop build;
six-page OmniReach build; all 52 migrations on a disposable database; local-stack proof
with 84 tables, 83 RLS policies and verified isolation; content-draft, publication
admission, queue, scheduler, durable-worker, publisher-daemon, and ORAP-operation
verifiers; and an exhaustive 20-field Coop artifact including a validated uploaded
image.

The production Compose harness built the release image and started API, both static
sites, scheduler, runner, publisher, crawler, SEO, and monitoring healthy. It verified
credential isolation, restricted runtime identity, persistence after PostgreSQL/Redis
restart, API recovery, both static sites during that interruption, all six worker
heartbeats, and migrations, then removed the isolated stack cleanly. A real spawned
publisher daemon processed both a queued publish and queued restore to immutable
artifacts. Database-backed drills proved retry state, disabled-site cancellation,
expired-envelope cancellation, heartbeat writes, and stale-lease recovery. The browser
flow invited owner/editor/viewer roles, enforced role and wrong-host boundaries, and
exercised owner edit, preview, publish, history, and restore.

- **Gate A:** passed in repository verification. Core code/config/docs, field/media
  artifact, onboarding rerun, RLS, migrations, static builds, and production service
  startup are proven.
- **Gate B:** passed in the disposable/staging harness. Role-correct and wrong-host
  browser flows, queued publication/restore, worker state/failure recovery, datastore
  restart, and static availability are proven.
- **Gate C:** waiting on owner email, plan/facts, DNS/TLS, deployment access/window,
  provider verification where used, and an authorized production smoke test.

Do not state “Phases 1 and 2 complete in production” until Gate C evidence is attached.
