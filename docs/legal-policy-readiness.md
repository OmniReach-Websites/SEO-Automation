# Privacy, Legal and Data-Flow Approval Checklist

This is an operational mapping for owner/legal review, not legal advice and not approved public text.

The dated review, discrepancy report, six unpublished drafts, and exact owner checklist
are in `docs/legal-review-package-2026-10-15.md` and
`docs/legal-drafts/2026-10-15/`. Those files are preparation material only; none is an
approved policy or authorization to publish.

| Data/activity          | Current technical behavior                                                                                                        | Policy decision still required                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Public inquiry         | bounded same-origin form, consent checkbox, Turnstile/rate/honeypot controls, encrypted delivery payload, active owner recipients | approved consent/privacy text and retention exceptions                        |
| Customer site forms    | manifest-declared and disabled by default; exact verified recipients required                                                     | site-specific recipient, purpose, fields, consent, confirmation and retention |
| Authentication         | Argon2id password, host-only session, hashed one-time codes/tokens, encrypted TOTP, exact-RP passkeys                             | user-facing notice and support identity process                               |
| Analytics              | Google read-only OAuth, exact property, encrypted tokens, clear disconnect                                                        | consent/cookie basis, retention, deletion/export and customer authorization   |
| AI provider            | disabled by default, approved facts only, sanitized evaluation metadata, proposal review                                          | provider terms/DPA, disclosure, retention and approved content categories     |
| Customer media/content | tenant/site-scoped, versioned publishing and isolated storage paths                                                               | ownership/license, export, deletion and post-cancellation retention           |
| Logs/audits            | redacted operational logs; immutable security/change evidence                                                                     | final retention and legal/security hold rules                                 |
| Backups                | encrypted 3-daily/1-weekly target; destructive pruning guarded                                                                    | approved retention, deletion propagation and incident/legal holds             |

Drafts requiring professional review: privacy notice, website/customer terms, service commitments/SLA wording, acceptable-use/content rights, form consent, Google permission notice, AI processing disclosure, deletion/export procedure, incident notice and cancellation/handoff terms.

Technical deletion/export must remain non-destructive and inactive until exact scope, authority, retention exceptions and backup behavior are approved. No unreviewed policy text or service guarantee may be published. The 99.5% availability, maintenance window, 24h RPO, 8h RTO and acknowledgement times are planning targets, not contractual guarantees.
