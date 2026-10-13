# OmniReach — Codex Execution Goal: Phase 1 + Phase 2

**Purpose:** This is an execution specification for Codex working in the OmniReach repository. Complete the first two implementation priorities: (1) make Coop's Mobile Detailing fully manageable through Customer Admin, and (2) activate reliable background execution in production. Do not treat this document as evidence that a feature is live; verify repository code, deployment configuration, and actual runtime behavior.

**Priority:** Complete an operational, secure, reversible end-to-end customer lifecycle before expanding features. Work autonomously through the phases, using repository tests and available staging environments. Do not request permission for routine code changes, test execution, documentation, or local validation. **Do not assume authorization to modify live production, DNS, credentials, customer data, or bills:** prepare the changes and a precise owner-run deployment checklist when access/approval is required.

## 0. Authoritative context and constraints

The October 2026 OmniReach current-state snapshot describes:

- Live public site: `omnireach.cloud`; live internal portal: `admin.omnireach.cloud`; live Coop pilot: `coopsmobiledetailingaledo.com`.
- Customer Admin implementation exists, but Coop's customer-admin hostname is not routed, Coop tenant onboarding is not confirmed, and its end-to-end publishing path is incomplete.
- Most Coop manifest fields are declared but not wired to supported content snapshots.
- PostgreSQL, Redis, API, migrations, initialized platform data, and static sites run in production behind Caddy. Production Compose does **not** run scheduler, job runner, crawler, SEO, AIO, publisher, or monitoring workers.
- Existing code includes contracts/content services, jobs, queues, security, publication history and revision logic; verify function, don't duplicate.
- Public static sites **must remain available** when API, DB, Redis, workers or third-party integrations are down.
- Public sites must not be taken offline automatically for nonpayment.
- All tenant data must remain isolated, changes auditable, publications recoverable, and protected business facts guarded.

Review these repository sources before coding (paths may have changed; locate equivalents):

`docs/masterplan.md`, `docs/roadmap.md`, `docs/architecture.md`, `docs/integration-contract.md`, `docs/operations.md`, `docs/production-compose.md`, `docs/production-inputs.md`, `docs/security.md`, `docs/release-gate.md`, `apps/api`, `apps/orap`, `apps/customer-admin`, `workers`, `packages`, `sites/coops-mobile-detailing`, and production Compose/Caddy/GitHub Actions configurations.

**Status vocabulary:** `Live` = deployed and proven, `Implemented` = code exists but runtime might be disabled, `Partial` = missing parts of end-to-end workflow, `Waiting` = external inputs/approval required, `Deferred` = intentionally outside current scope.

## 1. Mission / end-state

An authorized Coop customer owner can:

1. Reach `admin.coopsmobiledetailingaledo.com` over HTTPS and sign in using the existing customer authentication system.
2. See **only** the Coop tenant/site and permitted content according to their role.
3. Edit every **supported, manifest-declared, customer-editable** Coop field, including appropriate structured collections (services, approved prices, galleries, business details, page content, metadata, theme, section visibility/order) where the declared contract allows it.
4. Save a versioned draft, preview changes without affecting the live site, and receive understandable validation/concurrency feedback.
5. Request/publish through the authenticated, controlled pipeline; see a correctly updated `coopsmobiledetailingaledo.com` public site after activation.
6. Review publication history and restore an earlier valid revision with auditable, safe rollback behavior.
7. Fail safely: protected facts cannot be silently altered; invalid builds never replace the live release; an unavailable worker/API never takes down the active static site.

In parallel, approved production worker services run continuously under Docker Compose and execute queued work safely (scheduler, runner, publisher, crawler, SEO, monitoring). AIO/OpenAI **must stay disabled** unless explicitly authorized after evaluation. Production activation must be observable, bounded, testable and reversible.

## 2. Working rules for Codex

