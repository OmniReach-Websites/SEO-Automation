# ADR 0003: Authentication and domain-scoped sessions

- **Status:** Accepted
- **Date:** 2026-10-10
- **Revised:** 2026-10-11
- **Decisions:** D-001, D-002, D-003, D-006

## Context

ORAP uses a platform domain while customers sign in at unrelated
`admin.<customer-domain>` hosts. Cross-domain cookies or URL tokens would increase
leakage and fixation risk. Platform accounts need mandatory two-step verification,
while customer accounts should remain usable with password-only authentication unless
the customer elects a stronger policy.

The owner approved email-delivered verification codes as the accessible routine second
step for ORAP. This is a deliberate security/usability tradeoff. Email codes are not
phishing-resistant, mailbox compromise can defeat both password recovery and an email
second step, and email delivery depends on Resend and the recipient's mail provider.
NIST SP 800-63B-4 explicitly excludes email from conforming out-of-band authentication
because email does not prove possession of a particular device and is exposed to
interception and rerouting risks. OmniReach therefore does not claim that email-code
verification satisfies a NIST Authentication Assurance Level. See the
[NIST authenticator requirements](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/).

## Decision

- ORAP will use configurable `admin.<OmniReach-domain>` naming. R-001 supplies
  `omnireach.cloud` as the V1 base domain and `admin.omnireach.cloud` as the canonical
  production ORAP hostname. That canonical hostname is reserved for platform access and
  must be rejected by customer-domain creation, lookup, recovery, settings, and session
  issuance even if conflicting data is present.
- Use a central identity database with email/password and Argon2id. Authentication
  policy is account-level and is evaluated together with the exact login host and active
  membership; it is not inferred solely from a global administrator label.
- Platform Owner, Platform Admin, and Staff accounts require two-step verification.
  Password verification creates only a short-lived pending challenge and never a full
  ORAP session.
- Permit a Resend-delivered email code as the routine ORAP second step. A code expires
  after five minutes, is single-use, is stored only as a cryptographic hash, is bound to
  the account, exact ORAP host, and pending login, and is protected by atomic attempt,
  resend-cooldown, resend-count, and network limits. A resend invalidates the
  preceding code and atomically starts a fresh exact five-minute lifetime for the
  replacement. Delivery failure fails closed without issuing a session.
- Apply an additional Redis-backed fixed-window limiter to password attempts,
  verification attempts, password-recovery issuance, and every initial or repeated
  email-code issuance. One Lua operation checks and increments both a host/account key
  and a client-network key so concurrent requests cannot race either ceiling. Keys use
  domain-separated keyed digests and contain neither email addresses nor network
  addresses. Per-challenge counters remain defense in depth, not the only limit.
- Retain TOTP and add WebAuthn/FIDO2 passkeys as optional stronger methods. Verified
  TOTP or WebAuthn may satisfy routine two-step verification; WebAuthn is the preferred
  phishing-resistant method when available. Their enrollment, replacement, revocation,
  and use remain subject to the same host, challenge, rate-limit, audit, and recovery
  controls.
- Bind every WebAuthn credential to the exact verified login hostname: the RP ID is the
  normalized request hostname and the sole accepted origin is `https://<RP-ID>`. The
  ORAP RP is `admin.omnireach.cloud`; each customer RP is its own verified admin host.
  Do not use the apex domain, a wildcard RP, caller-provided origins, or cross-origin
  ceremonies. Host changes require new credentials.
- WebAuthn uses a random opaque 64-byte per-scope user handle, five-minute single-use
  server-side ceremony state, required user verification, no attestation collection,
  and ES256/RS256. Platform and roaming authenticators remain usable; Windows Hello is
  encouraged without making a platform attachment a hard requirement. Persist the
  signature counter, device type, backup eligibility/state, and transports, but do not
  rely on a nonzero counter as the only replay control for multi-device passkeys.
- Until every effective login host can be proven to retain a usable credential and safe
  recovery path, WebAuthn cannot be the account's sole global fallback. Enrollment
  requires verified email-code or TOTP fallback, and revocation must preserve that
  invariant. Credential enrollment/revocation, audit evidence, auth-state change, and
  affected-session revocation are atomic; assertion counter/backup state and session
  issuance are also one transaction.
- Sensitive owner-level recovery and security changes require recent stronger
  verification using TOTP or WebAuthn. If neither is available, they require an
  explicitly approved, short-lived, single-use, reason-bearing break-glass procedure
  that is fully audited, revokes affected sessions and challenges, and rotates recovery
  material. Email verification or an ordinary recovery-code session alone does not
  authorize those changes.
- Customer Owner, Customer Editor, and Customer Viewer accounts use email/password
  without two-step verification by default. A customer may voluntarily enable
  email-code verification, TOTP, or WebAuthn through a security settings page. Enabling
  a method requires proof of that method before policy activation; disabling or
  replacing a method requires current verification and must not violate a stricter
  policy applying to the same global identity.
- ORAP administrators may manage customer access and revoke exact-site customer
  sessions. These actions remain tenant/site scoped, reason-bearing, and audited; they
  do not expose customer credentials or factor secrets.
