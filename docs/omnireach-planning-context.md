# OmniReach planning context

**Snapshot date:** October 12, 2026
**Audience:** planning agents, implementers, and operators
**Rule:** `Implemented` means source exists and has repository evidence. It does not mean
the capability is deployed. Only direct runtime evidence may be called `Live`.

## What OmniReach is

OmniReach is an agency-operated, multi-tenant website management and search-operations
platform. It separates public websites from the control plane used to manage them.
Customers receive a fast static website and host-bound Customer Admin; staff use ORAP
(the OmniReach Admin Panel) to manage tenants, sites, people, plans, operational controls,
jobs, findings, integrations, and audit history.

It is intentionally not a general-purpose page builder. Each managed site declares a
versioned contract for pages, editable fields, protected facts, roles, builds, routes,
previews, and forms. Changes must fit that contract, become immutable revisions and build
artifacts, and remain restorable. Public static releases stay available if the API,
database, Redis, workers, or an external provider is unavailable.

## User-facing surfaces

### Public site — `omnireach.cloud`

The marketing site has Home, Services, About, Contact, and Privacy pages plus responsive
navigation, metadata, canonical URLs, robots, sitemap, and a public inquiry form. The
form posts to `/v1/public/platform-inquiry`, validates fields and consent, rate-limits and
uses a honeypot, resolves every active Platform Owner email at delivery time, and sends
one replyable message per unique owner from `forms@updates.omnireach.cloud` when delivery
is enabled. Addresses are not returned to the browser. Static pages remain online if
delivery fails. Email is `Waiting` until sender DNS/key, recipients, and real delivery
are verified.

### ORAP — `admin.omnireach.cloud`

ORAP is the internal control plane. Implemented modules cover privileged sign-in,
platform MFA/WebAuthn, recovery and secure sessions; staff invitations and revocation;
tenant, site, domain, customer membership, plan/subscription and feature administration;
emergency controls; audit trails; and operations views for jobs, schedules, crawls,
findings, alerts, reporting, and integrations. Capability checks run on the server and in
PostgreSQL. The actual VPS release/data still needs direct verification.

### Customer Admin — `admin.<customer-domain>`

Customer Admin supports invitations, sign-in, verification policy, logout, session and
security visibility, and site-scoped owner/editor/viewer roles. It includes a dashboard,
manifest-driven editor, draft save/reload, optimistic concurrency, preview, publish,
history, restore, contact-form controls, and media endpoints. Preview access is
short-lived, signed, site-bound, and no-index. The Coop Caddy route is implemented;
production DNS/TLS and a real owner invitation remain `Waiting`.

### Coop pilot — `coopsmobiledetailingaledo.com`

The responsive static site has Home, Services, Our Work, About, Contact, Privacy, 404,
robots, and sitemap routes. It retains approved current content and images as a baked
fallback. Its 20 declared fields now have runtime paths for heading, introduction, hero,
CTA, highlights, section order, services, prices, add-ons, gallery content/media/order/
visibility, story, FAQ, phone, areas, privacy, metadata, theme, and first-car goal. The
goal remains hidden without reviewed enabling values.

Owners/editors may change contract-allowed non-protected content. Phone, locations,
prices, availability, owner statements, FAQ/policy, legal copy, and goal data are
protected facts requiring an authorized platform role; AI is disabled for them. A
publication now uses the fact snapshot captured with that revision, preserving historical
restore fidelity.

## Architecture and publication flow

1. Caddy terminates TLS and routes exact public/admin hosts.
2. Static containers serve baked Astro output without the control plane.
3. Fastify serves auth, ORAP, Customer Admin, forms, previews, and APIs.
4. PostgreSQL owns identity, tenant/site/domain mappings, contracts, content, facts,
   revisions, artifacts, jobs, schedules, alerts, findings, integrations, and audits.
   Composite keys, transaction context, and RLS enforce tenant/site boundaries.
