# Production Input and Authorization Worksheet

Use this worksheet to close the human-controlled gates for G18, G30, G31, and G32.
Record references or custodians, never secret values. A checked item means the owner
has supplied the decision and the named approver has authorized its use.

| Gate  | Required owner input                                                                      | Nonsecret record/reference                                                                                                                                                                                                                                                                                                                                                                                                      | Approved by/date                                   |
| ----- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| R-001 | ORAP domain, DNS zone, canonical hostname                                                 | Complete: base domain and DNS zone `omnireach.cloud`; canonical ORAP host `admin.omnireach.cloud`                                                                                                                                                                                                                                                                                                                               | Owner, 2026-10-10                                  |
| R-002 | Owner identity, auth policy, recovery custodian, break-glass approver, credential channel | Complete: `rhajj@omnireach.cloud`; mandatory ORAP two-step may use five-minute email codes, TOTP, or WebAuthn; owner is initial recovery-code custodian and sole break-glass approver; approved credential policy recorded                                                                                                                                                                                                      | Owner, 2026-10-11                                  |
| R-003 | Read-only VPS/Caddy/Christians Reunite inventory access                                   | Complete: sanitized 2026-10-11 evidence reviewed and recorded in `infrastructure-inventory.md`; no mutation performed                                                                                                                                                                                                                                                                                                           | Owner, 2026-10-10                                  |
| R-004 | Cloudflare zone/domain scope and token custodian                                          | Complete: owner controls `omnireach.cloud`; the host-only token/account pair resolved exactly one active matching zone in a read-only 2026-10-11 check. No identifier value was logged. The DNS adapter repeats this fail-closed lookup; each concrete DNS mutation remains separately approved.                                                                                                                                | Owner, 2026-10-11                                  |
| R-005 | Off-server backup provider, key custodian, budget, deletion authority                     | Activation authorized: private Standard-class R2 bucket `omnireach-production-backups` and its bucket-scoped credential were created and transport-probed on 2026-10-13. On 2026-10-14 the owner approved daily scheduling, 3-daily/1-weekly automated retention, a real isolated restore drill, failure alerts, and conservative free-tier controls. Completion remains evidence-based.                                        | Owner, 2026-10-14                                  |
| R-006 | Jurisdictions and approved privacy/consent/terms/retention policies                       | Partial: initially operate in Texas, USA; privacy, cookie-consent, terms, and deletion policies require owner review before launch; exact approved texts remain pending                                                                                                                                                                                                                                                         | Owner, 2026-10-10                                  |
| R-007 | Google OAuth project, redirects, properties, permissions                                  | Partial: owner supplied the existing client credentials, approved `https://admin.omnireach.cloud/v1/orap/integrations/google/callback`, reported the intended Search Console/GA4 connections completed, and authorized the bounded metrics worker on 2026-10-13. First-sync evidence, exact live-source comparison, and provider consent-screen confirmation remain TODO.                                                       | Owner, 2026-10-13                                  |
| R-008 | Alert/auth-email provider, senders, recipients, escalation, spend                         | Repository-ready, production inactive: Resend free plan, `updates.omnireach.cloud`, alert sender `alerts@updates.omnireach.cloud`, auth sender `auth@updates.omnireach.cloud`, testing recipient `rhajj@omnireach.cloud`, $0 budget, 3 alert retries, dedupe, atomic 3,000-message monthly cap, and safe ORAP status; verification, setup, credentials, current limits, recipient reconfirmation, and activation remain pending | Owner, 2026-10-11                                  |
| R-009 | Contact delivery, recipients, abuse/attachment/retention/consent policy                   | Repository-ready, production inactive: optional centralized forms use Resend sender `forms@updates.omnireach.cloud`, verified site recipients, 30-day retention except legal/security holds, Turnstile, honeypots, rate limits, explicit activation, bounded retry, and the shared email cap; recipient/provider/DNS setup, credentials, activation, and legal wording remain pending                                           | Owner, 2026-10-11                                  |
| R-010 | GitHub approvers, VPS deploy identity, host key, key custodian                            | Complete for this release: `omnireach-deploy`, deploy key, verified host key, protected GitHub `production` environment and main-only workflow are configured. Owner gave full Phase 3–6 production authorization and confirmed temporary root access on 2026-10-13.                                                                                                                                                            | Owner, 2026-10-13                                  |
| R-011 | Plans, prices, seats, exact nonpayment grace period                                       | TODO: draft tiers and effective ORAP plan/subscription/override/grace controls are implemented. Final prices, setup/bespoke fees, quota definitions, overages, collection, cancellation and commercial approval remain TODO.                                                                                                                                                                                                    | Owner, 2026-10-13                                  |
| R-012 | OpenAI project, key custodian, production spend authority/limit                           | Partial: owner selected `content-review-balanced` (`gpt-6.1-sol`) and authorized a $5/site/month hard ceiling on 2026-10-13. The durable handler/material path, dated price record and synthetic benchmark are implemented locally. The provider gate remains off pending a representative paid-provider benchmark, explicit activation, and production smoke evidence; the $50 platform ceiling remains.                       | Owner, 2026-10-13; repository evidence, 2026-10-14 |
| R-013 | Availability, maintenance, RPO, RTO, escalation objectives                                | 99.5% monthly; Sun 02:00–04:00 America/Chicago; RPO 24h; RTO 8h; critical ack 30m; noncritical ack 24h; ~10 sites on 2-core/8 GB                                                                                                                                                                                                                                                                                                | Owner, 2026-10-10                                  |

