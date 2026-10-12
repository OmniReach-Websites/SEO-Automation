# Coop's Mobile Detailing

**Status:** Production-quality static customer test site; production activation remains blocked on owner confirmation and OmniReach registration.

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

The real work photos in `public/images/` are optimized derivatives of images already publicly displayed by that site. They should still receive final owner approval before a new production release.

## Required confirmation before production

- Confirm the current phone number and Instagram profile.
- Confirm starting prices: Exterior $60, Interior $100, Full Detail $120.
- Confirm service areas and the water/electricity, timing, weather, pet-hair, and pricing policies.
- Confirm the website may reuse all supplied work photos and their captions.
- Confirm the intended production hostname. The current verified Vercel URL is used for canonical metadata until that decision changes.
- Supply and approve final privacy wording. The included page is explicitly marked as a draft and is `noindex`.
- Verify a current first-car savings amount before enabling `home.goal.visible`; the component intentionally renders nothing without an approved amount.
- Register the site/customer/hostname in OmniReach before attempting production deployment.

## OmniReach content policy

The `site.manifest.json` declares stable components, routes, editable marketing fields, protected facts, and AI modes. Prices, contact information, service areas and policies, story facts, financial progress, and legal text are protected with `aiMode: disabled`. The static pages consume the supported content snapshot for the homepage heading and introduction. The remaining declared fields are ready for the central content system once its structured collection support is connected; the customer site does not write source files or run an admin backend.

Production deployment uses the repository's protected, main-branch OmniReach workflow. The workflow is default-off and its presence does not prove VPS credentials, hostname registration, environment authorization, health checks, or rollback approval are configured.
