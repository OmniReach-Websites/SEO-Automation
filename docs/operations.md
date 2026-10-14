# OmniReach Operations Baseline

**Status:** Local implementation verified; R-003 production inventory reviewed  
**Safety rule:** Nothing in this document authorizes production access or mutation

## 1. Environment contract

| Environment  | Trigger                                 | Data rule                     | Provider rule                      | Deployment rule                                 |
| ------------ | --------------------------------------- | ----------------------------- | ---------------------------------- | ----------------------------------------------- |
| `local`      | Developer command                       | Fabricated only               | Mock/sink by default               | Dev compose only                                |
| `ci`         | Pull request/branch/main checks         | Ephemeral fabricated fixtures | No production provider credentials | Build artifacts; no deployment                  |
| `staging`    | Authorized manual or protected workflow | Fabricated/sanitized          | Approved sandbox/test accounts     | Isolated target, never shared production routes |
| `production` | Protected `main` push after G31         | Approved live data            | Approved scoped accounts           | Immutable artifact via restricted SSH           |

The names are configuration contracts. G01 does not create them.

## 2. Required production inputs

R-003 read-only inventory access and R-013 initial service objectives were approved on
2026-10-10. Sanitized R-003 evidence was reviewed and recorded on 2026-10-11. The other
R-series items in [`roadmap.md`](roadmap.md) remain the owner-input queue.

These values belong in approved secret/config systems, not this repository. Missing input blocks only its external step; local/mock implementation continues.

The approved V1 credential-handling policy uses protected GitHub Actions environment
secrets for CI/CD credentials and permission-restricted, host-only environment files or
Docker/Compose secret mounts for runtime credentials. Values must never enter chat, Git,
images, artifacts, or logs. The owner is the recovery-code custodian; a shared vault such
as Bitwarden is deferred until employee credential sharing is required. See
[`security.md`](security.md) for the complete handling controls.

## 3. Local setup contract (implemented by G02–G04)

Expected future workflow:

1. Install the pinned Node/npm toolchain.
2. Copy `.env.example` to an ignored local file and use fabricated values.
3. Validate `infrastructure/compose/dev.compose.yml` before starting it.
4. Start only the uniquely named OmniReach dev project.
5. Wait for Postgres/Redis health, apply migrations, seed fictional tenants/sites, and run readiness checks.
6. Run `npm run verify:goal -- GNN` and `npm run verify:all`.
7. Stop the named dev project. Remove a local volume only after resolving and verifying its exact project/path.

G02 will replace this contract with exact executable commands. Until then, no command in this section should be inferred to exist.

## 4. Read-only production discovery (R-003)

Before G18, G29, G30, or G31 can rely on production facts, an explicitly authorized read-only inventory must record sanitized evidence for:

- OS, Docker/Compose/Caddy versions and restart state.
- Current compose projects, container names, health, resource limits, and restart policies.
- Port bindings, Docker networks, Caddy imports/routes, and certificate storage ownership.
- Christians Reunite services, databases, volumes, networks, routes, health endpoints, and resource baseline.
- CPU/RAM/swap/disk/inode headroom, log growth, backup sizes, and build concurrency risk.
- Existing deployment users, release paths, filesystem permissions, and SSH policy without exposing keys.
- Firewall exposure and confirmation that databases/Redis are not public.

The inventory must not print secret values, private keys, full environment files, customer data, or database contents. Discovery performs no reload, restart, pull, prune, migration, or config write.

The approved collection script is [`../tooling/vps-read-only-inventory.sh`](../tooling/vps-read-only-inventory.sh).
It prints selected metadata and redacted configuration structure only; it never reads
environment-file contents, container environment values, logs, databases, private keys,
or secret objects.
Reviewed nonsecret results and open evidence gaps are recorded in
[`infrastructure-inventory.md`](infrastructure-inventory.md).

