-- Drafts are retained as evidence, while exactly one mutable active draft may
-- exist for a tenant/site. Older duplicates are archived deterministically
-- before the database starts enforcing the invariant.
ALTER TABLE content_drafts
  ADD COLUMN state varchar(20) NOT NULL DEFAULT 'active',
  ADD COLUMN archived_at timestamptz(3),
  ADD COLUMN archive_reason varchar(80);

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, site_id
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS active_rank
    FROM content_drafts
   WHERE state = 'active'
)
UPDATE content_drafts AS draft
   SET state = 'archived',
       archived_at = now(),
       archive_reason = 'migration_duplicate',
       updated_at = now()
  FROM ranked
 WHERE ranked.id = draft.id
   AND ranked.active_rank > 1;

ALTER TABLE content_drafts
  ADD CONSTRAINT content_drafts_state_check
    CHECK (state IN ('active', 'archived')),
  ADD CONSTRAINT content_drafts_archive_state_check
    CHECK (
      (state = 'active' AND archived_at IS NULL AND archive_reason IS NULL)
      OR
      (state = 'archived' AND archived_at IS NOT NULL AND archive_reason IS NOT NULL)
    ),
  ADD CONSTRAINT content_drafts_base_revision_fkey
    FOREIGN KEY (tenant_id, site_id, base_revision)
    REFERENCES content_revisions(tenant_id, site_id, revision)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX one_active_content_draft_per_site
  ON content_drafts (tenant_id, site_id)
  WHERE state = 'active';

CREATE INDEX content_drafts_archive_idx
  ON content_drafts (tenant_id, site_id, archived_at DESC)
  WHERE state = 'archived';

CREATE OR REPLACE FUNCTION preserve_content_draft_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'content draft history cannot be deleted';
  END IF;
  IF OLD.state = 'archived' THEN
    RAISE EXCEPTION 'archived content drafts are immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER content_drafts_preserve_history
BEFORE UPDATE OR DELETE ON content_drafts
FOR EACH ROW EXECUTE FUNCTION preserve_content_draft_history();

REVOKE DELETE ON content_drafts FROM omnireach_app;

COMMENT ON COLUMN content_drafts.state IS
  'Lifecycle state: one mutable active draft per tenant/site; archived drafts are immutable evidence.';
COMMENT ON COLUMN content_drafts.archive_reason IS
  'Non-secret reason explaining why the draft left the active editing lifecycle.';
