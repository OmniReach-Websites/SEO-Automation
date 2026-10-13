# Repeatable Site Onboarding

Use `tooling/site-onboarding.ts` for new manifest-backed tenants. Coop's specialized tool remains compatible; new work should use the generic path.

## Inputs

Create an ignored JSON file containing tenant/site names, repository `sourcePath`, public/admin hostnames, approved plan code/version, field content keyed by manifest field ID, owner-reviewed facts keyed by manifest fact ID, and optional owner email/invitation output. Do not put passwords, API keys or provider tokens in it. Set host verification flags only after independent DNS/TLS evidence.

## Procedure

1. Review customer identity, authority, protected facts, content, media licenses, form purpose/recipient/consent and Google intent.
2. Validate/build the site manifest and static project.
3. On a migrated disposable/staging database, run:

   `npm run site:onboard -- --config <ignored-config.json>`

4. Run the exact command again. It must reconcile the same tenant/site/domains/plan/pages/fields/revision instead of creating duplicates.
5. Run `npm run site:readiness -- --config <ignored-config.json> --check-dns`. `blocked` prevents launch; `waiting` identifies optional/external actions; `warning` needs review but is not synthetic success.
6. Deliver the one-time owner invitation through the approved auth channel. The optional invitation file is mode-restricted and must be deleted from the operator workstation after delivery; never print the token.
7. Exercise owner sign-in/security, draft → preview → publish → restore, role isolation, form delivery if enabled, crawl/SEO scheduling and reports.
8. Verify workers, backup recovery point, DNS/TLS and monitoring, then complete the release gate and obtain launch authorization.

## Idempotency and safety

The tool resolves conflicts by source path and both hostnames, locks domain ownership, uses exact plan version, maps fields through component/route identity and seeds revision 1 only when no revision exists. Reviewed facts are insert-only. A new form is disabled pending verified delivery and policy. Existing foreign host assignments or ambiguous records fail closed. Readiness does not change state and outputs identifiers/status only, never secrets.

## Required evidence for a real second tenant

- approved identity, facts/content, legal/form decisions and plan;
- isolated first and repeated onboarding reports;
- manifest/build/SEO/accessibility checks;
- customer Owner/Editor/Viewer and cross-tenant denial;
- draft/preview/publish/restore with immutable artifacts;
- verified public/admin DNS/TLS and exact-host auth;
- worker/schedule/alert evidence;
- current encrypted off-site backup and disposable restore;
- Google state explicitly connected or Waiting; AI explicitly Disabled or owner-approved.

No real second customer is authorized by the repository fixture; that production demonstration remains **Waiting**.
