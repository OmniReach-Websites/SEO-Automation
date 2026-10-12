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
- Credential values, verification codes, factor secrets, and recovery codes never enter
  chat, Git, container images, build artifacts, command output, application logs, or
  audit-event payloads.
- The Platform Owner retains MFA recovery codes in encrypted storage. If credentials
  must later be shared with employees, introduce an approved shared vault such as
  Bitwarden before sharing; do not distribute copies through chat or email.
- The owner is the sole initial break-glass approver. Review this concentration-of-access
  risk and designate an independent approver or documented dual-control alternative
  before staff access or shared operational responsibility is introduced.
- Secret creation, installation, rotation, recovery, and revocation require an approved
  runbook and must avoid shell history and process-argument exposure.

## 3. Threat model

| Threat                      | Example attack                              | Required controls                                                                                   | Validation goal    |
| --------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------ |
| Cross-tenant access         | Site A requests Site B field/asset/job      | Server-derived context, membership check, composite FKs, RLS, opaque errors                         | G06, G30           |
| Host confusion              | Forged Host selects another admin site      | Exact normalized verified host map; proxy allowlist; no arbitrary tenant query                      | G06, G14, G18      |
| Session theft/leakage       | Cookie shared across unrelated domains      | Host-only Secure HttpOnly SameSite cookies, rotation, revocation, CSP                               | G05, G14           |
| Credential attacks          | Brute force, code replay, reset enumeration | Argon2id, account/challenge limits, generic responses, hashed one-time material, account MFA policy | G05, G30           |
| Mailbox/provider compromise | Email code or reset intercepted             | Five-minute hashed codes, exact-host binding, stronger owner step-up, audited break-glass           | G05, G30           |
| Privilege escalation        | Editor invokes owner/staff action           | Deny-by-default action matrix; request and execution recheck; audit                                 | G05–G08, G15–G16   |
| XSS/CSRF                    | Rich text or preview steals session         | Strict sanitizer, CSP, isolated preview, CSRF tokens/origin checks                                  | G11, G14–G15, G30  |
| Malicious upload            | Polyglot/SVG/bomb/traversal                 | Stream/size/signature/dimension checks, quarantine, opaque keys, SVG policy                         | G12, G30           |
| SSRF/DNS rebinding          | Crawler reaches metadata/private hosts      | Scheme/port allowlist, resolve/check every hop, size/time/redirect limits                           | G23, G30           |
| Prompt injection            | Crawled page instructs model/worker         | Treat as data, minimal context, schemas, no ambient tools, deterministic policy                     | G25–G26, G30       |
| AI factual corruption       | Model alters price embedded in copy         | Separate facts/tokens, whole-field protection, deterministic compare, CAS                           | G11, G26, G30      |
| Budget race                 | Concurrent calls overspend site cap         | Serializable reservation, hard UTC-month cap, reconciliation ledger                                 | G21, G25, G30      |
| Queue replay                | Duplicate publish/deploy side effect        | Idempotency/dedupe keys, leases, current-policy/revision recheck                                    | G16, G20, G30      |
| OAuth/webhook replay        | Stolen callback or duplicate event          | State/nonce/PKCE, redirect allowlist, signature/timestamp, idempotency                              | G27, G30           |
| Contact-form abuse          | Spam, spoofed site, sensitive logs          | Contract schema, site/origin resolution, limits, honeypot/adapter, redaction                        | G13, G30           |
| Supply-chain compromise     | Malicious dependency/action/image           | Locks, pinned actions/images, scans, review ownership, reproducible builds                          | G02–G03, G19, G30  |
| Secret leakage              | Key in Git/log/build/browser                | Secret stores, server-only env, redaction tests, scanners, least privilege                          | G02, G19, G25, G30 |
| Deployment takeover         | Branch or stolen key deploys code           | Protected `main`, environment approvals, scoped non-root SSH, host-key verify                       | G03, G19, G31      |
| Backup exposure/loss        | Public archive or unusable backup           | Encrypt, checksum, off-server, key custody, 7/4 retention, monthly restore                          | G29–G31            |
| Existing-service outage     | OmniReach overwrites Caddy/ports            | Read-only inventory, unique projects/networks, validate/additive reload, rollback                   | G18–G19, G30–G31   |