R-003 authorized read-only inventory only. The sanitized output has been reviewed and
recorded, so this input is complete. It does not authorize deployment, service control,
DNS changes, configuration writes, SSH hardening, or copying secret material.

R-004 approves use of a least-privilege Cloudflare token for the named zone. The owner
has placed a token and account ID in the ignored host-only environment file; their values
were not copied into documentation or logs. DNS record operations still require a zone
ID internally. OmniReach will discover it with Zone Read using the exact canonical zone
name, verify that it belongs to the configured account, and fail closed on zero or
multiple matches. A read-only validation on 2026-10-11 returned exactly one active match.
No zone/account identifiers or token values were printed or persisted in documentation.
Each DNS change still requires separate explicit owner authorization.

The same read-only check found that the proxied apex A record's configured origin does
not match the address used for the authorized `srv1789012` inventory and SSH session.
The owner must identify the current intended VPS origin before the G31 SSH target or any
DNS plan is approved. No address value is copied into this public worksheet.

R-002 credential policy uses protected GitHub Actions environment secrets only for
approved CI/CD credentials. Production runtime credentials use permission-restricted,
host-only environment files or Docker/Compose secret mounts. Credential values must
never enter chat, Git, images, artifacts, or logs. The owner personally retains MFA
recovery codes in encrypted storage. Bitwarden may be introduced later before employee
credential sharing; it is not a V1 prerequisite while the owner is the sole custodian.
The owner is also the sole initial break-glass approver. This single-person dependency
must be reviewed before staff access or shared operational responsibility is introduced.

On 2026-10-11 the owner approved an account-level authentication policy revision.
Platform Owner, Platform Admin, and Staff accounts retain mandatory two-step
verification, but the routine second step may be a Resend-delivered email code that
expires after five minutes, is single-use, stored only as a hash, and protected by
strict attempt and resend limits. TOTP remains supported and WebAuthn/FIDO2 is an
optional stronger method. Sensitive owner recovery and security changes require a
recent TOTP/WebAuthn verification or the owner's explicitly approved, short-lived,
single-use, audited break-glass procedure; email or an ordinary recovery-code session
alone is insufficient. Customer accounts remain password-only by default and may opt
into email, TOTP, or WebAuthn through account security settings. This approval changes
architecture requirements only: it does not state that the revised flows are coded,
authorize Resend activation, or permit any MFA bypass.

R-005 originally allowed a development-stage plan for daily compressed encrypted backups under
`/opt/backups/omnireach/` covering PostgreSQL, editable website content, uploaded media,
and important platform configuration while excluding caches and regenerable artifacts.
That local-only arrangement is superseded for production activation. Validate archive
integrity automatically, retain 3 daily and 1 weekly recovery point subject to explicit
capacity checks, and support a monthly isolated restoration test.
The owner may download an encrypted backup to a personal computer weekly using SFTP or
SCP and verify its checksum. This manual weekly copy does not satisfy the approved
24-hour production RPO or D-016 off-server requirement. The owner authorized backup
installation, scheduling, host directory creation, policy-bound pruning, R2 transfer,
and an isolated restore drill on 2026-10-14.
The owner is the sole encryption-key custodian and the only person who may authorize a
manual backup deletion; every manual deletion must be logged. Automated deletion is
authorized only when enforcing the production 3-daily/1-weekly policy; any other
deletion requires logged owner approval.
Capacity pressure must alert and pause safely rather than trigger unauthorized pruning.

