# Auth Package

**Status:** The owner-approved 2026-10-11 account-policy and email-code foundation is
implemented and tested locally. G05 remains in progress because customer TOTP
management, WebAuthn/passkeys, recent-strong-step authorization for sensitive owner
changes, the audited privileged break-glass procedure, complete method-specific durable
audit events, explicit Auth Contract v2 artifact metadata and first-transition runbook,
and MFA encryption-key rotation are not implemented yet. G06 is also reopened for Auth
Contract v2 host/role/RLS/session-race revalidation.

The current package provides Argon2id password hashing, normalized identities, one-time
token hashing, host-only secure cookie options, account-level authentication policy,
five-minute hashed email codes, authenticator-app TOTP verification, versioned recovery
codes, assurance-aware sessions, exact-host recovery/session operations, the fixed role
model, permission checks, and a restricted PostgreSQL password-recovery delivery
outbox. Recovery-token issuance and encrypted outbox enqueue are consecutive database
transactions, not an atomic unit. A narrow failure can leave a valid but undelivered
token until expiry; the generic response reveals nothing, and a retry safely
replaces/invalidates the earlier token. Issuance serializes on the identity and freshly
rechecks exact-host customer eligibility, so concurrent requests leave only the newest
active token. The request never waits on provider I/O; a leased processor applies
bounded retries and erases ciphertext on every terminal outcome.

Platform Owner, Platform Admin, and Staff require two steps. Customer accounts are
password-only by default and can opt into email codes from the security settings page.
Routine email codes expire after five minutes, are single-use, stored only as hashes,
and have atomic attempt/resend limits. TOTP login remains supported. Customer TOTP
enrollment and WebAuthn are planned stronger-method work, not deployable features.
Sensitive owner recovery/security changes remain unavailable until a recent stronger
method gate or the approved one-time audited break-glass procedure is implemented.

The canonical ORAP hostname is reserved and cannot resolve as a customer host. Session
insertion locks and revalidates the credential/password-hash state, active membership,
exact verified host, current account policy, and selected factor. Pending challenges
bind a monotonic authentication-state version and session insertion compares it again.
An eligible customer with recovery codes but no deliverable email/TOTP method can
receive a recovery-only pending challenge; only a valid code creates the restricted
15-minute recovery session. Code consumption, sibling revocation, and session insertion
are atomic and same-account recovery claims serialize on the identity row. Database
deadlock or serialization failures are retried at most three times as complete
transactions; exhaustion fails closed with no partial commit. Platform accounts never
receive that fallback, and customer reset/security mutations recheck platform membership
after locking the identity.

Invitation acceptance and password-reset completion pass an atomic token-digest plus
client-network admission limit before Argon2id work. Redis keys are HMAC-derived and do
not expose the token or network address.

Email verification is intentionally an accessibility tradeoff, not a phishing-resistant
factor or NIST Authentication Assurance Level claim. Mailbox compromise, forwarding
rules, filtering/delay, and Resend or recipient-provider outages can deny or compromise
routine verification. Provider failure always fails closed; it never creates a
password-only ORAP session.

## Auth Contract v2 production boundary

Applying the v2 schema or writing v2 account-policy, assurance, factor, challenge,
recovery, or session state establishes the compatibility cutoff. After that point,
deployment and rollback must activate only artifacts that explicitly declare Auth
Contract v2 compatibility. The repository does not yet implement that fail-closed
release metadata contract. The ordinary target script does implement a fail-closed
readiness preflight and refuses the first pre-v2-to-v2 transition; the reviewed bridge
or forward-recovery runbook is still missing, so production authentication remains
gated. A pre-v2 binary is not a valid rollback target; use a compatible prior artifact,
forward fix, or compatible backup restore.

Persistent TOTP secrets and encrypted recovery-delivery payloads currently use a single
version-1 `MFA_ENCRYPTION_KEY`. Key rotation is unsupported: there is no keyring,
re-encryption job, or tested retirement/recovery procedure. Do not replace that key on an
initialized environment. Production authentication remains gated until versioned
rotation succeeds against records encrypted under old and new keys.

Durable audit coverage is also incomplete for some code issuance/resend,
limiter-denial, delivery-failure/exhaustion, bootstrap, and method-change outcomes.
Generic request logs are not substitutes for the required non-secret audit events.

Do not describe G05 as complete until every remaining validation item passes
`npm run verify:goal -- G05`. Secrets remain server-side and are hashed or encrypted as
appropriate. Resend remains inactive, and production owner bootstrap and recovery
custody remain G31 owner-controlled actions.