## 4. Identity and session requirements

- Passwords use Argon2id with reviewed parameters; plaintext passwords never persist or appear in logs.
- Authentication policy is stored and enforced at account level. An active Platform
  Owner, Platform Admin, or Staff account must have two-step verification required; the
  requirement is not a global assumption applied to every customer administrator.
- The canonical ORAP hostname is reserved for platform authentication. Customer-domain
  creation, resolution, recovery, settings, and session issuance reject it even if a
  conflicting database record exists.
- Routine ORAP two-step verification may use an email code delivered through the
  disabled-by-default Resend adapter. Codes expire after five minutes, are single-use,
  stored only as hashes, bound to the user, exact host, and pending challenge, and have
  atomic attempt and resend limits. A full session is never issued before verification.
- Email verification is an approved OmniReach business control, not a claim of NIST
  Authentication Assurance Level conformance. NIST SP 800-63B-4 prohibits email as an
  out-of-band authenticator, and manually entered email or OTP codes are not
  phishing-resistant. Mailbox, forwarding-rule, provider, interception, and delivery
  availability risks remain. See the
  [NIST authenticator requirements](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/).
- TOTP remains supported and WebAuthn/FIDO2 passkeys are an optional stronger method.
  Sensitive owner recovery, factor replacement, and security-policy changes require a
  recent TOTP or WebAuthn verification, or an explicitly approved short-lived,
  single-use, reason-bearing break-glass procedure. Email or a recovery-code session
  alone cannot authorize those changes.
- WebAuthn is exact-host scoped. The normalized verified admin hostname is both RP ID
  and the only accepted HTTPS origin; apex, wildcard, caller-selected, and cross-origin
  bindings are rejected. Ceremony state is opaque, one-use, server-side, and expires in
  at most five minutes. User verification is required and attestation is not collected.
- The Auth Contract v3 persistence foundation stores random 64-byte user handles and
  immutable RP/site credential identity behind forced RLS and auth-role-only grants.
  Enrollment preparation requires the current password, a recent non-recovery
  baseline/strong customer session or existing strong ORAP session, an exact verified
  host, and an existing email/TOTP/passkey path. Completion consumes a five-minute
  one-use session/auth-state/credential-state-bound ceremony and atomically inserts the
  credential, replaces account recovery-code hashes, activates required/preferred
  WebAuthn policy, revokes every session, and writes non-secret audit evidence. The
  first ORAP strong factor requires the separate approved bootstrap/recovery
  authorization; email assurance alone cannot enroll it. The API and Windows Hello UI
  remain behind a compile-time-off capability gate until assertion/login atomically
  updates credential state with session issuance. Revocation management is not yet
  exposed.
- Customer Owner, Customer Editor, and Customer Viewer accounts are password-only by
  default. Customers may voluntarily enable email-code verification, TOTP, or WebAuthn
  through tenant-safe security settings. Enrollment must verify the new method before
  activation, and the stricter account policy wins when one identity also has platform
  access.
- Recovery codes are account-level, shown once, acknowledged as saved, stored only as
  hashes, single-use, and replaced as a complete set after recovery use. Recovery use is
  distinguishable in the session/audit assurance record and does not silently elevate
  the session for sensitive owner actions. An eligible customer with recovery codes but
  no deliverable email/TOTP method may receive a recovery-only pending challenge; only a
  valid code may create the restricted 15-minute recovery session. Platform accounts do
  not receive this fallback. Preliminary validation does not consume the code; final
  consumption, revocation of sibling codes, and restricted-session insertion commit or
  roll back together. Completion requires explicit confirmation and current-password
  verification under a credential-row lock. Its single auth-role transaction disables
  optional email verification, revokes active TOTP and WebAuthn credentials, rotates
  recovery codes, advances authentication state, invalidates reset tokens, revokes all
  account sessions across customer hosts, and records scoped non-secret counts with an
  explicit account-wide marker. No full session is issued; the recovery cookie is
  cleared and normal password login is required.
