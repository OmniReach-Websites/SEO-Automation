# Production Input and Authorization Worksheet

Use this worksheet to close the human-controlled gates for G18, G30, G31, and G32.
Record references or custodians, never secret values. A checked item means the owner
has supplied the decision and the named approver has authorized its use.

| Gate  | Required owner input                                                         | Nonsecret record/reference                                                                                                                                                                                                                                                                                                                                            | Approved by/date  |
| ----- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| R-001 | ORAP domain, DNS zone, canonical hostname                                    | Complete: base domain and DNS zone `omnireach.cloud`; canonical ORAP host `admin.omnireach.cloud`                                                                                                                                                                                                                                                                     | Owner, 2026-10-10 |
| R-002 | Owner identity, recovery custodian, break-glass approver, credential channel | Complete: `rhajj@omnireach.cloud`; owner is initial recovery-code custodian and sole break-glass approver; approved credential policy recorded                                                                                                                                                                                                                        | Owner, 2026-10-10 |
| R-003 | Read-only VPS/Caddy/Christians Reunite inventory access                      | Complete: sanitized 2026-10-11 evidence reviewed and recorded in `infrastructure-inventory.md`; no mutation performed                                                                                                                                                                                                                                                 | Owner, 2026-10-10 |
| R-004 | Cloudflare zone/domain scope and token custodian                             | Complete: owner controls `omnireach.cloud`; the host-only token/account pair resolved exactly one active matching zone in a read-only 2026-10-11 check. No identifier value was logged. The DNS adapter repeats this fail-closed lookup; each concrete DNS mutation remains separately approved.                                                                      | Owner, 2026-10-11 |
| R-005 | Off-server backup provider, key custodian, budget, deletion authority        | Partial: Cloudflare R2 is the proposed production off-server provider with a proposed $5 monthly budget; owner is sole encryption-key custodian/manual-deletion approver; least-privilege setup, automated upload, cost validation, and a successful real restore remain pending                                                                                      | Owner, 2026-10-11 |
| R-006 | Jurisdictions and approved privacy/consent/terms/retention policies          | Partial: initially operate in Texas, USA; privacy, cookie-consent, terms, and deletion policies require owner review before launch; exact approved texts remain pending                                                                                                                                                                                               | Owner, 2026-10-10 |
| R-007 | Google OAuth project, redirects, properties, permissions                     | Partial: one owner-controlled OmniReach Google Cloud OAuth project; connect each customer's Search Console and GA4 properties individually through authorized accounts; concrete project, redirects, consent screen, properties, and access remain pending                                                                                                            | Owner, 2026-10-10 |
| R-008 | Urgent-email provider, sender, recipients, escalation, spend                 | Planned: Resend free plan, `updates.omnireach.cloud`, alert sender `alerts@updates.omnireach.cloud`, auth sender `auth@updates.omnireach.cloud`, testing recipient `rhajj@omnireach.cloud`, $0 budget, 3 retries, dedupe, and ORAP failure history; verification, provider setup, credentials, final production recipient confirmation, and activation remain pending | Owner, 2026-10-11 |
| R-009 | Contact delivery, recipients, abuse/attachment/retention/consent policy      | Partial: optional centralized forms use Resend, selected sender `forms@updates.omnireach.cloud`, verified site recipients, 30-day retention except legal/security holds, Turnstile, honeypots, and rate limits; recipient verification, provider/DNS setup, credentials, activation, and legal wording remain pending                                                 | Owner, 2026-10-11 |
| R-010 | GitHub approvers, VPS deploy identity, host key, key custodian               | In progress: `omnireach-deploy`, its separate deploy key, the verified ED25519 host key, protected GitHub `production` environment, main-only branch policy, and repository variables/secrets are configured. Owner authorized end-to-end G31 work on 2026-10-11. One-time root install, live permission/prechecks, deployment, and rollback proof remain.            | Owner, 2026-10-11 |
| R-011 | Plans, prices, seats, exact nonpayment grace period                          | Selected proposal: STARTER $500/2 seats/5 pages/weekly SEO/2 AI review cycles; GROWTH $1,000/5/10/daily/8; PRO $1,500/10/20/daily/16; ELITE $2,000/20/30/daily/30. Per-site assignment, one location, ORAP overrides, and 14-day grace apply. Final commercial approval remains pending.                                                                              | Owner, 2026-10-11 |
| R-012 | OpenAI project, key custodian, production spend authority/limit              | Partial: dedicated project/key is host-configured; owner controls spend; $5/site and $50 platform-wide caps apply. Candidate aliases select `gpt-6.1-sol` for balanced content review and `gpt-6-luna` for economy. `OPENAI_PROVIDER_ENABLED=false` until representative cost/quality tests and explicit paid-call activation.                                        | Owner, 2026-10-11 |
| R-013 | Availability, maintenance, RPO, RTO, escalation objectives                   | 99.5% monthly; Sun 02:00–04:00 America/Chicago; RPO 24h; RTO 8h; critical ack 30m; noncritical ack 24h; ~10 sites on 2-core/8 GB                                                                                                                                                                                                                                      | Owner, 2026-10-10 |

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