G30's bounded follow-up observer is
[`../tooling/vps-g30-observation.sh`](../tooling/vps-g30-observation.sh). It samples
load, memory, filesystem/inode headroom, container resource metadata, container status,
and—only when `EXISTING_PUBLIC_URL` is supplied—HTTPS timing/status without downloading
or printing a response body. The reviewed Caddy inventory identifies the existing route
as `https://christiansreunite.com`; the URL contains no credentials. Run the observer
over SSH by piping the local script to `bash -s`; do not copy it into a production path
merely to collect evidence. The approved baseline uses
`OMNIREACH_OBSERVE_MINUTES=30`, `EXISTING_PUBLIC_URL=https://christiansreunite.com`, and
the default 60-second interval. This observation performs no service, configuration,
DNS, or file change.

The 2026-10-11 returned run contains nine samples over roughly eight minutes. Existing
containers stayed running, the database stayed healthy, the public route returned HTTP
200 in every sample, and host load/memory/disk headroom remained stable. `/opt/backups`
was absent. Because OmniReach was not running and the run did not reach 30 minutes, this
is a useful pre-deployment baseline only; it does not establish ten-site production
capacity. The isolated ten-site suite completes G30's pre-production evidence; live-host
soak and existing-service non-regression are mandatory G31 checks after staging and
before public activation. Exact sanitized figures are recorded in
[`infrastructure-inventory.md`](infrastructure-inventory.md).

The reviewed effective SSH policy currently permits direct root login and password
authentication. This is a release risk, not authorization to change SSH. Any hardening
must be separately approved and must first prove non-root sudo and key-based access in a
concurrent session to avoid lockout.

### 4.1 Initial V1 service objectives (R-013)

| Objective                  | Approved initial target                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| Monthly availability       | 99.5%                                                                    |
| Planned maintenance        | Sunday 02:00–04:00 America/Chicago                                       |
| Backup RPO                 | 24 hours                                                                 |
| Recovery RTO               | 8 hours                                                                  |
| Backup recovery points     | 3 daily and 1 weekly, encrypted off-server copy included                 |
| Critical notification      | ORAP and email                                                           |
| Critical acknowledgment    | 30 minutes                                                               |
| Noncritical acknowledgment | 24 hours                                                                 |
| Initial capacity           | Approximately 10 sites on the existing 2-core, 8 GB RAM VPS              |
| Expansion                  | Allowed when measurements require it, subject to separate owner approval |

These are operating targets and release-gate criteria, not deployment authorization or
a promise that the unmeasured current host already satisfies them.

The first owner-authorized G31 window is Sunday, October 18, 2026, from 02:00 to 04:00
`America/Chicago` (07:00–09:00 UTC). The execution checklist must include a time budget
and rollback cutoff so work cannot silently extend beyond the window.

### 4.2 Production backup profile (R-005 activation authorized)

The owner authorized the following production activation on 2026-10-14:

- Write daily compressed encrypted archives under `/opt/backups/omnireach/`.
- Include PostgreSQL, editable customer website content, uploaded media, and important
  platform configuration; exclude build caches and reproducible artifacts.
- Validate archive envelopes, checksums, and required members automatically.
- Retain 3 daily and 1 weekly recovery point. Automated pruning may enforce only this
  policy; capacity pressure must alert and pause safely rather than prune below it.
- Support a monthly isolated restoration test.
- Permit the owner to download an encrypted archive weekly over SFTP or SCP and verify
  its checksum on the personal destination.

Cloudflare R2 is the selected off-server destination under the approved $5 monthly
storage ceiling. Installation transfers its least-privilege credentials into host-only
secret files and generates the independent encryption key on the VPS. Completion still
requires live evidence that the scheduled encrypted copy, 3-daily/1-weekly retention,
and a real isolated restore succeed.

The owner is the sole encryption-key custodian and sole manual-deletion approver. Every
manual deletion records the owner approval, exact archive manifest/checksum, reason, and
outcome. Automated deletion is permitted only when it demonstrably preserves the
approved production set of 3 daily and 1 weekly recovery points.

### 4.3 Approved production-provider directions (partial R-006–R-012)

- Legal operating jurisdiction starts in Texas, USA. Privacy, cookie-consent, terms,
  deletion, incident-notification, and revision-retention text must be reviewed and
  approved by the business owner before customer launch; this documentation does not
  invent legal terms or replace legal review.
