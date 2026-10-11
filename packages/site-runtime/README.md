# Site runtime

Build-time helpers that let fully custom static sites consume an immutable OmniReach content snapshot without sharing a visual template or accepting runtime writes.

`ContactForm.astro` is the optional reusable public form surface. It posts to the single
centralized OmniReach submission endpoint, includes the honeypot and Turnstile widget,
and obtains only its public enabled state and Turnstile site key from the same-host API.
It fails visibly closed when that configuration is unavailable. A site contract, verified
recipient, per-site ORAP enablement, and approved consent wording are still required before
delivery can be activated.