- Recovery codes belong to the account rather than to one TOTP factor. They are random,
  shown once, stored only as hashes, single-use, and regenerated as a new set after
  recovery use. Validation before challenge consumption is non-destructive; final code
  consumption, sibling-code revocation, and restricted-session insertion occur in one
  database transaction, so a failed session insert does not burn the code. Plaintext
  codes are never emailed, logged, committed, or stored by OmniReach. A customer account
  with codes but no deliverable email/TOTP method may receive a recovery-only pending
  challenge with no ordinary verification method. Only a valid recovery code may turn
  it into a restricted 15-minute recovery session. This fallback never applies to a
  platform account and never grants strong assurance. Same-account recovery claims
  serialize on the identity row; PostgreSQL deadlock or serialization failures retry as
  complete transactions up to a bounded limit and otherwise fail closed without a
  partial recovery mutation. Completing that restricted customer flow requires explicit
  confirmation plus the current password, verified while the credential row is locked.
  In the same auth-role transaction, it rechecks that no platform membership exists,
  disables email-code verification, revokes TOTP and WebAuthn credentials, restores the
  optional/password-first customer policy, rotates recovery codes, advances account
  authentication state, invalidates reset tokens, revokes all account sessions across
  customer hosts, and writes scoped audit counts plus an explicit account-wide marker
  without secrets. It creates no full session; the recovery cookie is cleared and the
  customer must perform an ordinary password login.
- Bootstrap the initial owner once through a secure, exact-ORAP-host flow with no
  default or committed credential. The one-time bootstrap authorization plus verified
  second step establishes the initial account; recovery-code custody must be confirmed
  before completion.
- Store the authentication method, assurance class, and verification time with each
  session so sensitive routes can require a recent stronger step. Recovery and factor
  changes revoke affected sessions and outstanding challenges.
- Use independent host-only Secure HttpOnly SameSite sessions for each customer admin
  hostname. Do not share cookies across unrelated domains or pass login tokens in URLs.
- Sessions are hashed server-side, rotated on authentication or privilege change,
  revocable at account/site/global scope, idle/absolute bounded, and checked against the
  current verified host and membership on every request. Immediately before insertion,
  session issuance locks and revalidates the credential/password-hash state, active
  membership, exact verified host, current account policy, and selected active factor.
  A monotonic account authentication-state version changes with password, account,
  membership, policy, and factor security state; pending challenges bind that version,
  and session insertion compares it again. A concurrent change, mixed customer/platform
  promotion, or failed revalidation creates no session.
- Password-reset and invitation tokens are hashed, short-lived, single-use,
  rate-limited, non-enumerating, and bound to their server-resolved account and exact
  host. Dedicated token-digest and client-network admission limits run before Argon2id
  work on invitation acceptance and reset completion. Reset-token issuance serializes
  on the identity and freshly rechecks exact-host customer eligibility before replacing
  the prior active token. Password reset never creates a session or removes a required
  second step. Customer reset and security-policy changes lock the user and then recheck
  active platform membership in a fresh database statement before mutation, so a
  concurrent ORAP promotion fails closed.
- Password-recovery delivery crosses a durable PostgreSQL outbox boundary before any
  provider call. The request path performs no provider I/O, and nonexistent accounts do
  not create messages or decoy deliveries. The recovery record keeps only the token
  hash; the outbox keeps a purpose-bound encrypted delivery copy under the server-held
  encryption key. A lease-based processor retries delivery at most three times and
  erases that ciphertext after delivery, terminal failure, token use, or expiry. Only
  the restricted authentication database role may access this outbox, and provider
  errors are reduced to non-secret error codes. The current implementation issues the
  recovery token and enqueues its encrypted delivery copy in two consecutive database
  transactions; they are not atomic. A failure in that narrow gap returns the same
  generic response but can leave a valid, undelivered token until expiry. Retrying is
  safe because it replaces/invalidates the earlier token. This availability limitation
  is not an authentication bypass and remains explicit G05 hardening work.
- Persistent TOTP secrets and encrypted recovery-delivery payloads use a versioned
  keyring. New writes use the active version, reads select the stored version, bounded
  re-encryption runs transactionally, and durable retirement fails while factor or
  delivery references remain. A legacy version-1 key file is accepted only for the
  initial compatibility bridge. Production authentication activation remains blocked
  until the owner-controlled production-equivalent rotation, reauthentication,
  rollback, and restore drill is completed and recorded.
- Auth Contract v2 began when its schema was applied or v2 account-policy,
  assurance, factor, challenge, recovery, or session state is written. From that cutoff,
  release activation and rollback must fail closed unless the artifact explicitly
  declares v2 compatibility. A pre-v2 binary is not a valid rollback target because it
  can ignore the v2 policy/host contract. Use a v2-compatible prior artifact, forward
  fix, or compatible backup restore instead.
  The ordinary release script checks the running readiness contract and refuses an
  unreviewed first v1-to-v2 transition. Source-bound compatibility metadata, a protected
  two-artifact bridge, and separately confirmed compatible rollback are implemented and
  validated in the local harness. Their first live execution and recovery evidence
  remain G31 production prerequisites.