- Google integrations use one owner-controlled OmniReach Google Cloud OAuth project.
  Each customer's Search Console and GA4 property is connected individually through an
  authorized Google account and exact verified property mapping.
- Resend is the selected delivery adapter for critical operational alerts and customer
  contact forms. Planned alert sending uses `updates.omnireach.cloud` and confirmed sender
  `alerts@updates.omnireach.cloud` on a $0 budget. ORAP retains the authoritative alert
  lifecycle; only critical failures also send email. Provider limits are hard admission
  boundaries, and paid upgrades/overages require new owner approval.
- Authentication delivery uses the selected sender `auth@updates.omnireach.cloud`.
  `rhajj@omnireach.cloud` is approved as the testing alert recipient; reconfirm the final
  production recipient before activation. Email delivery flags remain disabled until
  sender-domain verification and credential installation are complete.
- Contact submissions route only to a verified per-customer business address, reject
  attachments by default, use Cloudflare Turnstile, honeypots, and rate limits, and are
  retained for 30 days before audited automatic deletion unless a legal or security hold
  applies. Forms are optional reusable components backed by the centralized service.
  ORAP administrators enable/disable them per site; authorized customers configure
  supported fields and view only their own submissions. Confirmation email is optional
  and disabled by default. The selected sender is `forms@updates.omnireach.cloud`, subject
  to sender-domain, recipient, provider, credential, consent, and activation gates.
- The human owner is the initial production approver. Protected `main` pushes are the
  only automatic production trigger for `OmniReach-Websites/SEO-Automation` and use a
  restricted non-root account named `omnireach-deploy` after G31 authorization and setup.
  The owner retains deploy-key custody. The account has no unrestricted sudo or Docker
  daemon access. Root/password SSH remains unchanged until non-root deployment and
  emergency recovery have been tested under separate authorization.
- The selected commercial proposal has four per-website plans with one included business
  location and a 14-day nonpayment grace period:

  | Tier    | Proposed monthly price | Seats | Standard pages | SEO audits | AI review cycles |
  | ------- | ---------------------- | ----- | -------------- | ---------- | ---------------- |
  | STARTER | $500                   | 2     | 5              | Weekly     | 2/month          |
  | GROWTH  | $1,000                 | 5     | 10             | Daily      | 8/month          |
  | PRO     | $1,500                 | 10    | 20             | Daily      | 16/month         |
  | ELITE   | $2,000                 | 20    | 30             | Daily      | 30/month         |

  ORAP controls versioned plan settings and per-site overrides. Technical safeguards and
  protected-fact rules are identical across plans. Prices require final commercial
  approval; setup fees, bespoke work, and overage handling remain pending.

- OpenAI uses a dedicated owner-controlled `OmniReach Production` API project. The existing $5 USD per-site UTC
  calendar-month hard cap remains, plus an initial $50 USD platform-wide hard cap on the
  same reset boundary. Authorized ORAP roles may edit either cap with actor, old/new
  value, reason, and effective time recorded in the audit history. One atomic internal
  ledger enforces both caps. Models require cost/quality testing, and paid production
  calls remain disabled until explicit owner authorization.

  The initial configurable aliases are `content-review-balanced` → `gpt-6.1-sol` and
  `content-review-economy` → `gpt-6-luna`. The balanced alias is selected initially, but
  `OPENAI_PROVIDER_ENABLED=false` remains the activation control until cost/quality tests
  pass and paid calls are explicitly authorized.

- Google OAuth is configured and the owner reported completing the intended Search
  Console and GA4 connections on 2026-10-13. A successful connection enables one
  site-scoped `metrics_sync` schedule, admits the first run immediately, and then runs
  daily at 04:00 UTC with up to 30 minutes of deterministic per-site jitter. The last
  disconnect disables that site's schedule. Jobs remain concurrency-one, use opaque
  queue envelopes, rehydrate tenant/site scope under the worker role, and never affect
  static-site availability. First-sync evidence and live source-console comparison
  remain required before treating the reporting data as production-verified.

