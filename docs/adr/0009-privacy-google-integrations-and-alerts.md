# ADR 0009: Privacy, Google integrations, and alerts

- **Status:** Accepted
- **Date:** 2026-10-10
- **Decisions:** D-018, D-019, D-021, D-022

## Context

Analytics and search data require consent, external permissions, careful property mapping, and honest reporting. Operational failures need an internal lifecycle plus urgent email without alert floods.

## Decision

- Minimize collection and make analytics consent/retention configurable. Owner-approved legal policies precede real customer tracking/launch.
- Initial legal operation is in Texas, USA. The business owner must review and approve
  privacy, cookie-consent, terms, deletion, incident-notification, and revision-retention
  policies before launch; architecture documentation does not invent legal terms.
- Integrate Search Console and GA4 through OAuth with state/nonce/PKCE where appropriate, encrypted token references, least-privilege scopes, exact redirect allowlists, and verified site/property mapping.
- Use one owner-controlled OmniReach Google Cloud OAuth project, while connecting each
  customer's Search Console and GA4 properties individually through authorized accounts.
- Store metric source/property/window/ingestion/freshness/provenance and show not-connected/stale/unavailable states rather than invented zeroes.
- Track observable AI referral sources through a versioned mapping; keep unknown sources unknown.
- Implement an ORAP alert center with fingerprint, severity, scope, occurrence count, owner, acknowledgment, remediation, and resolution.
- Send only policy-defined urgent alerts through an email adapter, deduplicated against the alert lifecycle. Production email waits for the channel-specific R-008 recipient and delivery proof.
- R-008 selects Resend for critical operational email. ORAP remains authoritative for all
  alerts. The verified free-tier configuration uses `updates.omnireach.cloud`, approved
  senders `auth@`, `alerts@`, and `forms@` on that domain, a $0 budget, and up to three
  exponential-backoff alert retries. Every send first reads account-wide provider usage
  and atomically reserves against the lower of provider and internal hard limits,
  currently 100/day and 3,000/month. Urgent alerts still require a final approved
  recipient and successful test. Provider failure never affects public website
  availability.

## Alternatives considered

1. **Shared unverified Google property mapping:** rejected due cross-tenant and data-integrity risk.
2. **Store tokens in site/browser config:** rejected because tokens are server-only secrets.
3. **Show missing metrics as zero:** rejected as misleading.
4. **Send every occurrence by email:** rejected due flooding and incident fatigue.
5. **Infer all AI traffic/mentions as rankings:** rejected because attribution and sampled observations have limitations.

## Consequences

- R-006 supplies jurisdictions/legal/consent/deletion policy; R-007 supplies OAuth project/properties/permissions; R-008 supplies email provider/recipients/spend.
- Integrations can be disconnected/revoked without affecting public site availability.
- Reports distinguish work performed, measured impact, proxy completeness, referral traffic, and sampled mentions.

## Validation

G22 alert/email lifecycle, G27 OAuth/property/metric tests, G28 reporting fixtures, and
G30 replay/privacy/permissions tests prove the decision. On 2026-10-15, controlled
messages from the approved authentication and alert identities were provider-confirmed
delivered to the approved test recipient and recorded as sent without message content.
Automated urgent delivery remains off until its final recipient is approved.