1. **Audit first.** Build an accurate inventory of existing code paths, feature flags, workers, schemas, manifests, APIs, UIs, deployment files, tests and live-only dependencies. Compare to the criteria below. Avoid unnecessary rewrites or duplicate infrastructure.
2. **Plan and execute.** Write an actionable checklist to `docs/phase1-2-execution.md`, update it as steps finish, and work in dependency order. Record evidence for each completed criterion.
3. **Make changes in coherent increments.** Follow existing patterns, run targeted tests after changes, and run broader repository validation before final delivery.
4. **Preserve compatibility.** Version or migrate site contracts and persisted data safely, preserve historical revisions, and avoid destructive schema/data changes.
5. **Never bypass security to unblock development.** Respect verified-host tenant resolution, composite tenant keys, PostgreSQL row-level security, authorization, CSRF/origin controls, session protection, and server-side permission checks. Do not weaken auth or leak sensitive logs.
6. **Protected fields stay protected.** Respect manifest-declared `auto`, `suggestion`, and `disabled/protected` behavior. Business phone, service areas, approved prices, legal copy, owner statements, availability and other protected facts may require authorized owner/staff approval or may be non-editable. Never make these writable just to satisfy a completeness checklist.
7. **Do not invent customer data.** If owner email, domain records, business facts, DNS access, credentials, or consent is unavailable, implement validation and scripts, document exact missing inputs, and mark the item `Waiting`; do not seed fake production identities or overwrite real facts.
8. **No uncontrolled production deployment.** You may construct migration scripts, Compose/Caddy changes and deployment instructions; execute live changes only if explicitly authorized and access is appropriate. Never print secrets or store them in code/git.
9. **No AI autonomous publishing.** AI generation and AIO are not required in this goal. Keep kill switches and per-site budget guards enforced.
10. **No silent 'done'.** Distinguish code complete, staging verified, and production verified. If a required external dependency is missing, finish everything feasible and report the precise blocker and owner action.

## 3. Phase 1 — Complete Coop managed-customer lifecycle

### 3.1 Production data registration and repeatable onboarding

- Inspect existing tenant/site/domain/customer/plan/feature models and initialization procedures.
- Implement or repair **idempotent, safe onboarding tooling** for an existing static customer site. It should discover or create the correct tenant, site, verified-host domain mapping, plan assignment or explicit permitted fallback, feature controls, owner membership/invitation, and minimum publication configuration.
- Handle partially onboarded tenants safely: no duplicate tenant/site/domain records; reruns must reconcile or warn, not clobber production data.
- Add a **read-only readiness/diagnostics command** indicating missing tenant records, DNS, verified host mapping, owner account, publish target, relevant feature flags and workers. Do not reveal credentials.
- Provide an operator checklist for owner identity, domain ownership, plan choice, protected business facts, and required legal approvals. Do not invent them.

**Acceptance:** On a disposable or staging DB, onboarding twice is safe; an authorized Coop owner resolves to the Coop tenant; another tenant cannot view or mutate Coop data; diagnostics accurately distinguish ready from blocked.

### 3.2 Content-contract completeness on Coop site

- Enumerate **every field** in `sites/coops-mobile-detailing` manifest and map it to the live page/rendering source, snapshot schema, editor control, validation and protection policy.
- Fix cases where live pages hardcode content that the manifest claims is editable; connect rendering to validated snapshots for supported dynamic fields.
- Add robust support for declared collections/media as needed: services, service details/prices, add-ons, gallery/images, FAQs, page sections, contact info, service areas, owner story, SEO metadata, visibility and ordering, theme settings, and legal fields **according to their declared editability**.
- Ensure text encoding, URL hygiene, rich-text sanitization, link safety, upload validation, image references, alt text, structured data, canonical URLs and existing SEO foundations survive updates.
- Preserve layout, responsiveness, site identity, existing approved business information and public phone/text actions; no booking/payments backend is in scope.
- Address manifest declarations that cannot be supported safely: either implement them or correct the contract with migration/versioning and documentation; never falsely advertise editability.
- If the first-car savings component lacks its required value, keep it hidden and avoid inventing a number.

**Acceptance:** A field-to-render mapping audit has zero unexplained gaps. All **allowed** fields can be changed in a draft and observed in a preview/published artifact; protected fields cannot be changed by unauthorized roles or AI. Existing public design/content remain correct without a newly published draft.

### 3.3 Customer Admin: deployment-ready, end-to-end experience

- Verify and finish customer sign-in, invitation acceptance, email verification, owner/editor/viewer RBAC, logout, session visibility and tenant host binding using existing auth infrastructure.
- Verify and finish site dashboard, page/field editor, structured collections, media uploads, save drafts, validation feedback, conflict handling, preview, publish, publication history and restore.
- Enforce authorization on **every server endpoint**, not just in UI. Owner/editor/viewer privileges must match existing contract; unauthorized actions must fail securely.
- Ensure accessible, comprehensible errors for lost sessions, conflicting revisions, unavailable previews/workers, invalid media, build failures and publishing timeouts.
- Keep customer TOTP enrollment/management and mandatory customer 2FA **out of this goal** unless essential to an already-defined minimum auth policy. Do not remove existing optional security protections.
- Set up deployable customer-admin service/container, host-based reverse proxy rules, TLS handling and environment/health checks following established conventions. Prepare `admin.coopsmobiledetailingaledo.com` DNS requirements; do not claim it resolves without verification.

**Acceptance:** In a production-equivalent environment, an invited owner signs in via the correct host, makes allowed edits, saves/reloads drafts, previews, publishes and restores revisions. Cross-tenant and unauthorized access tests pass.

### 3.4 Publishing pipeline and rollback