5. Redis/BullMQ carries schema-validated identifiers; PostgreSQL is the durable job truth.
6. A single DB-leased scheduler dispatches category-specific queues.
7. Workers rehydrate the exact scoped job, lease/heartbeat it, enforce timeout/retry/
   cancel rules, and persist terminal state.
8. Publishing materializes an immutable snapshot, runs an allowlisted Astro build,
   verifies routes/hashes, stages immutable files, and atomically changes `active.json`.
9. The Coop server follows that pointer and falls back to the baked release if it is
   absent or invalid.

## Complete functional inventory

Status terms in this inventory are deliberately strict:

- `Implemented/tested`: source exists and repository or disposable-environment evidence
  passes.
- `Waiting`: the implementation exists, but safe activation depends on a named external
  input, credential, approval, or production check.
- `Deferred`: intentionally outside the current release rather than accidentally missing.

### Identity, access, and security

- Central identities, normalized email addresses, Argon2id passwords, account state,
  invitation acceptance, password reset, one-time recovery state, and session revocation
  are implemented/tested.
- Platform accounts support the required two-step policy using short-lived hashed email
  codes; TOTP, WebAuthn/passkeys, and recovery codes are implemented as stronger options.
- Customer Owner, Editor, and Viewer roles are implemented. Owners publish; Editors edit
  and may publish only with an explicit grant; Viewers are read-only. Platform Owner,
  Platform Admin, and scoped Staff grants are deny-by-default.
- Exact verified admin hosts determine customer scope. Host-only secure cookies, origin/
  CSRF checks, trusted-proxy handling, attempt/rate limits, idle/absolute session limits,
  audit attribution, and PostgreSQL RLS are implemented/tested.
- Real platform/customer identities and live sign-in remain waiting on production owner
  inputs, email delivery, DNS/TLS, and an authorized smoke test.

### Agency administration and commercial controls

- ORAP can create/manage tenants, sites, domains, customer invitations/memberships,
  staff access, capability assignments, and site-scoped authorization.
- Versioned STARTER, GROWTH, PRO, and ELITE plan proposals, one subscription per site,
  customer-seat/page/location limits, grace-state behavior, feature overrides, quotas,
  AI budgets, and emergency controls are implemented/tested.
- Nonpayment does not take the public site offline; policy can pause new editing and
  automation after the configured grace behavior.
- Final prices, setup/bespoke fees, billable definitions, overages, extra-location rules,
  a billing provider, and automated payments are waiting/deferred commercial decisions.

### Site contracts, content, facts, and media

- Every site has a versioned manifest declaring pages/routes, editable fields, field
  types, role permissions, protected status, AI mode, build command, preview, health
  routes, forms, and required tools. Five contracts currently validate.
- Structured text, rich text, safe links, cards, metadata, themes, visibility, section
  order, images, and alt text are bounded and normalized. Unsafe URLs/markup and unknown
  fields fail closed; draft writes use optimistic concurrency.
- Protected business facts are stored and authorized separately. AI cannot read them as
  replacement targets or propose changes to them. Historical revisions retain their
  original fact snapshot so restore does not silently pick up newer facts.
- JPG, PNG, and WebP upload, size/type/dimension validation, checksum/integrity metadata,
  site-isolated storage, safe download, managed references, referenced-byte publication,
  and alt text are implemented/tested. The current Customer Admin provides an accessible
  upload control; a richer reusable thumbnail library is optional future UX.

### Drafting, preview, publication, and rollback

- Customer Admin provides manifest-driven controls, save/reload, field and whole-draft
  updates, conflict reporting, protected/unavailable states, preview, publish, history,
  restore, media upload, dashboard status, and contact-form controls.
- Previews are built from a draft snapshot, short-lived, signed, site-bound, authenticated,
  and no-index. They cannot change the active public artifact.
- Publish/restore requests are idempotent and admitted into durable PostgreSQL jobs. The
  publisher builds from an immutable content/fact/asset snapshot in an allowlisted
  workspace, verifies expected routes and hashes, stages immutable files, health-checks,
  and atomically activates an artifact. Failure preserves the prior active release.
