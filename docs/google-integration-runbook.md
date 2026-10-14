# Google Search Console and GA4 Runbook

## Owner setup checklist

1. Create or select the owner-controlled Google Cloud project.
2. Enable Search Console API, Analytics Admin API and Analytics Data API.
3. Configure the OAuth consent screen and truthful privacy/support links; complete any Google verification required for the chosen audience.
4. Create a Web application OAuth client. Register only the exact ORAP callback URI shown by the deployment; no wildcard redirects.
5. Put client ID, client secret and an independent 32-byte Google token-encryption key in approved host-only secret/config channels.
6. Leave `GOOGLE_INTEGRATION_ENABLED=false` until the release and callback are verified.
7. An authorized user starts consent in ORAP. Search Console requests `webmasters.readonly`; GA4 requests `analytics.readonly`.
8. Select only an eligible property whose public hostname exactly matches the site. Record the consenting actor, scopes and mapping.
9. Enable the `metrics_sync` schedule after a manual sync passes. Compare source console totals, property time zone and expected lag.

## Runtime behavior

State, nonce and PKCE material are short-lived and one-use. Tokens are encrypted with tenant/site-bound authenticated encryption. Refresh and provider calls use bounded retry/backoff. The runner receives only an opaque tenant/site job envelope, rehydrates connected properties under worker RLS, reads the preceding eight days (to absorb delayed Google data), and upserts snapshots idempotently by stable observation identity. That identity contains the connection, source, metric, canonical dimensions and UTC window; it deliberately excludes the value so a Google re-finalization replaces the prior observation instead of double counting it. GA4 and Search Console remain separate sources.

Reports show source, window, last refresh, availability and caveats. Search Console clicks/impressions/CTR/position are not interchangeable with GA4 sessions/users. AI-referral classifications are mapped observations, not proof of ranking or citation.

## ORAP analytics definitions

ORAP reads only persisted snapshots; opening or filtering the dashboard never triggers a
Google provider request. Standard 7-, 28- and 90-day windows end on the preceding UTC
day, while the stored date labels retain each provider's reporting calendar: Search
Console reports dates in Pacific Time and GA4 reports dates in the connected property's
configured time zone. Custom ranges are inclusive and limited to 90 days. The comparison
window is the immediately preceding, equal-length, non-overlapping set of source date
labels. Cross-source day boundaries may therefore differ and the dashboard says so.

- Search clicks and impressions are additive across stored Search Console rows.
- Search CTR is total clicks divided by total impressions. Row CTR values are never
  summed or averaged.
- Average position is weighted by impressions across stored observations and is labeled
  as aggregate evidence rather than a ranking promise.
- GA4 organic measurements include only rows whose normalized `sessionMedium` is
  `organic`, `organic search` or `organic_search`.
- Organic sessions and page views are additive. Active-user observations are daily
  values summed across source/medium rows and are explicitly not represented as a
  deduplicated period user count.
- All-channel sessions are shown only as context and remain separate from the organic
  session metric.
- Engagement rate and conversions/key events remain `unsupported` until the provider
  collector and persistence contract capture them. The dashboard must not display zero
  in place of unsupported data.
- `available`, `partial`, `stale`, `no_data`, `not_connected` and `unsupported` are
  distinct reporting states.

Top query and page tables are bounded and use server-side sort allowlists. Their click
delta compares the same row label with the immediately preceding equal-length period;
missing comparison evidence remains unavailable rather than zero. Search opportunities
are deterministic review prompts based on stored impressions, CTR and position. They do
not promise traffic or ranking changes. Work events are shown beside outcomes for context
and are labeled as correlation rather than causation.

The data-quality panel displays the exact connected property ID and verified mapping,
available persisted period, last successful sync, connection state and safe provider
failure code. Those identifiers are visible only after ORAP authorization for the site.
They must never be returned for a site outside the actor's capability scope.

Disconnect immediately stops collection, revokes the provider token when possible and marks retained metrics subject to the approved retention/deletion policy. A failed provider revocation is visible for follow-up; it does not pretend success.

## Test and activation state

Fixture tests cover redirect allowlisting, callback replay, scopes, token encryption,
exact property mapping, quota retries, pagination/normalization, stable observation
identity, schema/RLS, direct-object authorization, bounded aggregation, UTC windows,
provider calendar semantics, comparison rows, exact authorized property diagnostics,
empty/unsupported states and accessible responsive rendering. The owner has reported the
intended properties connected, but production reporting remains **Waiting** on a stored
first-sync reconciliation with those exact Google source consoles. Never replace that
state with synthetic measurements or OAuth-success evidence alone.