- Trace the complete path: editor → draft/version → schema and protected-fact validation → preview → authorized publication request → queue → worker → immutable snapshot/artifact → build → atomic/safe activation → history/audit.
- Finish any missing pieces in preview content retrieval, build orchestration, immutable artifacts, publication target configuration, release activation and revision restore.
- Respect optimistic concurrency, idempotency and job retries. Concurrent edits/publications must not silently overwrite changes or activate releases out of order.
- Ensure preview URLs/artifacts are not indexed by search and cannot leak private draft data across tenants; use authenticated/short-lived access where applicable.
- Perform deployment with a verified build artifact and an atomic or safe replacement strategy; retain previous working release to recover. Preserve static public site during rollback and infrastructure outages.
- Produce an operator-usable rollback command/runbook, with a dry run or safe staging validation.

**Acceptance:** A clean staging run proves create draft → preview → publish → verify live page → view history → restore prior revision → verify public page. Inject a build failure and worker outage: currently live content remains reachable and unchanged. Repeating a job must not produce conflicting releases.

## 4. Phase 2 — Productionize background execution

### 4.1 Worker inventory and job topology

- Map scheduler, runner, publisher, crawler, SEO, AIO and monitoring components to their actual entrypoints, queues, dependencies, environment variables, flags, and resource requirements.
- Identify jobs currently created but not processed; verify routing, queue names and job/state transitions.
- Use existing Redis/BullMQ conventions, database migrations, lease and retry mechanisms instead of creating parallel infrastructure.
- Publish a worker matrix in execution docs: purpose, service, queue, frequency, concurrency, timeout, dependencies, health signal, kill switch, and estimated resource usage.

### 4.2 Production Compose/configuration

- Extend production Compose and deployment procedures to run required workers: **scheduler, job runner, publisher, crawler, SEO and monitoring**, enabling them selectively in safe dependency order.
- Implement restart behavior, secrets via approved injection, least-privilege permissions, resource constraints, log configuration, health/readiness checks, shutdown handling and startup dependencies.
- Avoid duplicate schedulers; scheduled tasks must not be double-enqueued after restarts or parallel deployments.
- Keep **AIO worker and OpenAI provider disabled by default**. If an AIO service is included for configuration parity, ensure no AI work occurs without explicit owner enablement and budgets.
- Ensure production jobs cannot publish or alter a different tenant's site even when malformed queue payloads are submitted.
- Provide staging and production `.env.example` or configuration reference **without secrets**, documenting required and optional variables and safe defaults.

**Acceptance:** On staging Compose, required services start, report health, process representative jobs and recover after restart. Static Coop and OmniReach sites continue serving when workers, API, Redis or database are intentionally stopped (assuming existing live static containers remain up).

### 4.3 Job correctness, operational bounds and kill switches

- Validate durable job lifecycle: enqueue, lease/claim, execute, retry/backoff, idempotency, cancellation, replay, timeout/dead-letter handling and terminal state.
- Establish sensible and configurable concurrency/resource quotas per worker and per tenant/site, including crawl rate limiting and safeguards against unbounded queues.
- Verify behavior for duplicate jobs, process crashes, worker restarts, lost Redis connections, temporarily unavailable database, failed build, bad artifact and invalid tenant scope.
- Verify emergency controls: freeze customer editing, stop automation, stop autonomous modifications; ensure operations remain correctly separated (for example, stopping automated proposals should not unexpectedly take public websites offline).
- Make job states and errors visible through existing ORAP job inspection wherever current UI permits; finish the minimum needed for staff to triage and replay safely.

**Acceptance:** Integration tests demonstrate retry and idempotency, limits, cancellation/replay and correct kill-switch enforcement. No indefinite stuck leases or duplicate publication activations under tested failure conditions.

### 4.4 Monitoring and runbooks

- Enable the existing monitoring worker and production alerts, with documented alert ownership and escalation; don't claim email alerts work until delivery is tested.
- Instrument worker/process health, queue age/depth, job failures/retries, publishing latency, failed artifacts, scheduler liveness and resource pressure without logging secrets or customer content.
- Create clear runbooks for failed jobs, stuck leases, queue backlog, publisher failures, worker restart, Redis outage, rollback and excessive crawl load.
- Document how staff confirm workers are actually running and how to pause/resume automation safely.

**Acceptance:** Staging failure drills produce observable failure states and meaningful operator guidance. Any unverified external alert sender remains explicitly `Waiting`, not `Live`.

## 5. Tests that must be added or updated

Implement automated tests at the lowest practical layer and production-equivalent integration tests for critical paths:

- Tenant boundary: wrong host, mismatched membership, tenant-key injection, cross-tenant media/draft/job/history access, RLS invariants.
- Roles: owner/editor/viewer and platform staff actions; server must reject unauthorized mutations.
- Onboarding: idempotent reruns, partial preexisting data, invalid host/domain mapping, missing owner and missing feature flag.
- Contract: every manifest field has correct validation and rendering/snapshot behavior; protected fields cannot be modified outside policy; migration/backward compatibility.
- Editing: draft save/load, conflict detection, rich-text/XSS protection, unsafe URLs, media file validation, alt text, ordering and hidden sections.
- Publishing: preview isolation/no-index, failed validation, worker outage, build failure, duplicate job, concurrent revisions, artifact verification, activation and restore.
- Worker operations: start/stop/restart, retries, leases, idempotency, timeouts, quota/rate limits, kill switches, cancellation/replay, monitoring.
- Availability: currently activated static sites stay served independently of control-plane outages.

Prefer an automated staging smoke test (script or documented commands) covering the full customer journey. Do **not** assert a production pass based solely on unit tests.

## 6. Required deliverables

1. Working source code, migrations (if necessary), tests and production-ready configuration changes for both phases.
2. `docs/phase1-2-execution.md`: living task checklist, discovered gaps, decisions and per-item evidence/status.
3. `docs/coop-field-mapping.md`: complete manifest field → snapshot → editor → rendered output → permission matrix, with notes for any intentionally protected/uneditable fields.
4. `docs/coop-onboarding.md`: repeatable onboarding workflow, required owner-provided inputs, preflight diagnostics, staging verification and **separate** production procedure.
5. `docs/worker-operations.md`: topology/configuration, startup/health, limits, alerts, failure handling, pause/resume, deployment and rollback.
6. `docs/phase1-2-acceptance.md`: exact test commands, results, staging evidence, any production evidence, remaining blockers and next actions.
7. Update existing roadmap/release gate/architecture/operations docs where relevant to reflect verified actual state (do not falsely label features Live).
8. A concise final implementation report containing: what changed, tests run, what is code-complete, what was demonstrated in staging, what remains to be activated in production, required secrets/DNS/customer information, and clear commands for operators.

## 7. Completion gates / definition of done

### Gate A — Code complete

- All mapped Phase 1 and 2 implementation tasks either pass tests or are explicitly blocked by named external prerequisites.
- No unexplained editable-field contract gaps or missing required worker service definitions.
- Test suite, lint/typecheck/build and security-sensitive regression checks pass.
- Documentation and safe deployment/rollback processes exist.

### Gate B — Staging end-to-end proven

- Valid customer identity is invited and exercises role-correct Coop editing.
- Draft → preview → publish → public verification → revision restore is demonstrated.
- Required workers run in staging; failure, recovery, job replay and kill-switch tests pass.
- Other-tenant and protected-fact security tests pass.
- Static site survives control-plane/worker interruptions.

### Gate C — Production live proven (only with owner authorization)

- Real Coop tenant, domain mapping, plan, permissions, feature flags and owner are validated.
- `admin.coopsmobiledetailingaledo.com` DNS/TLS/routing works.
- Worker containers run and process real authorized work with observable health.
- Authorized production customer successfully completes a safe, approved edit/publish/restore smoke test.
- Monitoring shows no unresolved critical failures and rollback is available.

**Only say “Phases 1 and 2 complete in production” after Gate C.** If Gate A/B pass but Gate C is blocked, report **“implementation/staging complete; awaiting specified production prerequisites”** and list those prerequisites exactly.

## 8. Out of scope for this goal

- Turning on OpenAI/AIO or autonomous SEO publishing.
- Completing Google OAuth, Google Search Console, GA4, Google Business Profile.
- Final pricing/overages, payment processing, subscription-provider integration.
- SMS/chat campaigns, booking, payments, commerce or custom customer backend.
- Mandatory customer 2FA or a full security-UX redesign beyond the minimum secure sign-in path.
- Off-site backup provider setup and broad security/recovery programs (important separate follow-up; do not disable existing protections).
- Kubernetes, multi-region infrastructure, new CDN, split worker machines, major platform redesign.
- Public marketing website redesign or new customer pilot sites.

## 9. Start here (first actions)

1. Read the repository documentation and current runtime/deployment configuration.
2. Generate the Phase 1/2 dependency graph and gap checklist with concrete file references.
3. Find the smallest complete vertical slice: one editable Coop field → saved draft → preview → queued publication → live artifact → restore.
4. Implement and prove that slice on staging, then expand to all declared supported fields.
5. Add/enable workers as needed for that slice; finish worker reliability and monitoring next.
6. Update acceptance evidence continuously. Stop only for a genuinely external permission/credential/identity/DNS blocker; otherwise continue resolving implementation tasks until Gates A and B are satisfied.

**Guiding rule:** A complete, secure and tested management/publishing loop for one real customer site is worth more than many partially connected features.
