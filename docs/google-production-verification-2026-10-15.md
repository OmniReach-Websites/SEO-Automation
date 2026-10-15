# Google production verification — 2026-10-15

Status: provider/API and production-worker path verified; independent source-console comparison remains pending. This record distinguishes those evidence levels.

## Scope and method

The review covered the production Google connections, worker execution, stored reporting data, configured property mappings, collection bounds, and failure behavior. No missing or empty values are treated as successful collection. Provider data was queried through OmniReach's authorized read-only Google integrations. A visual comparison to the Google Analytics and Search Console web consoles remains pending because no verified employee session was available in the controlled browser.

## Connection inventory

| Website                 | Integration    | Mapped property                           | Evidence                                      | Final status                              |
| ----------------------- | -------------- | ----------------------------------------- | --------------------------------------------- | ----------------------------------------- |
| Coop's Mobile Detailing | GA4            | `properties/558804599`                    | Production connection and Google API response | Connected; synced 2026-10-15 08:59:20 UTC |
| Coop's Mobile Detailing | Search Console | `sc-domain:coopsmobiledetailingaledo.com` | Production connection and Google API response | Connected; synced 2026-10-15 08:59:20 UTC |
| OmniReach               | GA4            | No connection                             | Production connection inventory               | Disconnected; no metrics claimed          |
| OmniReach               | Search Console | No connection                             | Production connection inventory               | Disconnected; no metrics claimed          |

Both Coop connections use the approved read-only scopes. Their OAuth credentials remained encrypted at rest and the access token refreshed successfully during the review.

## Source collection evidence

For the inclusive source window 2026-10-07 through 2026-10-14:

- GA4 returned three source/medium rows and nine metric points. The response reported `totalRows=3`, so this response was complete and not truncated.
- Search Console returned one property-level row and four metric points. Query and page datasets each returned zero rows. Those two dimensions are verified empty for the reviewed window; they are not reported as a collection success containing query/page detail.
- No provider result reached the worker's 100,000-row per-dataset pagination ceiling.

Before repair, stored production reporting data contained only the GA4 sessions, active-users, and screen-page-view metrics for 2026-10-13. Search Console data for the reviewed connection was absent. After repair, the controlled production run succeeded and persisted the Google response:

- GA4 stored the three metrics for the three returned source/medium rows. Unchanged points were idempotently retained; changed or new points were updated with the run's ingestion timestamp.
- Search Console stored clicks, impressions, CTR, and position at property grain for 2026-10-12. All four values were zero. No query/page rows were invented.
- Both connection cursors record `complete=true`; GA4 records three of three rows, and Search Console records one property row plus zero query and page rows.

The stored table still contains older dimension rows from a prior successful window when a later complete provider response omits that dimension. Current upsert behavior does not remove an omitted old row. Therefore provider response completeness and successful persistence are verified, but aggregate equality over mutable historical windows is not independently established and must not be represented as source-console equality.

## Execution diagnosis

Two `metrics_sync` jobs succeeded on 2026-10-14. The scheduled 2026-10-15 job failed with PostgreSQL error `42P08` because reused prepared-statement parameters were inferred as conflicting UUID/text and text/varchar types. A second retry defect caused connections marked `error` or `partial` to be excluded from later collection attempts.

The repository repair:

1. assigns explicit database types to every reused metric and connection-status parameter; and
2. permits retry collection for `connected`, `error`, and `partial` states while still excluding stopped or revoked connections.

Automated tests cover both conditions. Production release `906d1cdcbb86fd2e5bcc45aa674a27568711d20f` completed its immutable deployment and health checks. The controlled `metrics_sync` job then succeeded in about two seconds, with both mappings restored to `connected` and no safe error recorded.

## Time and completeness semantics

- The scheduled worker requests an inclusive eight-day window ending on the previous UTC calendar day.
- GA4 interprets the date dimension in the connected property's configured time zone.
- Search Console dates follow Google's Search Console reporting-date semantics, which can lag and use Pacific time.
- OmniReach currently stores source dates as UTC day boundaries. Users must not compare a still-open provider day to these closed daily rows.
- GA4 is grouped by date, source, and medium. Search Console uses property date, date/query, and date/page datasets.
- A provider page cap marks the collection incomplete; it is never silently treated as complete.

## Still requiring independent evidence

- An authenticated employee must compare the exact 2026-10-07 through 2026-10-14 totals and dimensions in the GA4 and Search Console web consoles.
- The GA4 property time zone must be recorded from the source console and compared with the ORAP display.
- Replacement semantics for dimension rows omitted by a later complete provider response must be designed and tested before ORAP aggregates can be certified equal to mutable historical source totals.
- OmniReach's own GA4 and Search Console properties must be connected before collection for that site can be verified.