R-005 development-stage plan: create daily compressed encrypted backups under
`/opt/backups/omnireach/` covering PostgreSQL, editable website content, uploaded media,
and important platform configuration while excluding caches and regenerable artifacts.
Validate archive integrity automatically, retain 3 daily and 2 weekly recovery points
subject to explicit capacity checks, and support a monthly isolated restoration test.
The owner may download an encrypted backup to a personal computer weekly using SFTP or
SCP and verify its checksum. This manual weekly copy does not satisfy the approved
24-hour production RPO or D-016 off-server requirement. No backup installation,
scheduling, host directory creation, pruning, or transfer is authorized yet.
The owner is the sole encryption-key custodian and the only person who may authorize a
manual backup deletion; every manual deletion must be logged. Because automated deletion
is authorized only when enforcing the production 7-daily/4-weekly policy, the
development 3-daily/2-weekly target requires logged owner-approved manual deletion.
Capacity pressure must alert and pause safely rather than trigger unauthorized pruning.

R-005 production proposal selects Cloudflare R2 as the automated encrypted off-server
destination with a proposed $5 monthly storage budget. Production backups cover
PostgreSQL, editable content, uploaded media, and necessary configuration; run daily,
retain 7 daily and 4 weekly recovery points, validate integrity daily, and undergo a
monthly isolated restoration test. Encryption keys stay separate from least-privilege R2
credentials. Manual deletion still requires owner authorization and an audit record.
Provider/account creation, spending, credentials, scheduling, upload, pruning, and
production use are not authorized by this proposal. R-005 remains incomplete until an
automated off-server copy meets the 24-hour RPO and a real restore succeeds.

R-006 through R-012 directions are approved as nonsecret configuration policy only. In
this record, “owner” means the human OmniReach owner, never Codex or another automated
agent. Provider projects, credentials, account identifiers, verified senders, recipients,
prices, policy text, and host/deploy keys remain external inputs at their named gates. No
external connection, production deployment, or provider mutation is authorized by
recording these directions.

R-008 remains a plan, not provider activation. The free-plan assumption must be checked
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

R-009 defines contact forms as optional reusable site components backed by one
centralized tenant-scoped submission, abuse-control, delivery, and retention system.
ORAP administrators can enable or disable forms per website. Authorized customer roles
can configure only supported fields and view only their own site's submissions.
Confirmation emails are optional and disabled by default. Production protection uses
Cloudflare Turnstile, honeypots, and rate limits. The selected sender is
`forms@updates.omnireach.cloud`. Verified customer recipients, sender-domain/provider
setup, credentials, explicit production activation, and legally approved consent wording
remain pending.

R-010 fixes the repository at `OmniReach-Websites/SEO-Automation` and the owner as both
production approver and deploy-key custodian. Only a verified push to protected `main`
may automatically deploy. The `omnireach-deploy` account must have narrowly scoped
release permissions, never unrestricted sudo or Docker-daemon access. Root/password SSH
hardening is deferred until non-root deployment and emergency recovery are tested.
On 2026-10-11 the owner explicitly authorized G31 prerequisite and activation work,
including the restricted deploy identity, scoped SSH/GitHub setup, isolated service
installation, forward migrations, backup/provider setup, and the reviewed additive
Caddy change. G30's pre-production gate is now complete. The initial execution window is
Sunday, October 18, 2026, from 02:00 to 04:00 in `America/Chicago` (07:00–09:00 UTC).
Execution still requires exact prechecks, rollback evidence, credential custody, and the
earlier rule that each concrete DNS change receives separate explicit approval. It does
not authorize a paid service, a real customer, or SSH hardening. Releases remain
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
candidates, not permanent promises. `OPENAI_PROVIDER_ENABLED=false` keeps paid calls
disabled until representative tests pass and the owner explicitly authorizes activation.

R-007 remains deferred at the owner's direction. Google OAuth identifiers and secrets
stay blank, and Search Console/GA4 surfaces retain their not-connected state without
blocking core production activation.

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
with 7 daily and 4 weekly recovery points and an off-server copy, and owner-approved
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