These directions do not authorize provider connection, credential creation, email,
deployment, data deletion, or any other external mutation. Remaining concrete values are
tracked in [`production-inputs.md`](production-inputs.md).

The owner subsequently authorized G31 prerequisite and activation work on 2026-10-11.
G30's pre-production gate is complete. Execution remains constrained by a named
maintenance window, exact prechecks and rollback evidence, scoped credential
availability, and the separate per-change DNS approval rule. It does not authorize paid
upgrades, real-customer onboarding, or root/password SSH hardening.

Contact forms must remain unavailable for sale until G13 implementation/security tests
and the authorized G30/G31 production gates are complete. Do not expose competitor monitoring,
reputation management, Google Business Profile automation, social publishing, AI answer
sampling, conversion experiments, automated content expansion, payment automation, or
advanced transactional websites as plan entitlements. Internal experiments or deferred
roadmap ideas are not customer promises.

## 5. Release workflow

### 5.1 Foundation (G19)

- GitHub Actions builds/tests the exact commit and emits a checksummed immutable artifact.
- A reusable deployment workflow and restricted target scripts are tested only against an isolated SSH target.
- At G19 completion, that reusable workflow was not bound to a production host or push
  trigger. The repository now also contains `deploy-production.yml`, a `main`-push
  wrapper referencing the protected `production` environment, as partial G31
  preparation. Its presence does not prove external environment protection, credentials,
  target permissions, approval, deployment, or rollback evidence.

### 5.2 Production activation (G31)

The repository now contains an inert production Compose, secret-bootstrap, migration,
and runtime contract. Its first-deployment, credential-rotation, datastore-backup, and
isolated-recovery procedures are documented in
[`production-compose.md`](production-compose.md). Local verification does not satisfy the
G31 production mutation, real-backup, Caddy, DNS, or existing-service non-regression
gates. G31 is blocked while G05/G06 and the applicable R-005/R-008/R-010 evidence remain
incomplete; running its repository-only goal verifier does not change that status.

Preconditions:

- G30 release gate signed off.
- G05 and the reopened G06 Auth Contract v2 revalidation signed off. Current local
  foundations do not satisfy this production precondition.
- R-001 through R-005, R-008, and R-010 supplied as applicable.
- Current read-only inventory reviewed for drift and headroom.
- Latest backup/off-server copy verified and rollback target healthy.
- Protected `main`, required reviews/checks, production environment approvers, scoped non-root SSH identity, and host key verified.
- Caddy fragment validates; exact prior config/release pointers recorded.
- The exact Caddy-to-API peer CIDR and every trusted upstream proxy CIDR are recorded in
  `TRUSTED_PROXY_CIDRS`. If Cloudflare proxying is active, Caddy accepts forwarding data
  only from verified Cloudflare ranges. Empty, broad-private, or guessed proxy trust
  configuration blocks authentication activation.
- The candidate and rollback artifacts explicitly declare Auth Contract v2
  compatibility. The compatibility cutoff is recorded, and the preflight rejects a
  missing/older contract after the v2 schema or state exists.
- The implemented versioned MFA encryption-key keyring and re-encryption/retirement
  procedure have passed an isolated production-equivalent drill. Repository unit tests
  alone are insufficient; activation stays blocked until the old/new login, forced
  reauthentication, rollback, and restore evidence is attached to the change record.
- `admin.omnireach.cloud` (or the configured canonical ORAP hostname) is reserved and
  absent from all customer-domain mappings.

Sequence:

1. Resolve and record exact commit SHA, workflow run, artifact hash, release ID, actor, and change scope.
2. Acquire deployment lock; reject or queue overlap.
3. Verify SHA/ancestry, checksums, manifest, target paths, migration compatibility, and
   Auth Contract v2 compatibility for both the candidate and rollback artifact. Fail
   closed if either target is incompatible after the cutoff.
