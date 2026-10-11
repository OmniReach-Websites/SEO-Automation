# Content Package

**Status:** Local G11–G13 content, protected-fact, media, and contact primitives implemented.

Provides optimistic draft updates, rich-text/link validation, protected fact-token enforcement, proposal transitions, immutable restore-as-new revisions, audited human fact edits, streamed/validated site-isolated image storage, delayed garbage-collection policy, and bounded contact submission validation.

AI may update only AUTO fields and can never modify protected fields/tokens. Validate with `npm run verify:goal -- G11`, `G12`, and `G13`. Rollback preserves stored originals/revisions and restores a prior published artifact.