R-005 selects Cloudflare R2 as the automated encrypted off-server destination with a
$5 monthly storage budget. Production backups cover
PostgreSQL, editable content, uploaded media, and necessary configuration; run daily,
retain 3 daily and 1 weekly recovery point, validate integrity daily, and undergo a
monthly isolated restoration test. Encryption keys stay separate from least-privilege R2
credentials. Manual deletion still requires owner authorization and an audit record.
The owner authorized provider configuration on 2026-10-13. The dedicated private
Standard-class bucket `omnireach-production-backups` and an account-owned credential
limited to object operations in that bucket were then created through Cloudflare's API.
The credential passed an upload, download-integrity, list, and cleanup probe against the
`omnireach/` prefix without logging secret values. Public `r2.dev` access is disabled;
the bucket has no custom domains or CORS rules. Credential material is held only in the
ignored local environment pending protected VPS installation, and off-site mode remains
disabled. R-005 remains incomplete until a separately held encryption key, scheduled
automated transfer, 3-daily/1-weekly retention, alerting, cost evidence, and a timed real
restore meet the 24-hour RPO and 8-hour RTO targets.

In this record, “owner” means the human OmniReach owner, never Codex or another automated
agent. The owner supplied full production-release and named provider-configuration
authorization on 2026-10-13. Secret values remain host-only and must never be copied into
Git, documentation, artifacts, or logs. Items explicitly marked TODO remain outside the
current release authorization until their named evidence exists.

R-008 remains inactive, not provider activation. Repository code now enforces independent
disabled-by-default channel flags, a shared atomic 3,000-message UTC monthly cap, safe
quota diagnostics, provider idempotency keys, and restricted app/worker function access
without direct runtime table reads. The free-plan assumption must be checked
again before activation and operation must stay within both monthly and daily provider
limits; paid plans and overages remain disabled at the approved $0 budget. If quota or
delivery fails, ORAP remains authoritative and customer websites remain available. The
owner confirmed `alerts@updates.omnireach.cloud` as the exact sender address.
Invitation and password-recovery delivery is implemented behind
`AUTH_EMAIL_DELIVERY_ENABLED=false`; the owner selected
`auth@updates.omnireach.cloud` as its sender. The owner approved
`rhajj@omnireach.cloud` as the testing alert recipient, but the final production
recipient must be reconfirmed before activation. Domain/sender verification, provider
setup, credentials, and all three delivery flags remain pending. Private values use the
approved secret/configuration channel and never enter Git or logs.

The same disabled authentication adapter is the planned delivery path for routine ORAP
and opt-in customer email verification codes. These codes are authentication material,
not operational alerts: they receive no delivery retry that could bypass resend limits,
and their plaintext must not enter Redis/database storage, application/provider-response
logs, audit records, chat, or Git. Resend necessarily processes message plaintext during
delivery, so email remains a weaker, non-phishing-resistant method. No provider account,
sender verification, credential, DNS change, or production authentication email is
authorized by this record.

R-009 defines contact forms as optional reusable site components backed by one
centralized tenant-scoped submission, abuse-control, delivery, and retention system.
ORAP administrators can enable or disable forms per website. Authorized customer roles
can configure only supported fields and view only their own site's submissions.
Confirmation emails are optional and disabled by default. Production protection uses
Cloudflare Turnstile, honeypots, and rate limits. The selected sender is
`forms@updates.omnireach.cloud`. Verified customer recipients, sender-domain/provider
setup, credentials, explicit production activation, and legally approved consent wording
remain pending. Installing a Resend credential does not activate forms or platform
inquiries; the explicit contact flag and both Turnstile keys are required.

