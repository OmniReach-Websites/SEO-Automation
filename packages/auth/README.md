# Auth Package

**Status:** G05 primitives implemented and tested locally.

Provides Argon2id password hashing, normalized identities, one-time token hashing, host-only secure cookie options, authenticator-app TOTP/recovery codes, the fixed role model, permission checks, and mandatory MFA classification for every ORAP role.

Validate with `npm run verify:goal -- G05`. Secrets remain server-side and are hashed/encrypted as appropriate. Production owner bootstrap and recovery custody remain G31 owner-controlled actions.