4. Stage to a new versioned release path; do not edit the active checkout/path.
5. Run service and static artifact health checks before switching.
6. Validate the additive Caddy fragment in the actual supported configuration context.
7. Apply forward-compatible migrations under the approved backup/compatibility plan.
8. Atomically switch the release and minimally reload/import Caddy as reviewed.
9. Check ORAP/API/customer-admin/static pages, TLS/headers, Postgres/Redis privacy,
   queue/worker health, backup/alert state, unknown-host rejection, distinct external
   client-network limiter buckets, and rejection of forged forwarding headers from an
   untrusted peer. Verify the canonical ORAP hostname cannot resolve as a customer host
   and stale credential/policy/membership/domain/factor state cannot issue a session.
10. Check every inventoried Christians Reunite service and existing route.
11. Record success or execute rollback; release lock only after terminal state.

Branch/PR workflows never deploy. Production does not run `git add`, commit, push, force-pull, or author content.

## 6. Rollback

Rollback triggers include failed build verification, migration compatibility, service readiness, HTTP/content/headers, Caddy validation/reload, existing-workload health, or post-switch monitoring.

1. Stop new publishes/deploys at the narrowest scope.
2. Keep the deployment lock.
3. Restore the exact prior release/artifact pointer only if it declares compatibility
   with the active Auth Contract v2 cutoff. If it does not, keep authentication traffic
   closed and use a compatible forward fix or restore; never start the pre-v2 artifact.
4. Restore the prior validated Caddy config/import if it changed.
5. Restart/reload only explicitly named OmniReach/Caddy targets under the reviewed procedure.
6. Re-run platform, public-site, and Christians Reunite checks.
7. Do not destructively reverse a database migration. Use forward recovery; restore a backup only under the recovery procedure.
8. Preserve event/log evidence with redaction and open a deduplicated alert.

Content rollback creates a new content revision and artifact; it never erases history.

## 7. Backup and recovery

Approved policy:

- Daily encrypted PostgreSQL, content/media, and artifact-manifest backup.
- Retain 3 daily and 1 weekly recovery point.
- Maintain an encrypted off-server copy. Cloudflare R2 is the selected production target
  under a $5 monthly ceiling with conservative free-tier controls; use least-privilege credentials and keep them
  separate from encryption keys.
- Verify archive/checksum/completeness daily.
- Perform a full isolated restore monthly.

Every backup records start/end, schema/release version, scope, checksum, encrypted size, destination status, and error. Pruning operates only on explicit backup manifests and never uses broad Docker/filesystem cleanup.

Scheduled backup, applied retention, and database restore-drill commands provide the
restricted status connection through `--record-database-url-file`; a literal database
URL is forbidden. The recorder assumes `omnireach_worker`, uses the envelope checksum
as an idempotency key, and updates `backup_records` only after the corresponding action
succeeds. ORAP reads bounded status fields from those records and never exposes storage
references, manifests, checksums, credentials, archive contents, or customer filenames.
The persisted status manifest contains only format version, file count, and source-byte
total. An empty status panel means no repository-verifiable production evidence exists,
not that backups are healthy.

Backup/integrity/off-site failures use a narrowly granted database function to upsert a
single deduplicated platform alert with a fixed safe error class; recorded success
resolves it. Raw subprocess/provider messages are not stored in ORAP. This does not
activate email: critical-email transport remains governed by the alert-provider feature
flag and production sender/recipient approval.

Repository tooling bounds source/encrypted/decompressed bytes, member count, R2 requests,
listing pages, response bytes, and listed objects. Remote responses are byte-counted while
streaming even without `Content-Length`. A limit failure means the backup is incomplete and pruning
must stop; inputs must never be silently skipped. Applied pruning writes requested and
completed JSONL audit events. Manual pruning requires the owner's authorization
reference; authorization-free automatic pruning is hard-bound to 3 daily and 1 weekly
recovery points. Active and held points are preserved in addition to those counts.
Local and off-site deletion timestamps remain distinct, and a recovery point is marked
pruned only when all recorded copies are gone.

Disposable database restore accepts its connection URL only through a permission-
restricted file. In production mode it fails closed until filesystem roots and
non-secret `host:port/database` production identities are configured, then rejects any
overlapping target before `pg_restore --exit-on-error` runs.