R-010 fixes the repository at `OmniReach-Websites/SEO-Automation` and the owner as both
production approver and deploy-key custodian. Only a verified push to protected `main`
may automatically deploy. The `omnireach-deploy` account must have narrowly scoped
release permissions, never unrestricted sudo or Docker-daemon access. Root/password SSH
hardening is deferred until non-root deployment and emergency recovery are tested.
On 2026-10-11 the owner explicitly authorized G31 prerequisite and activation work,
including the restricted deploy identity, scoped SSH/GitHub setup, isolated service
installation, forward migrations, backup/provider setup, and the reviewed additive
Caddy change. On 2026-10-13 the owner superseded the earlier proposed window with full
authorization to complete this release using the supplied temporary root access and
existing restricted deployment path. Execution still requires exact prechecks, rollback
evidence, credential custody, and the earlier rule that each concrete DNS change receives
separate explicit approval. It does not authorize an unlisted paid service, a new real
customer, or SSH hardening. Releases remain
immutable, locked, health-checked, and automatically reversible. Unfinished or failed
work rolls back rather than silently extending past the approved window.

A dedicated local operator key was generated on 2026-10-11 with public-key fingerprint
`SHA256:0kOFS3f60703KDfrnGOVyakqUgPH62gV6eSeXgApGzg`. Its private half remains in the
owner's local SSH directory and must never enter chat, Git, the VPS, or GitHub Actions.
The key has not yet been installed on the VPS. This operator identity is separate from
the future GitHub Actions deploy key and does not alter the least-privilege
`omnireach-deploy` policy.

R-012 requires a dedicated `OmniReach Production` OpenAI API project, configurable model
selection after documented cost/quality testing, and one atomic internal spending ledger
that admits a call only when both its site's $5 and the platform's $50 UTC calendar-month
hard caps have capacity. The owner retains key custody and spending authority. The
initial application alias `content-review-balanced` maps to `gpt-6.1-sol`, while
`content-review-economy` maps to `gpt-6-luna`. These are configurable benchmark
candidates, not permanent promises. On 2026-10-13 the owner selected the balanced alias
and authorized a $5/site/month limit. `OPENAI_PROVIDER_ENABLED=false` still keeps paid
calls disabled until the missing production job-material handler, dated price record,
representative benchmark, and smoke evidence are complete.

R-007 is authorized for configuration using the existing host-only client credentials
and the exact callback `https://admin.omnireach.cloud/v1/orap/integrations/google/callback`.
Only explicitly customer-authorized Search Console/GA4 properties may be connected.
Consent-screen confirmation and live source-console comparison remain TODO and do not
block the core release.

R-011 replaces the former three-tier model with four proposed tiers:

| Tier    | Monthly price | Customer seats | Standard pages | SEO audits | AI content-review cycles |
| ------- | ------------- | -------------- | -------------- | ---------- | ------------------------ |
| STARTER | $500          | 2              | 5              | Weekly     | 2/month                  |
| GROWTH  | $1,000        | 5              | 10             | Daily      | 8/month                  |
| PRO     | $1,500        | 10             | 20             | Daily      | 16/month                 |
| ELITE   | $2,000        | 20             | 30             | Daily      | 30/month                 |

Each subscription belongs to one website and includes one primary website and one
business location by default. All quotas and entitlements remain configurable through
owner-controlled ORAP plan definitions and site overrides, but no override may weaken
tenant isolation, protected-fact restrictions, or other technical safeguards. The
14-day nonpayment grace period remains. The $5 per-site and $50 platform-wide OpenAI
budgets remain separate hard spending controls; an AI-cycle entitlement never authorizes
spend beyond them.

The tier prices are a selected proposal, not final commercial approval. Setup fees,
bespoke development pricing, overage policy, and final launch approval remain pending.
Contact forms are not saleable until their implementation, security testing, and
production deployment are complete. Competitor monitoring, reputation management,
Google Business Profile automation, social publishing, AI answer sampling, conversion
experiments, automated content expansion, payment automation, and advanced transactional
websites are not tier entitlements.

R-013 also confirms ORAP plus email for critical notifications, daily encrypted backups
with 3 daily and 1 weekly recovery point and an off-server copy, and owner-approved
infrastructure expansion when measured capacity requires it. Expansion is not presently
authorized and no external purchase is implied.

## Mutation authorization

The owner granted authorization on 2026-10-11 to progress G31 preparation and its named
production mutations after their roadmap prerequisites pass. Execution still requires a
named maintenance window, an exact reviewed change set, precheck evidence, credential
availability through the approved channels, and an explicit rollback owner. Cloudflare
DNS changes retain their separate per-change authorization gate, and pilot launch remains
G32 work requiring separate approval. Record the change reference, approver, window,
prechecks, and rollback evidence outside this public repository if it contains private
infrastructure details.
