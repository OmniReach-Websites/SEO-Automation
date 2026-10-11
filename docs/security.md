# OmniReach Security Baseline

**Status:** Approved G01 baseline  
**Applies to:** all platform, site, worker, integration, deployment, and operations goals

## 1. Security objectives

1. Prevent cross-tenant and cross-site access even when a client, job payload, hostname, or asset reference is malicious.
2. Keep published sites available when control/worker/provider components fail.
3. Prevent AI or customer editing from modifying protected business information outside the audited human fact workflow.
4. Protect identities, sessions, secrets, OAuth tokens, customer content, media, backups, and deployment credentials.
5. Make every privileged change attributable and reversible where technically possible.
6. Preserve shared Caddy and Christians Reunite through isolated configuration, resource controls, prechecks, and rollback.

## 2. Assets and classifications

| Class                 | Examples                                                  | Minimum handling                                                |
| --------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| Public                | Published pages, intended public derivatives              | Integrity/version checks; no secret assumptions                 |
| Internal              | Job status, deployment metadata, non-sensitive configs    | Authenticated, tenant/staff scoped                              |
| Customer confidential | Drafts, submissions, originals, metrics                   | Site-scoped RLS, encryption in transit, minimization, retention |
| Secret                | Password hashes, sessions, OAuth/API keys, recovery codes | Hash or encrypt, server only, redact, rotate, never commit      |
| Protected fact        | Prices, hours, address, contact/legal/material claims     | Separate verified records; no AI mutation/suggestion            |
| Security/audit        | Audit events, alerts, deployment evidence                 | Append-oriented, restricted, default 12-month retention         |

### 3.1 Production credential handling

- CI/CD credentials are stored only in protected GitHub Actions environment secrets;
  branch and pull-request workflows cannot access them.
- Runtime credentials are stored in permission-restricted, host-only environment files
  or exposed to containers through Docker/Compose secret mounts. Source files remain
  restricted on the host because Compose secret mounts do not by themselves guarantee
  encrypted storage at rest.
- Credential values never enter chat, Git, container images, build artifacts, command
  output, application logs, or audit-event payloads.
- The Platform Owner retains MFA recovery codes in encrypted storage. If credentials
  must later be shared with employees, introduce an approved shared vault such as
  Bitwarden before sharing; do not distribute copies through chat or email.
- The owner is the sole initial break-glass approver. Review this concentration-of-access
  risk and designate an independent approver or documented dual-control alternative
  before staff access or shared operational responsibility is introduced.
- Secret creation, installation, rotation, recovery, and revocation require an approved
  runbook and must avoid shell history and process-argument exposure.

## 3. Threat model