Monthly restore proof uses a new isolated database/storage namespace and verifies schema, row/reference counts, tenant boundaries, media links, one previously published artifact, and application compatibility. Production restoration requires declared incident scope, owner authorization, key custody, a fresh preservation backup where safe, and post-restore security/health checks.

R-005 completed initial production activation on 2026-10-14. The scheduled-path backup
created and independently verified a 155,720-byte encrypted R2 recovery point. A separate
download restored into an isolated tmpfs PostgreSQL 16 database, verified 1 tenant, 1
site, and 86 RLS policies, and measured 2.989 seconds for the restore operation. Both
systemd timers are enabled; the deduplicated failure alert resolved after success. The
24-hour RPO and 8-hour RTO objectives remain continuously monitored operational targets.
Manual deletion always requires the owner's authorization and an audit record.

## 8. Monitoring and alerts

Minimum signals:

- Public site content/status, API/admin liveness/readiness.
- DNS/TLS readiness and expiry.
- Queue depth/age, stalled jobs, retries/failure rates, scheduler lease.
- OpenAI/provider errors, reservations, usage, hard-cap exhaustion.
- Build/deploy/rollback events.
- Database connectivity, disk/inodes, memory/swap/CPU, restarts, log growth.
- Backup/off-server copy and monthly restore-test status.
- Google OAuth expiry/revocation and data freshness.
- Contact-form delivery failure/abuse thresholds without logging message bodies.

Alerts have fingerprint, severity, scope, first/last observed, count, owner, acknowledgment, remediation link, and resolution. ORAP is authoritative; policy-defined urgent errors also use the email adapter after R-008. Duplicate symptoms update one alert rather than flood recipients.

PostgreSQL is also authoritative for schedules and job state. The scheduler acquires a
database lease, atomically admits due work with an intended-window dedupe key, advances
the timezone-local occurrence, and claims undispatched queued rows before writing only
opaque envelopes to BullMQ. Failed dispatch claims are released for retry. ORAP job
cancellation is limited to queued work; replay is limited to cancelled, failed, or
skipped work and creates a new audited queued record for the durable dispatcher.

AI proposal admission is disabled unless `OPENAI_PROVIDER_ENABLED=true`. While disabled,
the customer endpoint returns `503 ai_provider_disabled` before creating durable work,
and the dedicated worker cancels any pre-existing envelope before database, quota,
budget, or provider access. When explicitly activated, request content and evidence are
stored only in tenant-scoped PostgreSQL material; BullMQ receives bounded identifiers.
The worker revalidates entitlement, field mode, protected status, emergency controls,
policy version, source hash, expiry, model alias/price, review-cycle quota, and both hard
budget caps before a provider call. Results remain reviewable proposals and never
publish directly. Disable the provider flag or site automation control to stop new
calls; public static sites remain independent. Never log provider prompts, API keys,
protected facts, or raw provider errors.

Critical-email delivery retries at most three times with exponential backoff. The
durable alert center, not the provider transport, owns these retries so every
attempt and terminal failure updates the deduplicated ORAP incident without exposing
message secrets. Quota exhaustion, provider outage, or terminal email failure cannot
change public-site availability and must not create a new alert loop. The production
recipient, verified sender/domain, and activation remain pending.

Production email paths are fail-closed and disabled by default. Contact delivery uses
`CONTACT_DELIVERY_ENABLED`; invitation/password recovery uses
`AUTH_EMAIL_DELIVERY_ENABLED`; urgent alerts use `ALERT_EMAIL_DELIVERY_ENABLED`. Enabling
a path requires `RESEND_API_KEY` plus its verified sender/recipient configuration.
Installing a credential alone never enables any path. Contact delivery additionally
requires both Cloudflare Turnstile keys at process startup; missing abuse-control
configuration rejects activation rather than exposing an unprotected form.

