# OmniReach legal and privacy review package — 2026-10-15

> **DRAFT — NOT LEGAL ADVICE — NOT APPROVED FOR PUBLICATION**

This package compares the public `omnireach.cloud` language with the repository and the
verified production configuration as of 2026-10-15. Owner approval does not replace
qualified legal review. No draft in this package may be published merely because it is
committed.

## Reviewed public versions

| Public artifact               | Repository source                                                                                         | Version reviewed     | Status                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------- |
| Terms of Service              | `sites/omnireach/src/pages/tos.astro`                                                                     | effective 2026-10-13 | Published; public-website terms only              |
| Privacy Policy                | `sites/omnireach/src/pages/privacy.astro`                                                                 | effective 2026-10-12 | Published; incomplete against current providers   |
| Cookie choice                 | `sites/omnireach/src/components/AnalyticsConsent.astro` and `sites/omnireach/public/analytics-consent.js` | current commit       | Published; consent-mode implementation present    |
| Data deletion                 | no public page                                                                                            | none                 | Missing                                           |
| Public inquiry consent        | `sites/omnireach/src/components/ContactForm.astro`                                                        | current commit       | Activation approved; wording not legally approved |
| Customer contact-form consent | site-specific integration contracts                                                                       | none approved        | Forms must remain disabled                        |

## Behavior verified from code and production configuration

- The public Google tag is loaded with Consent Mode defaulting analytics storage to
  denied. A visitor choice is stored locally; accepting enables Analytics and declining
  attempts to remove first-party `_ga` cookies.
- The OmniReach inquiry component uses exact-origin checks, a honeypot, rate limiting,
  a consent checkbox, and Cloudflare Turnstile. The owner approved production activation
  on 2026-10-15 after reporting the Turnstile keys installed. Customer-form delivery
  remains disabled behind its independent activation gate.
- When platform inquiries are activated, Resend sends one message to the active Platform
  Owner recipient list. The application does not persist the inquiry body in its own
  database, but provider and recipient mailboxes may retain it.
- Customer-site contact forms use a central tenant-scoped service, a 30-day application
  retention target, and site-specific recipients. They remain disabled until each
  recipient and consent configuration is approved.
- Google Search Console and GA4 OAuth integrations use read-only scopes and encrypted
  tokens. Connected customer metrics are stored for reporting. Public GA4 and the OAuth
  reporting integrations are distinct processing activities.
- Cloudflare is used or planned for DNS/proxying, Turnstile, and encrypted R2 backups;
  Resend for authentication and urgent alerts and, only when activated, form delivery;
  Google for Analytics/Search Console; GitHub for sanitized source; and OpenAI only after
  a separately gated activation. OpenAI is currently disabled.

## Material gaps and inconsistencies

1. The Privacy Policy describes the now-approved inquiry channel but does not specify a
   precise mailbox/provider retention period. It must not imply a successful submission
   when delivery is unavailable.
2. Provider disclosures are incomplete. Google Analytics is named, but Cloudflare,
   Resend, Google OAuth reporting, the hosting provider, encrypted backup storage, and a
   future activated OpenAI processor need purpose-specific treatment.
3. The policy does not identify the legal operator, mailing address, privacy contact,
   controlling jurisdiction, effective change-notice method, or the rights/process that
   actually apply. These require owner/legal input.
4. Retention is vague. It does not distinguish public inquiries in mailboxes, customer
   submissions (30 days unless held), OAuth tokens, derived metrics, authentication
   records, 30-day operational logs, 90-day job details, 12-month audit records,
   immutable content revisions, or encrypted 3-daily/1-weekly backups.
5. There is no public deletion-request procedure. Verification, authority, exceptions,
   backup aging, audit preservation, provider propagation, and response timing are not
   approved.
6. The cookie banner offers accept/decline but no durable preferences page, cookie table,
   named cookie lifetimes, or Global Privacy Control/Do Not Track position. Declining can
   remove accessible first-party cookies but cannot retract data already lawfully sent.
7. Contact consent does not disclose Resend/Cloudflare processing, recipient scope,
   mailbox retention, or whether the user should avoid sensitive information.
8. Public Terms are website-use terms, not the customer managed-service agreement. They
   correctly defer to a written agreement, but the newly approved month-to-month pricing,
   setup quote, possible quoted overage work, cancellation timing, and check/in-person
   payment rules are not yet captured in an approved customer agreement.
9. The current Terms contain broad warranty/liability language and Texas references that
   require legal review before they are treated as enforceable.
10. No customer form, AI processing disclosure, deletion timeline, or contractual service
    level should be promised before its operational and legal approval gates pass.

## Draft set

- `docs/legal-drafts/2026-10-15/public-website-terms-draft.md`
- `docs/legal-drafts/2026-10-15/privacy-notice-draft.md`
- `docs/legal-drafts/2026-10-15/cookie-notice-draft.md`
- `docs/legal-drafts/2026-10-15/data-deletion-procedure-draft.md`
- `docs/legal-drafts/2026-10-15/contact-form-consent-draft.md`
- `docs/legal-drafts/2026-10-15/managed-service-commercial-terms-draft.md`

## Owner approval checklist

- [ ] Confirm the exact legal entity/operator name, business mailing address, privacy
      contact, support contact, and notice email.
- [ ] Obtain qualified review for Texas/United States launch and decide whether other
      state, child-directed, accessibility, biometric/passkey, or sector-specific rules
      apply.
- [ ] Approve or amend each of the six draft files above by exact path and commit SHA.
- [ ] Approve a cookie inventory and retention table from observed production cookies,
      including GA4 lifetimes and the stance on GPC/Do Not Track.
- [ ] Approve deletion/export request verification, response target, exceptions, backup
      aging, security/audit preservation, and appeal/escalation rules.
- [ ] Name the VPS/hosting provider and approve all processor disclosures and relevant
      contracts/DPAs before publication.
- [ ] Approve the customer managed-service agreement, including billing due dates,
      refunds, taxes, scope changes, suspension, content rights, handoff/export, warranty,
      liability, and dispute terms. The commercial selections alone are insufficient.
- [ ] Keep public inquiries and all customer forms disabled until the matching consent,
      recipient, Turnstile, and retention configurations are approved and tested.
- [ ] Keep OpenAI disabled until its disclosure, data categories, retention controls,
      benchmark, and separate activation are approved.
- [ ] After approval, publish in a separately reviewed change and record effective date,
      approver, file hashes/commit, and rollback instructions.