| Threat                  | Example attack                         | Required controls                                                                 | Validation goal    |
| ----------------------- | -------------------------------------- | --------------------------------------------------------------------------------- | ------------------ |
| Cross-tenant access     | Site A requests Site B field/asset/job | Server-derived context, membership check, composite FKs, RLS, opaque errors       | G06, G30           |
| Host confusion          | Forged Host selects another admin site | Exact normalized verified host map; proxy allowlist; no arbitrary tenant query    | G06, G14, G18      |
| Session theft/leakage   | Cookie shared across unrelated domains | Host-only Secure HttpOnly SameSite cookies, rotation, revocation, CSP             | G05, G14           |
| Credential attacks      | Brute force/reset enumeration          | Argon2id, rate limits, generic responses, one-time hashed reset, MFA              | G05, G30           |
| Privilege escalation    | Editor invokes owner/staff action      | Deny-by-default action matrix; request and execution recheck; audit               | G05–G08, G15–G16   |
| XSS/CSRF                | Rich text or preview steals session    | Strict sanitizer, CSP, isolated preview, CSRF tokens/origin checks                | G11, G14–G15, G30  |
| Malicious upload        | Polyglot/SVG/bomb/traversal            | Stream/size/signature/dimension checks, quarantine, opaque keys, SVG policy       | G12, G30           |
| SSRF/DNS rebinding      | Crawler reaches metadata/private hosts | Scheme/port allowlist, resolve/check every hop, size/time/redirect limits         | G23, G30           |
| Prompt injection        | Crawled page instructs model/worker    | Treat as data, minimal context, schemas, no ambient tools, deterministic policy   | G25–G26, G30       |
| AI factual corruption   | Model alters price embedded in copy    | Separate facts/tokens, whole-field protection, deterministic compare, CAS         | G11, G26, G30      |
| Budget race             | Concurrent calls overspend site cap    | Serializable reservation, hard UTC-month cap, reconciliation ledger               | G21, G25, G30      |
| Queue replay            | Duplicate publish/deploy side effect   | Idempotency/dedupe keys, leases, current-policy/revision recheck                  | G16, G20, G30      |
| OAuth/webhook replay    | Stolen callback or duplicate event     | State/nonce/PKCE, redirect allowlist, signature/timestamp, idempotency            | G27, G30           |
| Contact-form abuse      | Spam, spoofed site, sensitive logs     | Contract schema, site/origin resolution, limits, honeypot/adapter, redaction      | G13, G30           |
| Supply-chain compromise | Malicious dependency/action/image      | Locks, pinned actions/images, scans, review ownership, reproducible builds        | G02–G03, G19, G30  |
| Secret leakage          | Key in Git/log/build/browser           | Secret stores, server-only env, redaction tests, scanners, least privilege        | G02, G19, G25, G30 |
| Deployment takeover     | Branch or stolen key deploys code      | Protected `main`, environment approvals, scoped non-root SSH, host-key verify     | G03, G19, G31      |
| Backup exposure/loss    | Public archive or unusable backup      | Encrypt, checksum, off-server, key custody, 7/4 retention, monthly restore        | G29–G31            |
| Existing-service outage | OmniReach overwrites Caddy/ports       | Read-only inventory, unique projects/networks, validate/additive reload, rollback | G18–G19, G30–G31   |

## 4. Identity and session requirements

- Passwords use Argon2id with reviewed parameters; plaintext passwords never persist or appear in logs.
- ORAP roles—Platform Owner, Platform Admin, and Staff—must enroll authenticator-app MFA. Recovery codes are one-time and stored hashed.
- The initial owner is created through a one-time bootstrap with no default credential. Production identity and custody are R-002.
- Customer sessions use the central identity store but separate host-only cookies for each verified `admin.<customer-domain>`. Cookies are never scoped to unrelated parent domains.
- Session identifiers are random, stored hashed, rotated on authentication/privilege change, revocable by account/site/global scope, and bounded by idle/absolute expiry.
- Password reset and invitation responses do not disclose whether another tenant/user exists. Tokens are single-use, short-lived, and hashed.
- Cookie-authenticated mutations use CSRF defense. Redirects and OAuth callbacks use strict allowlists.

## 5. Authorization and tenant isolation

Authorization requires all applicable checks:

```text
authenticated identity
AND active account/session
AND verified host context where customer-facing
AND active tenant/site membership
AND role action grant
AND effective plan/site/platform policy
AND current resource belongs to resolved site
```

- Caller-provided `tenant_id` or `site_id` is never sufficient.
- Transaction-scoped tenant/site context and restricted database roles drive RLS. Pool reuse must be tested for context leakage.
- Composite foreign keys prevent cross-site page, field, asset, proposal, job, metric, and artifact references.
- Worker identities receive only their registered job capability and rehydrate scope from opaque identifiers.
- Platform bypass capabilities are enumerated, minimized, MFA-protected, and audited. There is no ambient application superuser.
- Unknown/forbidden resources return non-enumerating errors.

## 6. Content, protected facts, and AI controls

- Each managed field declares stable ID, type, schema version, edit grants, AI mode, classification, validators, and revision.
- `AUTO` is permitted only for approved marketing field classes. Turning it off yields `SUGGEST`. `PROTECTED` cannot enter proposal generation.
- Protected facts are separate verified records. Mixed fields use immutable fact references; when this is unreliable, the full field is protected.
- The provider returns a typed proposal only. It cannot directly call persistence, publishing, filesystem, SQL, shell, domain, or deployment operations.
- Structured model output is parsed, but still treated as untrusted. Refusals, incomplete output, unsupported schemas, links, claims, and protected facts are handled deterministically.
- Policy, membership, budget, fact preservation, current revision, and output are checked at generation, acceptance, and publication.
- Authorized Customer Owners and ORAP staff may edit facts only through the separate audited workflow. AI and customer editors/viewers cannot use that path.
- Every AI request records site/job, configured model alias and returned model identifier, prompt-template version, usage/cost, evidence, outcome, and safe error metadata.

