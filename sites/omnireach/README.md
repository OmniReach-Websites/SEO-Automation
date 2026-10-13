# OmniReach public site

Production marketing site for `https://omnireach.cloud`.

The site is a static Astro build served by the production static-site container. Its contact form posts only to the bounded same-origin platform inquiry endpoint, which resolves active Platform Owner recipients at submission time and sends through the verified `RESEND_CONTACT_FROM` address.

The public legal pages are `/privacy/` and `/tos/`. Their manifest fields are protected, owner-editable legal facts with AI editing disabled.

The public site uses the approved transparent logo at `public/omnireach-logo.png` and the brand palette `#336699`, `#86bbd8`, `#2f4858`, `#9ee493`, and `#daf7dc`. All public routes share the dark color scheme in `src/styles/global.css`.

Build locally with `npm run build --workspace @omnireach/site-omnireach`.
