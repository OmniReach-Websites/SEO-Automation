# ORAP

**Status:** G07 accessible administration shell and service/API contract implemented locally.

The current server-rendered shell lists authorized sites and links to staff workflows. Tenant/site and customer-access mutations are implemented through transaction/audit service boundaries and API routes; credentials and invitation tokens are never rendered.

ORAP uses the shared OmniReach dark brand system: `#0b1820` canvas, the approved `#336699`, `#86bbd8`, `#2f4858`, `#9ee493`, and `#daf7dc` palette, and the exact logo asset from `sites/omnireach/public/omnireach-logo.png`. The theme covers authentication, security, portfolio, staff, and operations pages without changing customer-admin branding.

Validate with `npm run verify:goal -- G07`. Roll back by disabling ORAP mutation routes while preserving identities and audit records. A production hostname, owner bootstrap, and live staff access remain gated by G31.