## 7. Network and integration controls

- HTTPS is required. Database and Redis remain on private networks and are never exposed publicly.
- Crawler egress checks resolved addresses before every connection and redirect; private, loopback, link-local, metadata, reserved, and unsupported destinations are rejected.
- Cloudflare/Google/OpenAI/email tokens have least privilege, server-only access, rotation/revocation procedures, and credential references rather than secret database fields where possible.
- OAuth uses state/nonce and PKCE where appropriate, exact callbacks, exact site/property mapping, encrypted refresh-token storage, and audited disconnect.
- Contact forms validate declared fields and consent metadata, reject attachments by default, minimize retention, and isolate destination configuration from browsers.
- Production contact submissions use a verified site-specific business recipient and a
  30-day retention period. Automatic deletion is audited and pauses for applicable
  incident, legal, or customer holds; exact consent/legal wording remains R-006/R-009.
- Webhook/event ingestion verifies signature, timestamp, replay window, and idempotency before side effects.

## 8. Upload and preview controls

- Uploads are streamed with byte limits and checked using file signatures, decoded dimensions, and safe content-type rules.
- Site-isolated opaque keys prevent path control. Originals are private unless deliberately published through validated derivatives.
- SVG is rejected or sanitized under an explicit policy; it is never treated as a harmless bitmap by extension alone.
- Preview artifacts are authenticated, expiring, no-index, and isolated from production pages. Preview HTML uses a strict CSP and sandbox boundaries.
- Deleting a draft asset reference does not remove data used by an active artifact. Garbage collection is delayed and reference-aware.

## 9. Deployment and operations controls

- Branch and PR workflows cannot access production credentials or deploy.
- The reusable G19 workflow is inert for production. G31 binds it to protected `main` only after owner authorization and R-003/R-010.
- Actions and base images are pinned; artifacts carry checksums; the target verifies exact SHA/manifest/host key.
- The deploy account is non-root and restricted to named OmniReach release paths and scripts.
- Releases serialize, stage to versioned directories, run compatibility/health checks, atomically switch, and restore the prior pointer on failure.
- Shared Caddy changes are additive, validated before reload, and backed by an exact rollback. Christians Reunite health is checked before and after.
- Logs redact passwords, keys, tokens, cookies, recovery codes, private content, and sensitive form values.

## 10. Security acceptance checklist

Before G31 production activation, evidence must show:

- [ ] Cross-tenant API, DB/RLS, hostname, asset, cache, and worker tests pass.
- [ ] ORAP MFA, reset, invitation, session rotation/revocation, CSRF, and open-redirect tests pass.
- [ ] Rich-text XSS, preview isolation, CSP, and upload adversarial suites pass.
- [ ] SSRF and DNS-rebinding suite passes for every redirect/address form.
- [ ] Protected-fact and per-field AI policy corpus passes, including embedded prices/contact facts.
- [ ] Concurrent budget reservation cannot admit work beyond the configured hard cap.
- [ ] Branch workflows cannot use production environments or SSH credentials.
- [ ] Secret scans cover source, history introduced by the project, fixtures, logs, images, artifacts, and workflow output.
- [ ] Backup encryption/integrity and monthly isolated restore are proven.
- [ ] Existing Caddy routes and Christians Reunite remain healthy under release and rollback drills.
- [ ] No unresolved critical/high finding remains; accepted lower findings have owner, mitigation, and due date.

## 11. Incident priorities

1. Protect people/data and stop unauthorized access.
2. Keep or restore healthy public artifacts.
3. Freeze automation/publishing at the narrowest effective scope.
4. Revoke/rotate affected credentials and sessions.
5. Preserve audit evidence without copying secrets into tickets or Git.
6. Restore content/code/config from verified versions or backups.
7. Notify affected parties according to owner-approved policy R-006.

Detailed operator procedures are in [`operations.md`](operations.md). Decisions are indexed in [`adr/README.md`](adr/README.md).