- The initial owner is created through a one-time, exact-ORAP-host bootstrap with no
  default credential. Production identity, recovery custody, and break-glass approval
  are R-002. Bootstrap failure or unavailable email delivery fails closed.
- Customer sessions use the central identity store but separate host-only cookies for each verified `admin.<customer-domain>`. Cookies are never scoped to unrelated parent domains.
- Session identifiers are random, stored hashed, rotated on authentication/privilege
  change, revocable by account/site/global scope, and bounded by idle/absolute expiry.
  Sessions record authentication method, assurance class, and verification time so
  sensitive actions can require a recent stronger step. Immediately before insertion,
  session issuance locks and revalidates the credential/password-hash state, active
  membership, exact verified host, current account policy, and selected factor. Pending
  challenges bind a monotonic authentication-state version that changes with password,
  account, membership, platform-role, policy, and factor state and is checked again at
  insertion; a concurrent change or failed revalidation creates no session.
- ORAP administrators may revoke customer sessions only through exact-site,
  reason-bearing, audited controls. Customer credentials and factor secrets remain
  invisible to ORAP.
- Password reset and invitation responses do not disclose whether another tenant/user
  exists. Tokens are single-use, short-lived, hashed, and bound to the server-resolved
  account and exact verified host. Password reset never creates a session, disables a
  required second step, or treats email as the strong proof for owner-level recovery.
  Token-digest and client-network limits run before Argon2id on invitation acceptance
  and reset completion. After locking the identity, customer reset and email-policy
  mutations recheck active platform membership in a fresh statement, so a concurrent
  ORAP promotion blocks the customer flow.
- Recovery email uses a restricted PostgreSQL outbox so the HTTP response never waits
  on provider latency. No outbox item or decoy email is created for a missing identity.
  The recovery table retains only the token hash; a separate, domain-separated
  authenticated-encryption copy exists only long enough for bounded delivery. Leases
  make interrupted work recoverable, three failed attempts are terminal, and token
  use, expiry, success, or terminal failure erases the ciphertext. Provider responses
  and error messages are never persisted. Token issuance and encrypted outbox enqueue
  currently occur in consecutive, non-atomic transactions. Failure between them can
  leave a valid but undelivered token until expiry; the response remains generic, no
  session is issued, and a retry safely replaces/invalidates that token. This is a known
  availability gap, not a claimed atomic guarantee.
- Persistent TOTP and recovery-delivery ciphertext use a versioned keyring. New writes
  select the active version; reads use the stored version; a bounded transactional job
  rewrites TOTP factors; and retirement fails while durable factor or delivery
  references remain. The legacy version-1 file is only the first-release bridge. Live
  activation remains blocked until an isolated production-equivalent rotation,
  reauthentication, rollback, and recovery drill passes under owner approval.
- Authentication attempts, invitation acceptance, reset completion, and all
  email-code/recovery issuance use an atomic Redis limiter across both keyed account or
  token-digest and client-network dimensions. Identifier keys are HMAC-derived and never
  contain plaintext email, token, or IP data. Per-route and per-challenge limits remain
  additional layers; no process-local counter is treated as the authoritative
  cross-instance control.
- The API ignores `X-Forwarded-For` unless its immediate peer is in the explicit
  `TRUSTED_PROXY_CIDRS` allowlist. The list contains only the inventoried Caddy peer and
  verified intermediate proxy ranges, never all private Docker ranges. Caddy must
  discard untrusted incoming forwarding data. When Cloudflare proxying is active,
  Caddy must trust the forwarding chain only from current verified Cloudflare source
  CIDRs, and the API must traverse that chain from right to left. Until this chain is
  configured and tested, production authentication activation remains gated because a
  proxy address would collapse unrelated users into one network bucket. Production
  configuration fails startup validation when this allowlist is empty.
