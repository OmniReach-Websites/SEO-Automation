# ADR 0003: Authentication and domain-scoped sessions

- **Status:** Accepted
- **Date:** 2026-10-10
- **Decisions:** D-001, D-002, D-003, D-006

## Context

ORAP uses a platform domain while customers sign in at unrelated `admin.<customer-domain>` hosts. Cross-domain cookies or URL tokens would increase leakage and fixation risk. Staff accounts require stronger controls.

## Decision

- ORAP will use configurable `admin.<OmniReach-domain>` naming. R-001 supplies
  `omnireach.cloud` as the V1 base domain and `admin.omnireach.cloud` as the canonical
  production ORAP hostname.
- Use a central identity database with email/password and Argon2id.
- Require authenticator-app MFA for Platform Owner, Platform Admin, and Staff, with one-time recovery codes.
- Bootstrap the initial owner once through a secure flow; no default credential or committed password.
- Use independent host-only Secure HttpOnly SameSite sessions for each customer admin hostname. Do not share cookies across unrelated domains or pass login tokens in URLs.
- Sessions are hashed server-side, rotated on authentication/privilege change, revocable, idle/absolute bounded, and site-context checked.
- Password reset/invitation tokens are hashed, short-lived, single-use, rate-limited, and non-enumerating.

## Alternatives considered

1. **Parent/wildcard domain cookies:** rejected because customer domains are unrelated and cookie scope would be unsafe.
2. **Cross-domain URL bearer tokens:** rejected due leakage through logs/history/referrers and replay risk.
3. **Third-party identity provider for V1:** deferred; introduces an external dependency not selected by the owner.
4. **Optional staff MFA:** rejected by approved D-002.

## Consequences

- A user may authenticate separately on different customer admin hosts even though identity is centralized.
- Future SSO requires a new ADR and safe one-time exchange protocol.
- R-002 identifies `rhajj@omnireach.cloud` as the production Platform Owner, encrypted
  recovery-code custodian, and sole initial break-glass approver. This single-person
  dependency must be reviewed before staff access is introduced. No bootstrap credential
  or recovery code is stored in this repository.

## Validation

G05 auth/MFA/session tests, G06 host isolation, G14 two-host E2E, and G31 production bootstrap evidence prove the decision.
