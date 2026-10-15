# Google production verification — 2026-10-15

Status: in progress; this record distinguishes verified provider/API evidence from evidence that still requires an authenticated employee browser session.

## Scope and method

The review covered the production Google connections, worker execution, stored reporting data, configured property mappings, collection bounds, and failure behavior. No missing or empty values are treated as successful collection. Provider data was queried through OmniReach's authorized read-only Google integrations. A visual comparison to the Google Analytics and Search Console web consoles remains pending because no verified employee session was available in the controlled browser.

## Connection inventory

| Website                 | Integration    | Mapped property                           | Evidence                                      | Status before repair                     |
| ----------------------- | -------------- | ----------------------------------------- | --------------------------------------------- | ---------------------------------------- |
| Coop's Mobile Detailing | GA4            | `properties/558804599`                    | Production connection and Google API response | Error after the 2026-10-15 scheduled run |
| Coop's Mobile Detailing | Search Console | `sc-domain:coopsmobiledetailingaledo.com` | Production connection and Google API response | Error after the 2026-10-15 scheduled run |
| OmniReach               | GA4            | No connection                             | Production connection inventory               | Disconnected; no metrics claimed         |
| OmniReach               | Search Console | No connection                             | Production connection inventory               | Disconnected; no metrics claimed         |

Both Coop connections use the approved read-only scopes. Their OAuth credentials remained encrypted at rest and the access token refreshed successfully during the review.

## Source collection evidence

For the inclusive source window 2026-10-07 through 2026-10-14:

- GA4 returned three source/medium rows and nine metric points. The response reported `totalRows=3`, so this response was complete and not truncated.
- Search Console returned one property-level row and four metric points. Query and page datasets each returned zero rows. Those two dimensions are verified empty for the reviewed window; they are not reported as a collection success containing query/page detail.
- No provider result reached the worker's 100,000-row per-dataset pagination ceiling.

Before repair, stored production reporting data contained only the GA4 sessions, active-users, and screen-page-view metrics for 2026-10-13. Search Console data for the reviewed connection was absent.

## Execution diagnosis

Two `metrics_sync` jobs succeeded on 2026-10-14. The scheduled 2026-10-15 job failed with PostgreSQL error `42P08` because the connection identifier was inferred as both UUID and text in one insert statement. A second retry defect caused connections marked `error` or `partial` to be excluded from later collection attempts.

The repository repair:

1. assigns the connection parameter an explicit UUID type before hashing and insertion; and
2. permits retry collection for `connected`, `error`, and `partial` states while still excluding stopped or revoked connections.

Automated tests cover both conditions. Production post-deployment execution and stored/source equality are recorded only after the repaired release runs.

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
- The repaired production `metrics_sync` must finish successfully, after which stored metric counts and totals must be compared with a fresh provider response for the same closed window.
- OmniReach's own GA4 and Search Console properties must be connected before collection for that site can be verified.