- A disposable publisher daemon has processed a real queued publish and restore. A live
  Coop publish/restore remains waiting for verified production identity, content, DNS,
  deployment, and owner approval.

### Jobs, scheduling, monitoring, and availability

- PostgreSQL is the durable source for jobs and runs; Redis/BullMQ transports only bounded
  identifiers. Category queues cover publish, crawl, SEO audit, health check, AI proposal,
  backup, and metrics synchronization.
- The scheduler uses database claims, deterministic windows, time zones, jitter,
  deduplication, and next-attempt advancement. Workers use per-site/category exclusion,
  leases, periodic heartbeats, bounded concurrency, timeouts, retry classification,
  attempt limits, cancellation, safe errors, graceful drain, and stale-run recovery.
- Publisher, crawler, deterministic SEO, monitoring, scheduler, and recovery-runner
  services are production-Compose defined and start healthy. AI proposal execution is
  disabled; backup and metrics job handlers cancel safely until their separate production
  adapters are approved.
- Alert records support fingerprints, deduplication, severity, acknowledgment, assignment,
  resolution, escalation, and optional Resend delivery. Real external alert delivery is
  waiting for verified sender/recipients and credentials.
- Both public static sites remain served independently during PostgreSQL/Redis/API/worker
  recovery. The staging harness verifies datastore persistence, API recovery, six worker
  heartbeats, and static availability.

### SEO, analytics, AI, integrations, and reporting

- A bounded same-site crawler, persisted crawl evidence, deterministic SEO audit rules,
  findings lifecycle, structured-data checks, sitemap/robots/canonical metadata, job/
  alert reporting, and honest unavailable states are implemented/tested.
- Google OAuth/token encryption, Search Console and GA4 connection foundations exist, but
  real properties, scopes, consent configuration, credentials, and data verification are
  waiting. Google Business Profile automation is not part of this release.
- Typed AI-provider boundaries, proposal review state, per-field policy, monthly review
  cycles, and atomic $5/site plus $50/platform budget caps are implemented/tested.
  `OPENAI_PROVIDER_ENABLED=false`; no autonomous or paid AI/AIO execution is authorized.
- AI referral reporting and sampled AI mentions must remain clearly labeled and may not
  be represented as rankings. Competitor monitoring, reputation management, social
  publishing, CRO experiments, and automated content expansion are deferred.

### Forms, email, privacy, operations, and delivery

- Bounded reusable contact forms, consent/honeypot/rate-limit controls, encrypted-at-rest
  submission data, retention/hold controls, reply-to delivery, and owner-recipient
  resolution are implemented/tested. Public and customer forms fail safely without
  exposing recipient addresses.
- Resend adapters exist for contact messages, authentication messages, and alerts. Live
  delivery remains waiting for sender-domain DNS/key verification, secrets, flags, and
  recipient proof.
- GitHub CI/release policy, pinned production images, SSH deployment/rollback harnesses,
  exact-host Caddy configuration, secret files, non-root/read-only containers, private
  datastore networking, resource limits, log rotation, health checks, and migration
  handling are implemented/tested locally.
- Local encrypted backup/restore policy and harness foundations exist. The off-site R2
  provider, real retention execution, and monthly isolated production restore drill are
  waiting as a separate operational project.
- Owner-approved privacy/terms/incident/deletion text and production consent/retention
  values are waiting. The repository contains safe baseline privacy pages, not a claim of
  final legal approval.

### Explicitly deferred product areas

Self-service site creation, arbitrary HTML/CSS/JavaScript editing, booking, SMS/chat
campaigns, commerce, payment processing, advanced transactional customer applications,
Kubernetes, multi-region infrastructure, and a new CDN are not incomplete Phase 1/2
features. They require separate product decisions, designs, security review, and scope.

## Capability status