- Auth Contract v3 begins when the RP-scoped WebAuthn schema is applied. Its restrictive
  session and recovery RLS policies accept only a v3 authentication transaction marker,
  so a v2 process fails closed and is not a valid rollback target. Source capability
  checks, readiness, target activation, bridge, and rollback metadata all declare v3 in
  the same repository change. The v3 foundation is inert: no enrollment, assertion, or
  revocation route is exposed until its complete atomic service transaction and audit
  behavior are implemented. The first v2-to-v3 transition must stage a distinct,
  reviewed v3-compatible fallback before applying the migration. Automatic rollback to
  the running v2 binary is intentionally unavailable after that point; failure of both
  v3 artifacts requires a compatible forward fix or an owner-authorized restore of the
  pre-transition database backup with its matching v2 artifact.
- Resend authentication delivery remains disabled until its sender domain, account,
  credentials, limits, and production activation receive the existing explicit
  approval. A disabled or unavailable provider never causes MFA bypass.
- Forwarded client addresses are accepted only when the immediate peer matches an
  explicitly configured Caddy/proxy IP or CIDR. With no allowlist, forwarded headers
  are ignored. The proxy chain is evaluated from the application outward so an
  attacker-controlled leftmost `X-Forwarded-For` value is not selected. If Cloudflare
  remains proxied, Caddy must first trust and preserve forwarding data only from
  verified Cloudflare source ranges; the API allowlist then includes the exact Caddy
  peer and those verified intermediate ranges. Broad private-network trust is not an
  acceptable substitute.

## Alternatives considered

1. **Parent/wildcard domain cookies:** rejected because customer domains are unrelated
   and cookie scope would be unsafe.
2. **Cross-domain URL bearer tokens:** rejected because of leakage through logs,
   history, referrers, and replay.
3. **Third-party identity provider for V1:** deferred; it introduces an external
   dependency not selected by the owner.
4. **Optional ORAP verification:** rejected. Every active platform account must retain
   mandatory two-step verification even when email is its routine method.
5. **Authenticator-app-only ORAP verification:** replaced because it would prevent the
   owner from completing routine authentication without a compatible authenticator.
6. **Email as a strong recovery factor:** rejected. The same mailbox commonly controls
   password recovery, email codes are phishable, and NIST does not recognize email as a
   conforming out-of-band authenticator.
7. **Role-only MFA policy:** rejected because a central identity can have platform and
   customer memberships, while customers need voluntary account security settings.

## Consequences

- A user may authenticate separately on different customer admin hosts even though
  identity is centralized. The stricter applicable account policy wins when one global
  identity has both platform and customer access.
- Email verification improves near-term accessibility but increases dependence on the
  mailbox and Resend. Delivery delays, filtering, forwarding rules, and provider outage
  can deny routine access even when credentials are correct. TOTP reduces that
  dependency today; WebAuthn is the planned phishing-resistant option. Sensitive owner
  actions do not trust email alone.
- Full session issuance, recovery, method replacement, and customer session revocation
  require method-specific assurance and audit evidence rather than a generic `mfa`
  marker.
- Durable method-specific audit coverage is incomplete for some issuance/resend,
  limiter-denial, delivery-failure/exhaustion, and bootstrap outcomes. Existing generic
  request logs do not satisfy this requirement; G05 remains in progress until the
  required non-secret audit events and tests exist.
- Future SSO requires a new ADR and safe one-time exchange protocol.
- R-002 identifies `rhajj@omnireach.cloud` as the production Platform Owner, encrypted
  recovery-code custodian, and sole initial break-glass approver. This single-person
  dependency must be reviewed before staff access is introduced. No bootstrap
  credential, verification code, factor secret, or recovery code is stored in this
  repository.

## Validation

G05 must prove account-policy evaluation, password-only customer defaults, opt-in
method management, five-minute email-code expiry, hash-only storage, atomic attempt and
resend limits, atomic account/network limits (including pre-Argon invitation/reset
completion admission) under concurrency, trusted-proxy spoofing and subnet-key tests,
challenge replay and authentication-state-version rejection, no pre-verification session,
provider-independent recovery responses, the non-atomic recovery enqueue failure window,
encrypted durable recovery delivery with lease/retry/ciphertext-erasure behavior,
customer-only atomic recovery-session issuance, TOTP/WebAuthn regression behavior,
recovery safeguards, mixed-identity promotion races, assurance-aware step-up, locked
session-state revalidation, canonical ORAP-host
reservation, session revocation, CSRF defense, durable method-specific audit evidence,
and log/audit redaction. G06 is reopened for Auth Contract v3 host/role/RLS/session-race
revalidation; G14 retains browser-level host-isolation coverage. G31 must reject
pre-v3 artifacts after the compatibility cutoff and must not complete production owner
bootstrap until key rotation and the selected second-step delivery or stronger method
are configured and verified without a bypass.