- Durable method-specific audit events are still missing for some issuance/resend,
  limiter-denial, delivery-failure/exhaustion, bootstrap, and method-change outcomes.
  G05 remains in progress; generic request logs do not satisfy the audit requirement.
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
- Internal staff provisioning and authority administration are direct Platform Owner
  identity checks and are never grantable capabilities. Platform Admin and custom Staff
  roles cannot invite/create employees, change staff status or credentials, edit roles,
  change role/scope assignments, or assign ownership. The last active Owner is protected.
- Every ORAP route registers a stable capability and resource-scope resolver. Unknown or
  newly registered capabilities are denied to non-owners until deliberately assigned;
  owner-only catalog entries cannot be added to a role. Lists, counts, search, exports,
  caches, and worker execution use the same scope as detail/mutation checks.
- Staff role, permission, or scope changes atomically advance authentication state,
  revoke platform sessions, invalidate authorization caches, and append non-secret
  before/after audit evidence. UI visibility is not an authorization boundary.
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
- Authentication email delivery remains inactive until the approved sender domain,
  provider account, credentials, quotas, and explicit production activation are
  verified. Provider failure never falls back to password-only ORAP access.
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
- G19 produced an independently reusable deployment workflow and isolated target
  harness. The repository now also contains a `main`-push production wrapper referencing
  the protected `production` environment as partial G31 preparation. Repository files
  do not prove the external GitHub protection, approver, credential, VPS permission, or
  activation state; G31 remains blocked on its recorded prerequisites and live evidence.
- Actions and base images are pinned; artifacts carry checksums; the target verifies exact SHA/manifest/host key.
- The deploy account is non-root and restricted to named OmniReach release paths and scripts.
- Releases serialize, stage to versioned directories, run compatibility/health checks, atomically switch, and restore the prior pointer on failure.
- Auth Contract v2 establishes a compatibility cutoff when its schema is applied or v2
  authentication state is written. Activation and rollback fail closed unless the
  artifact explicitly declares v2 compatibility; after the cutoff, a pre-v2 artifact is
  never an acceptable automatic or manual rollback target. Source-bound metadata, the
  separately confirmed two-artifact bridge, and compatible rollback paths are
  implemented and locally validated. The ordinary target refuses an unreviewed
  pre-v2-to-v2 transition; first live bridge/rollback evidence remains required before
  production use.
- Shared Caddy changes are additive, validated before reload, and backed by an exact rollback. Christians Reunite health is checked before and after.
- Logs redact passwords, keys, tokens, cookies, verification codes, factor material,
  recovery codes, private content, and sensitive form values.

## 10. Security acceptance checklist

Before G31 production activation, evidence must show:

- [ ] Cross-tenant API, DB/RLS, hostname, asset, cache, and worker tests pass.
- [ ] ORAP account-policy, email-code expiry/attempt/resend/replay, stronger owner
      step-up, reset, provider-independent encrypted recovery delivery,
      invitation, session rotation/revocation, CSRF, and open-redirect tests pass.
- [ ] Email-code risk is explicitly accepted as non-phishing-resistant and
      provider/mailbox dependent; provider outage fails closed and never degrades to
      password-only ORAP access.
- [ ] Customer password-only defaults, voluntary method enrollment/revocation, security
      settings, and exact-site administrator session revocation pass without weakening
      platform policy or tenant isolation.
- [ ] Customer recovery-only fallback is code-gated and restricted to 15 minutes;
      platform accounts cannot use it.
- [ ] Canonical ORAP-host reservation and concurrent session-issuance revalidation pass
      against credential, membership, host, policy, and factor changes.
- [ ] Recovery-delivery fault injection covers the non-atomic token/outbox boundary, and
      durable method-specific audit events cover issuance/resend, limiter denial,
      delivery failure/exhaustion, bootstrap, recovery, and revocation without secrets.
- [ ] Auth Contract v2 activation/rollback compatibility fails closed, and versioned MFA
      key rotation/re-encryption/retirement succeeds before production activation.
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