All enabled Resend channels share one PostgreSQL-authoritative UTC calendar-month
admission policy. The initial no-spend limit is 3,000 messages across urgent alerts,
authentication, contact, and platform-inquiry channels. A restricted application or
worker transaction calls security-definer reserve/finalize functions; the runtime login
cannot read the underlying policy, period, or reservation tables directly. Admission
locks the singleton policy/period, releases expired 15-minute reservations, and rejects
when sent plus active reservations reaches the cap. Failed/released reservations do not
consume sent capacity. Records contain only channel, lifecycle timestamps, a provider
reference, and an allowlisted safe error code—never a recipient, subject, body,
verification code, form payload, API key, or provider response.

The reservation UUID is sent as Resend's `Idempotency-Key`. Contact delivery performs
one initial attempt plus at most three retries for network, throttling, and provider 5xx
failures, with bounded exponential backoff. Client/provider 4xx failures are terminal.
Optional confirmation delivery is admitted and recorded separately. ORAP Operations
shows only nonsecret activation/configuration state, the current limit and counters,
channel status, latest attempt time, and allowlisted failure class. Quota exhaustion,
provider failure, or ORAP status-query failure must not reduce static website
availability.

Authentication emails use the database-resolved exact customer admin hostname and
time-limited one-time tokens; request URLs are redacted from application logs.
Password-recovery delivery is queued in the restricted PostgreSQL outbox before the
provider is called, but recovery-token issuance and encrypted outbox enqueue currently
commit as two consecutive, non-atomic transactions. A process/database failure between
them can leave a valid token with no delivery row until expiry. The caller still receives
the generic response; do not reveal whether this occurred. A retry safely issues a new
token and invalidates/replaces the earlier one. Token issuance serializes on the
identity and rechecks exact-host customer eligibility after taking that lock, so
simultaneous requests leave only the newest token active. The API processor uses
expiring leases, retries at most three times with exponential backoff, and stores only
fixed non-secret failure codes. The encrypted delivery token is erased on success,
token use/expiry, or terminal failure. Inspect outbox status and error codes, never
ciphertext or provider request bodies, when diagnosing delivery. Terminal urgent-email
failure is recorded against the incident and never propagates into public website
availability.

Authentication transactions retry PostgreSQL deadlock (`40P01`) and serialization
(`40001`) failures at most three times as complete transactions. Customer recovery-code
claims also serialize on the account identity before locking the active code set and
authentication policy. If retries are exhausted, the request fails closed: no recovery
code consumption, sibling revocation, or session insertion is committed. Investigate
repeated exhaustion as a database-contention incident without logging credentials,
codes, tokens, or query parameter values.

Durable authentication events cover login success/failure, MFA verification, email-code
policy, TOTP policy, WebAuthn enroll/rename/revoke, explicit session revocation/logout,
and MFA-key rotation batches. Provider delivery/outbox state remains the source for
message delivery attempts. Generic HTTP logs are never equivalent audit evidence and
must not contain codes, tokens, passwords, WebAuthn assertions or request URLs.

## 9. Emergency procedures

### 9.1 Freeze automation/publishing

Use the platform/site emergency controls to stop new automation and publishing while leaving healthy public artifacts active. Drain or safely retry running jobs; do not delete queue history.

### 9.2 Suspected credential compromise

Disable the affected integration/deploy path, revoke and rotate the credential through its provider, revoke affected sessions, verify logs for misuse, and update credential references. Never paste the compromised value into Git, chat, tickets, or logs.

### 9.3 Cross-tenant or content-safety incident

Disable the affected endpoint/automation, preserve trace/audit evidence, confirm RLS and cache scope, restore a safe artifact/content revision if needed, assess exposure, and follow R-006 notification policy.

### 9.4 Existing-service degradation

Abort OmniReach work, restore prior release/Caddy state, stop only named OmniReach services if necessary, and verify Christians Reunite. Never use broad Docker cleanup or recursive deletion.

### 9.5 Google collection outage

Keep `GOOGLE_INTEGRATION_ENABLED=false` when configuration is incomplete. On quota or
provider failure, retain the prior snapshots, expose delayed/stale status, allow bounded
job retry, and keep public serving and non-Google reports available. A revoked/expired
credential requires new customer consent; never silently substitute another property.

### 9.6 AI over-budget or unsafe output

