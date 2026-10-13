# ORAP dark-brand design QA

- Source visual truth: `test-results/design-qa/source-public-brand-desktop.png`
- Approved source logo: `C:/Users/Ryan/Downloads/OMNIREACH LOGO.png`
- Desktop implementation: `test-results/design-qa/implementation-orap-sites-desktop.png`
- Mobile implementation: `test-results/design-qa/implementation-orap-sites-mobile.png`
- Combined comparison: `test-results/design-qa/comparison-public-and-orap-desktop.png`
- Desktop viewport and pixels: 1440 × 1000 CSS pixels, device scale factor 1, 1440 × 1000 PNGs
- Mobile viewport: 390 × 844 CSS pixels, device scale factor 1; full-page implementation capture
- State: authenticated Platform Owner, customer-sites list with one active managed site

## Scope normalization

The public homepage and ORAP are different products and cannot have identical information architecture. The side-by-side comparison therefore treats the approved public site as the visual source of truth for logo fidelity, palette, dark surfaces, type color, emphasis, borders, and button treatment. ORAP's sidebar, dense tables, and operational controls remain intentionally application-specific.

## Full-view comparison evidence

- Fonts and typography: both screens use the same system sans-serif direction, pale-green display text, blue secondary copy, and compact uppercase green/blue eyebrow labels. ORAP deliberately uses smaller, denser UI type than the marketing page.
- Spacing and layout rhythm: the desktop sidebar, top bar, metric cards, table, and actions form a consistent admin grid without document overflow. Panels use the same restrained radius and low-contrast boundary language as the public site.
- Colors and visual tokens: the rendered ORAP page uses `#0b1820` for the canvas and the approved `#336699`, `#86bbd8`, `#2f4858`, `#9ee493`, and `#daf7dc` palette for navigation, borders, actions, and text.
- Image quality and asset fidelity: the exact 1000 × 1000 transparent OmniReach PNG is used in ORAP. Its natural browser width is 1000 pixels; no text, SVG, CSS drawing, or placeholder replaces it.
- Copy and content: existing ORAP labels and operational explanations are preserved. No marketing copy was inserted into authenticated management screens.

## Focused responsive evidence

The 390-pixel implementation capture verifies the metric cards, managed-site table, logo, and primary action. The document width equals the viewport width. The `Open site` action occupies x=273.47 through x=348.61 and is fully visible within the 390-pixel viewport.

## Findings

No actionable P0, P1, or P2 visual differences remain within the brand-transfer scope.

P3 follow-up: the mobile navigation remains horizontally scrollable so every authorized section stays reachable without collapsing navigation into JavaScript-dependent controls. This is an acceptable progressive-enhancement tradeoff.

## Comparison history

1. Initial mobile pass found a P2 usability issue: the `Open site` action began at x=388.33 and extended beyond the 390-pixel viewport inside the table scroller.
2. The managed-site table received a dedicated responsive treatment: the redundant tenant column is hidden at the narrow breakpoint, cell padding is reduced, and the action size is tightened.
3. Post-fix capture shows the action fully visible at x=273.47–348.61, no document overflow, and unchanged desktop hierarchy.

## Primary interactions and browser diagnostics

- Opened the customer-sites list.
- Activated `Open site` and reached the selected site's management view.
- Confirmed the active publication status rendered as `Published static site available`.
- Confirmed the exact logo loaded and the theme-color metadata is `#0b1820`.
- Checked browser warning/error logs after navigation: none.

## Implementation checklist

- Shared dark brand tokens applied to ORAP and authentication surfaces.
- Exact logo and favicon served from the existing approved asset.
- Desktop and mobile layouts verified.
- Primary site-management action verified end to end.
- Restricted database read permission covered by an automated security regression test.

final result: passed
