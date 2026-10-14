# OmniReach Architecture Decision Records

ADRs record approved architecture decisions. Accepted ADRs are not reopened casually; a change requires a new superseding ADR that explains migration, compatibility, security, data, and rollback consequences.

## Status vocabulary

- `Accepted`: approved and binding for implementation.
- `Superseded`: retained for history and linked to its replacement.
- `Deprecated`: still present but prohibited for new work.

## ADR index

| ADR                                                                                                             | Status   | Decisions covered          |
| --------------------------------------------------------------------------------------------------------------- | -------- | -------------------------- |
| [0001 — Sources of truth and repository boundaries](0001-sources-of-truth-and-repository-boundaries.md)         | Accepted | D-017, D-024               |
| [0002 — Tenant isolation and data scoping](0002-tenant-isolation-and-data-scoping.md)                           | Accepted | D-004, D-005, D-006, D-023 |
| [0003 — Authentication and domain-scoped sessions](0003-authentication-and-domain-scoped-sessions.md)           | Accepted | D-001, D-002, D-003, D-006 |
| [0004 — Site integration contract and custom designs](0004-site-integration-contract-and-custom-designs.md)     | Accepted | D-007, D-008, D-020        |
| [0005 — Static publication, previews, and contact forms](0005-static-publication-previews-and-contact-forms.md) | Accepted | D-009, D-010, D-020        |
| [0006 — GitHub Actions/SSH deployment and external routing](0006-github-actions-ssh-deployment-and-routing.md)  | Accepted | D-012, D-013, D-014        |
| [0007 — AI policy, budgets, and AIO measurement](0007-ai-policy-budgets-and-aio-measurement.md)                 | Accepted | D-008, D-015, D-022        |
| [0008 — Media storage, backup, and retention](0008-media-storage-backup-and-retention.md)                       | Accepted | D-011, D-016, D-017, D-023 |
| [0009 — Privacy, Google integrations, and alerts](0009-privacy-google-integrations-and-alerts.md)               | Accepted | D-018, D-019, D-021, D-022 |
| [0010 — ORAP staff authorization and owner-only administration](0010-orap-staff-authorization.md)               | Accepted | D-006 refinement           |

## Decision disposition and ownership

`Affected goals` are implementation targets, not unresolved blockers. `Remaining input` points to the owner-supplied production value in the roadmap; `None` means the architecture is fully determined for local implementation.

| ID    | Disposition                           | Decision owner             | ADR              | Affected goals        | Remaining input                         |
| ----- | ------------------------------------- | -------------------------- | ---------------- | --------------------- | --------------------------------------- |
| D-001 | Approved; V1 hostname supplied        | OmniReach owner            | 0003             | G01, G17–G19, G31–G32 | None                                    |
| D-002 | Approved; production owner supplied   | OmniReach owner            | 0003             | G05, G07, G31–G32     | None                                    |
| D-003 | Approved                              | Architecture               | 0003             | G05, G14              | None                                    |
| D-004 | Approved                              | Security architecture      | 0002             | G04, G06              | None                                    |
| D-005 | Approved; four-tier proposal selected | OmniReach owner            | 0002             | G04, G08, G21         | R-011 final approval/definitions        |
| D-006 | Approved                              | OmniReach owner            | 0002, 0003       | G05–G08, G14–G16      | None                                    |
| D-007 | Approved                              | Architecture               | 0004             | G09, G11, G15–G16     | None                                    |
| D-008 | Approved                              | OmniReach owner/security   | 0004, 0007       | G11, G26              | None                                    |
| D-009 | Approved                              | Architecture               | 0005             | G13, G16, G19, G31    | None                                    |
| D-010 | Approved                              | Security architecture      | 0005             | G13, G15              | None                                    |
| D-011 | Approved                              | Architecture               | 0008             | G12, G29              | R-005 for production target/key custody |
| D-012 | Approved                              | OmniReach owner/operations | 0006             | G03, G19, G31         | R-010                                   |
| D-013 | Approved                              | OmniReach owner/operations | 0006             | G18–G19, G29–G32      | R-003                                   |
| D-014 | Approved; provider authority supplied | OmniReach owner/operations | 0006             | G17–G18, G31–G32      | Per-change DNS authorization            |
| D-015 | Approved                              | OmniReach owner            | 0007             | G21, G25–G26          | R-012 for provider account/spend        |
| D-016 | Approved; R2 activation proof pending | OmniReach owner/operations | 0008             | G29, G31–G32          | R-005                                   |
| D-017 | Approved                              | Security architecture      | 0001, 0008       | G02, G09, G12, G19    | None                                    |
| D-018 | Approved; legal text pending          | OmniReach owner/legal      | 0009             | G27–G29, G32          | R-006                                   |
| D-019 | Approved; account permissions pending | Architecture/operations    | 0009             | G27–G28               | R-007                                   |
| D-020 | Approved                              | OmniReach owner            | 0004, 0005       | G09–G10, G13, G32     | R-009 for live forms                    |
| D-021 | Approved; Resend selected             | OmniReach owner/operations | 0009             | G22, G28–G32          | R-008                                   |
| D-022 | Approved                              | OmniReach owner/product    | 0007, 0009       | G24, G27–G28          | None                                    |
| D-023 | Approved                              | OmniReach owner/security   | 0002, 0008, 0009 | G11, G20, G22, G29    | R-006 for legal/site variants           |
| D-024 | Approved                              | OmniReach owner            | 0001             | G01–G02               | None                                    |

## Owner-input queue

R-001 through R-012 remain listed in [`../roadmap.md`](../roadmap.md). They are concrete production domains, credentials/custody, external account permissions, policies, or financial commitments. ADRs deliberately do not invent them.