Leave the provider gate off or use the narrow emergency control. Release reservations
for failed calls, preserve sanitized evaluation/audit evidence, reject the proposal and
never create publication work. Static serving and human content workflows stay active.

### 9.7 Backup freshness or restore failure

Stop pruning, preserve every available recovery point, alert on the exact failed stage,
and retry only after the destination/key/network cause is understood. Never redirect a
restore to an active production database or storage root. Use `docs/offsite-backup.md`.

### 9.8 Domain/TLS failure

Do not accept host-header workarounds. Verify authoritative DNS, proxy target, certificate
and exact domain ownership; keep the last known-good Caddy configuration and artifact.
Roll back only the named route/configuration if an additive change caused the failure.

## 10. Retention defaults

- Operational logs: 30 days.
- Detailed job records: 90 days.
- Audit records: 12 months.
- Content revisions: per site/legal policy; no silent pruning.
- Backups: 3 daily and 1 weekly recovery point.

Retention is configurable and respects active incidents, legal/site holds, customer deletion obligations, and R-006. Changes are audited. Destructive retention remains disabled until the corresponding policy and exact target are verified.

## 11. Human review points

Human approval is mandatory for production credentials, external account connection,
domain purchase/DNS mutation, Caddy reload, first migration, production activation,
destructive schema/data changes, backup key/provider changes, MFA key
rotation/retirement, customer/legal policy, contact-form destination,
plan/pricing/grace policy, and real pilot onboarding.

Internal ORAP employee provisioning and staff-authority changes require a currently
authenticated Platform Owner who completed the mandatory ORAP two-step login. They do
not require an additional authenticator/passkey step-up. Platform Admin or a custom
employee role cannot approve or perform these actions. Every change retains automatic
audit evidence, last-owner protection, and session invalidation. The staff UI does not
ask the Owner to enter an audit reason. SMS step-up may be added later only through a
separately approved authentication-policy change. Repository
implementation and fictional tests do not authorize creating a real employee or
changing a production owner's authority.

For an owner-assisted ORAP account recovery, open the target in **Team & access**, edit
only the required profile fields, optionally enter a replacement password twice, and
save the change. The replacement password is write-only: never ask for or record the old
password. Saving revokes all target ORAP sessions, clears password lockout state,
invalidates outstanding password-recovery links, preserves mandatory two-step
verification, and appends a non-secret before/after audit with an automatic action
description. Confirm the target
can complete the next login before treating recovery as finished. Do not use this path
to expose hashes, bypass verification, rewrite audit history, or weaken last-owner
protection.

## 12. Completion evidence by goal

Each goal report includes files changed, migration/environment changes, commands/tests, manual review, observability/rollback behavior, known risks, and next unblocked goal. A live claim requires direct evidence; scaffolding, a dry run, or an unexecuted runbook is not production proof.

### 3.1 Branch CI and repository settings

`.github/workflows/ci.yml` runs on pull requests and pushes to every branch. It installs only the lockfile, validates workflow policy, formatting, lint, types, unit tests, builds, repository secret/path policy, and the production dependency audit. Third-party actions are pinned to immutable commit SHAs and the workflow token has only `contents: read`. The workflow has no environment, SSH, deployment, or production-secret path.

The repository owner must configure these GitHub settings before treating remote enforcement as active:

1. Copy `.github/CODEOWNERS.example` to `.github/CODEOWNERS` with real GitHub handles; never commit the placeholder handle.
2. Protect `main`, require pull requests and the `Validate repository` check, dismiss stale approvals, require conversation resolution, block force pushes/deletion, and require the branch to be current before merge.
3. Require a CODEOWNERS approval for authentication, tenant authorization, AI policy, infrastructure, security/operations documents, and workflow changes.
4. Enable GitHub secret scanning/push protection and Dependabot security updates if the repository plan supports them.

These remote settings require repository-admin action and are intentionally not claimed as completed by local G03. CI failures are triaged by the change owner: secret findings are treated as potential incidents and rotated outside Git; high/critical production dependency findings block merge unless an owner-approved, time-bounded exception is documented. Branches other than `main` may run CI but cannot deploy.
