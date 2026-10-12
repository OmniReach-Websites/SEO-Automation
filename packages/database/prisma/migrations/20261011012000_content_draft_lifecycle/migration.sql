-- Keep the legacy relation name as an automatically updatable active-only view.
-- This lets the preceding application release continue to use its unqualified
-- INSERT/SELECT/UPDATE/FOR UPDATE statements after a code rollback without
-- exposing retained archived drafts as mutable work.
ALTER TABLE content_drafts RENAME TO content_draft_records;

ALTER TABLE content_draft_records
  ADD COLUMN state varchar(20) NOT NULL DEFAULT 'active',
  ADD COLUMN archived_at timestamptz(3),
  ADD COLUMN archive_reason varchar(80);

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, site_id
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS active_rank
    FROM content_draft_records
   WHERE state = 'active'
)
UPDATE content_draft_records AS draft
   SET state = 'archived',
       archived_at = now(),
       archive_reason = 'migration_duplicate',
       updated_at = now()
  FROM ranked
 WHERE ranked.id = draft.id
   AND ranked.active_rank > 1;

ALTER TABLE content_draft_records
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
  ON content_draft_records (tenant_id, site_id)
  WHERE state = 'active';

CREATE INDEX content_drafts_archive_idx
  ON content_draft_records (tenant_id, site_id, archived_at DESC)
  WHERE state = 'archived';

CREATE OR REPLACE FUNCTION preserve_content_draft_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'content draft history cannot be deleted';
  END IF;
  IF OLD.state = 'archived' THEN
    RAISE EXCEPTION 'archived content drafts are immutable';
  END IF;
  IF OLD.state = 'active' AND NEW.state = 'archived' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.base_revision IS DISTINCT FROM OLD.base_revision
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'archiving cannot rewrite content draft evidence';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER content_drafts_preserve_history
BEFORE UPDATE OR DELETE ON content_draft_records
FOR EACH ROW EXECUTE FUNCTION preserve_content_draft_history();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnireach_draft_view') THEN
    CREATE ROLE omnireach_draft_view
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE omnireach_draft_view
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

GRANT USAGE, CREATE ON SCHEMA public TO omnireach_draft_view;
GRANT SELECT, INSERT, UPDATE ON content_draft_records TO omnireach_draft_view;
REVOKE ALL ON content_draft_records FROM PUBLIC;
REVOKE ALL ON content_draft_records FROM omnireach_app, omnireach_worker;

-- A security-invoker view would require granting its callers direct privileges on
-- content_draft_records. Instead this narrowly privileged, NOLOGIN/NOBYPASSRLS
-- owner keeps the base table inaccessible while FORCE RLS still evaluates the
-- caller-supplied tenant/site transaction context.
CREATE VIEW content_drafts
WITH (security_barrier = true)
AS
SELECT id, tenant_id, site_id, base_revision, version, content,
       state, archived_at, archive_reason, created_by, created_at, updated_at
  FROM content_draft_records
 WHERE state = 'active';

ALTER VIEW content_drafts OWNER TO omnireach_draft_view;
REVOKE CREATE ON SCHEMA public FROM omnireach_draft_view;

REVOKE ALL ON content_drafts FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON content_drafts TO omnireach_app, omnireach_worker;
REVOKE DELETE ON content_drafts FROM omnireach_app, omnireach_worker;

COMMENT ON VIEW content_drafts IS
  'Rollback-compatible active-only draft relation; archived evidence remains in content_draft_records.';
COMMENT ON COLUMN content_draft_records.state IS
  'Lifecycle state: one mutable active draft per tenant/site; archived drafts are immutable evidence.';
COMMENT ON COLUMN content_draft_records.archive_reason IS
  'Non-secret reason explaining why the draft left the active editing lifecycle.';
