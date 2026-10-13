# Coop managed-field mapping

Values live in revision `content`; protected values live in `facts_snapshot` under their
`factRef`. All values pass central normalization and Coop shape validation, falling back
to approved baked values when invalid.

| Field                    | Render target                               | Permission             |
| ------------------------ | ------------------------------------------- | ---------------------- |
| `home.heading`           | home H1                                     | owner/editor           |
| `home.intro`             | sanitized home introduction                 | owner/editor           |
| `home.hero-image`        | hero media/alt                              | owner/editor           |
| `home.primary-cta-label` | primary call button                         | owner/editor           |
| `home.highlights.items`  | trust cards                                 | owner/editor           |
| `home.section-order`     | homepage visual order                       | owner/editor           |
| `home.goal.visible`      | goal visibility fact                        | platform fact workflow |
| `home.goal.values`       | goal amounts fact                           | platform fact workflow |
| `services.descriptions`  | service cards/includes/media                | owner/editor           |
| `services.prices`        | prices/schema fact                          | platform fact workflow |
| `services.addons`        | add-on list fact                            | platform fact workflow |
| `portfolio.items`        | title/caption/alt/category/order/visibility | owner/editor           |
| `portfolio.images`       | gallery image/thumbnail pairs               | owner/editor           |
| `about.story`            | sanitized About fact                        | platform fact workflow |
| `faq.items`              | FAQ fact list                               | platform fact workflow |
| `contact.phone`          | call/text/schema fact                       | platform fact workflow |
| `contact.service-areas`  | area copy/schema fact                       | platform fact workflow |
| `privacy.content`        | privacy fact                                | platform fact workflow |
| `site.metadata`          | per-route metadata                          | owner/editor           |
| `site.theme`             | layout theme                                | owner only             |

Protected fields grant only platform roles and use `aiMode=disabled`. The baseline must be
reviewed before `factsReviewed=true`; the first-car goal defaults hidden. Validation
covers bounds, sanitized rich text, URL schemes/phone, image references/alt text,
metadata, unique stable order IDs, approved themes, booleans, and card shapes. Remaining
proof is an exhaustive generated-artifact test and uploaded-asset publication test.
