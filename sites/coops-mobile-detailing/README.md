# Coop's Mobile Detailing

**Status:** Approved production static site for `https://coopsmobiledetailingaledo.com`.

Astro site for Coop's Mobile Detailing, a mobile automotive detailing business based in Aledo, Texas. This is the authoritative source under the OmniReach monorepo's `sites/` workspace. It does not contain a booking flow, form processor, customer account system, payment flow, database, or independent backend.

## Local commands

From the repository root:

```powershell
npm run build --workspace @omnireach/site-coops-mobile-detailing
npm run validate:sites -- sites/coops-mobile-detailing/site.manifest.json
npm run check:site-builds
```

For a local preview:

```powershell
npm run dev --workspace @omnireach/site-coops-mobile-detailing -- --host 127.0.0.1
```

## Verified reference material

The phone number, Instagram profile, published service areas, existing service packages, current starting prices, FAQs, Cooper's first-car story, and work photos were recovered from the existing public reference site at `https://coopsmobiledetailing.vercel.app/` on 2026-10-12.

The real work photos in `public/images/` are optimized derivatives of images already publicly displayed by that site. Their reuse was approved with the production launch on 2026-10-12.

## Production approval

The owner approved the site content, service information, photos, and production launch on 2026-10-12. The canonical production hostname is `coopsmobiledetailingaledo.com`; `www.coopsmobiledetailingaledo.com` redirects to the canonical hostname. The first-car savings component remains disabled until a current amount is supplied.

## OmniReach content policy

The `site.manifest.json` declares stable components, routes, editable marketing fields, protected facts, and AI modes. Prices, contact information, service areas and policies, story facts, financial progress, and legal text are protected with `aiMode: disabled`. The static pages consume the supported content snapshot for the homepage heading and introduction. The remaining declared fields are ready for the central content system once its structured collection support is connected; the customer site does not write source files or run an admin backend.

Production deployment uses the repository's protected, main-branch OmniReach workflow. The immutable runtime release includes the static site service and installs its host-exact shared-Caddy route with rollback-safe validation.
