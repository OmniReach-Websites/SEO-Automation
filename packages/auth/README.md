# Auth Package

**Status:** The owner-approved 2026-10-11 account-policy and email-code foundation is
implemented and tested locally. The Auth Contract v3 WebAuthn persistence, exact-host
cryptographic wrapper, one-use ceremony store, and atomic enrollment transaction are
also implemented. The enrollment API and Windows Hello browser flow remain behind a
compile-time-off capability gate: the production composition cannot write a passkey or
change account policy until assertion/login ships in the same release. G05 remains in
progress because customer TOTP management, passkey assertion/login and management,
recent-strong-step authorization for sensitive owner
changes, the audited privileged break-glass procedure, complete method-specific durable
audit events, and a production-equivalent MFA encryption-key rotation drill are not
complete yet. Source-bound Auth Contract v3 metadata and the reviewed bridge/rollback
paths are implemented and validated locally; their first live execution remains a G31
owner-controlled change. G06 is also reopened for Auth Contract v3
host/role/RLS/session-race revalidation.

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
and have atomic attempt/resend limits. TOTP login remains supported. Customer TOTP and
active WebAuthn capabilities are not deployable features yet.
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
after locking the identity. Completing a restricted customer recovery additionally
requires an explicit destructive-action confirmation and the current password verified
against the credential row while it is locked. The same transaction disables email
verification, revokes active TOTP and RP-scoped WebAuthn credentials, changes the
account policy to optional/password-first, rotates account recovery codes, advances the
authentication-state version, invalidates password-reset tokens, revokes every session
for the account across customer hosts, and records scoped non-secret counts with an
explicit account-wide marker. It never issues a full session; the caller clears the
recovery cookie and requires an ordinary password login.

Invitation acceptance and password-reset completion pass an atomic token-digest plus
client-network admission limit before Argon2id work. Redis keys are HMAC-derived and do
not expose the token or network address.

Email verification is intentionally an accessibility tradeoff, not a phishing-resistant
factor or NIST Authentication Assurance Level claim. Mailbox compromise, forwarding
rules, filtering/delay, and Resend or recipient-provider outages can deny or compromise
routine verification. Provider failure always fails closed; it never creates a
password-only ORAP session.

## Auth Contract v3 production boundary

Auth Contract v2 first established account policy and assurance state. Applying the v3
schema makes exact-RP WebAuthn state possible and replaces the v2 session/recovery RLS
gate, so a v2 process fails closed. After that point,
deployment and rollback must activate only artifacts that explicitly declare Auth
Contract v3 compatibility. The source-bound release manifest, metadata generator,
target validator, protected bridge workflow, and separately confirmed rollback workflow
implement that fail-closed contract and pass the local deployment harness. The ordinary
target script refuses an unreviewed v2-to-v3 transition. Production
authentication remains gated until the owner-controlled bridge and rollback are proven
against the protected environment and target. A v2 binary is not a valid rollback
target after the v3 migration. The bridge therefore requires a separate v3-compatible
fallback artifact; if both v3 artifacts fail, use a compatible forward fix or restore
the pre-transition backup together with its matching v2 artifact.

WebAuthn scopes bind an opaque random 64-byte user handle to one user, exact RP host,
and optional tenant/site pair. Credential identifiers, public keys, device type, backup
eligibility, verification time, and scope identity are immutable; revocation is
permanent, and its recorded timestamp and reason cannot be rewritten. Auth-role grants
contain no DELETE capability. Enrollment verifies an exact-host, five-minute one-use
registration ceremony and commits the scope/credential, replacement recovery-code
hashes, required/preferred policy, all-session revocation, authentication-state change,
and non-secret audit event in one auth-role transaction. Preparation and completion
revalidate a recent baseline/strong customer session or an existing recent strong ORAP
session, the current password state, current role/membership, host, scope, and limits.
The first ORAP strong factor still requires the separate approved bootstrap/recovery
authorization and cannot use routine email assurance alone. Revocation management is
not exposed. Assertion counter/backup updates must commit with session issuance and are
the blocker that keeps enrollment disabled in the production composition.

Persistent TOTP secrets and encrypted recovery-delivery payloads use a versioned keyring.
The legacy `MFA_ENCRYPTION_KEY` is accepted only as a version-1 deployment bridge. New
records use the active key version, reads select the stored version, and the bounded
`PostgresMfaKeyRotator` rewrites factors atomically. The operator command never accepts
key material on its command line. Rotation batches require a change ID and produce
non-secret audit evidence. Retirement rechecks factor and queued-delivery references
under the same database advisory lock used by ciphertext writes, persists an immutable
retirement record, and causes stale writes under that version to fail closed.
Application startup uses `SESSION_SECRET` as the separate authentication pepper and
rejects reusing it as any encryption key, so changing the active encryption key does not
change newly issued email-code or challenge digests.

Do not rotate a live key merely because the repository primitive exists. A rotation
updates authentication state and therefore requires planned reauthentication, a
deployment lock, a compatible rollback artifact and backup, a 10-minute drain for
ephemeral owner-bootstrap state, an owner-approved change record, and a successful
production-equivalent drill. G31 remains gated on that evidence.

After any new-version write or rotation batch, abort and rollback must keep both keys
readable; the old version may be selected for new writes, but neither version may be
removed while ciphertext can reference it. Durable retirement is explicit and
irreversible. The legacy single-key file is only an initial-rollout/runtime bridge and
does not make a pre-keyring binary a valid rollback target after mixed-version writes or
retirement.

Durable audit coverage is also incomplete for some code issuance/resend,
limiter-denial, delivery-failure/exhaustion, bootstrap, and method-change outcomes.
Generic request logs are not substitutes for the required non-secret audit events.

Do not describe G05 as complete until every remaining validation item passes
`npm run verify:goal -- G05`. Secrets remain server-side and are hashed or encrypted as
appropriate. Resend remains inactive, and production owner bootstrap and recovery
custody remain G31 owner-controlled actions.
