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

State, nonce and PKCE material are short-lived and one-use. Tokens are encrypted with tenant/site-bound authenticated encryption. Refresh and provider calls use bounded retry/backoff. The runner receives only an opaque tenant/site job envelope, rehydrates connected properties under worker RLS, reads the preceding eight days (to absorb delayed Google data), and inserts snapshots idempotently by canonical source hash. GA4 and Search Console remain separate sources.

Reports show source, window, last refresh, availability and caveats. Search Console clicks/impressions/CTR/position are not interchangeable with GA4 sessions/users. AI-referral classifications are mapped observations, not proof of ranking or citation.

Disconnect immediately stops collection, revokes the provider token when possible and marks retained metrics subject to the approved retention/deletion policy. A failed provider revocation is visible for follow-up; it does not pretend success.

## Test and activation state

Fixture tests cover redirect allowlisting, callback replay, scopes, token encryption, exact property mapping, quota retries, pagination/normalization, schema/RLS and route authorization. Real integration remains **Waiting** on project credentials, consent configuration and owner-authorized properties. Never replace that state with synthetic measurements.