| Capability                       | Repository state                               | Still needed                                        |
| -------------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| OmniReach marketing site         | Implemented; build passes                      | Confirm deployed release and live form delivery     |
| Public inquiry form              | Implemented/tested                             | Enable provider, verify sender and owner recipients |
| ORAP                             | Implemented with capability/audit controls     | Verify VPS release and worker visibility            |
| Customer auth/host binding/RBAC  | Implemented/tested                             | Real Coop DNS, identity, invited-owner smoke        |
| Draft/validation/concurrency     | Implemented; staging/browser proof passes      | Authorized production smoke                         |
| Preview                          | Implemented, signed/scoped/no-index; staged    | Authorized production smoke                         |
| Publish/history/restore          | Immutable daemon publish/restore staged        | Authorized production smoke                         |
| Coop 20-field rendering          | Exhaustive field/media artifact proof passes   | Authorized production content review                |
| Media storage/validation         | Safe upload and published bytes tested         | Optional richer asset-library picker                |
| Scheduler                        | Daemon, DB lease, dispatch verified            | Production observation                              |
| Runner/recovery                  | Retry/cancel/heartbeat/stale recovery verified | Production observation                              |
| Publisher/crawler/SEO/monitoring | Implemented; Compose services start healthy    | Authorized production representative work           |
| AIO/OpenAI                       | Libraries/policies implemented                 | Intentionally disabled; no activation authorized    |
| Search Console/GA4               | Connector foundation                           | OAuth/properties/access/production verification     |
| Backups                          | Local policy/harness foundations               | Off-site provider and real restore drill            |
| Payments/subscriptions           | Manual subscription state                      | Provider/pricing intentionally deferred             |
| Booking/SMS campaigns/commerce   | Not in scope                                   | Separate product decision/build                     |

## Production services and invariants

Compose now describes PostgreSQL, Redis, migrations, data initialization, API, both
static sites, scheduler, recovery runner, publisher, crawler, SEO, and monitoring. It
uses a pinned release image, non-root runtime, private backend, injected secrets, rotating
logs, limits, restart policies, health checks, and graceful shutdown. Datastores expose no
host ports. AIO is absent and `OPENAI_PROVIDER_ENABLED=false` is the default.

Exact verified hosts select scope; request input cannot. Server authorization and RLS are
authoritative. Protected facts cannot receive AI proposals. Queue messages contain IDs,
not secrets/customer content. Invalid builds, worker outages, nonpayment, and automation
stops do not remove the active public site. Material actions are auditable.

## Known gaps and why paused

1. **Production activation:** waiting for appropriate VPS execution, current inventory,
   and an approved window; source changes are not live.
2. **Coop owner/plan:** waiting for verified owner email and explicit plan; fake
   production identities are prohibited.
3. **Admin DNS/TLS:** waiting for the admin hostname to point to the VPS and successful
   Caddy certificate issuance.
4. **Protected facts:** waiting for authorized review before onboarding may seed them.
5. **Email:** waiting for Resend sender DNS/credentials/flags/recipients and delivery proof.
6. **Media UX enhancement:** the safe file picker/upload/reference workflow is complete;
   a richer reusable visual asset library can be planned later.
7. **External integrations:** Google, off-site backup, billing, and AI activation need
   separate credentials/decisions and are outside this release.

## Next planning priorities

1. Resolve owner inputs, deploy through the signed release/rollback process, then verify
   DNS/TLS, heartbeats, queue work, safe edit/publish/restore, and email delivery.
2. After production is stable, connect authorized Google properties and an off-site
   backup provider as separate projects.
3. Consider a richer media-library picker only after observing the initial customer
   workflow; it is not a launch blocker.

## Verification snapshot

On October 12, 2026, typecheck, ESLint, contracts, 59 test files/323 tests, both Astro
builds, all migrations, RLS isolation, onboarding reruns, a 20-field/media artifact,
owner/editor/viewer browser enforcement, daemon publish/restore, worker recovery drills,
and all production Compose services passed. Gate A and Gate B are complete in the
repository/disposable staging harness. Gate C remains unproven and waiting on the named
production prerequisites.
