CREATE TABLE deployment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commit_sha varchar(64) NOT NULL CHECK (commit_sha ~ '^[a-f0-9]{40}([a-f0-9]{24})?$'),
  artifact_hash char(64) NOT NULL CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
  actor varchar(200) NOT NULL,
  target varchar(120) NOT NULL CHECK (target <> 'production'),
  migration_version varchar(100) NOT NULL,
  outcome varchar(30) NOT NULL CHECK (outcome IN ('staged','activated','failed','rolled_back')),
  previous_release varchar(64),
  safe_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz(3) NOT NULL,
  completed_at timestamptz(3)
);
CREATE INDEX deployment_events_target_started_idx ON deployment_events (target, started_at);

GRANT SELECT, INSERT, UPDATE ON deployment_events TO omnireach_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON deployment_events TO omnireach_platform;

CREATE OR REPLACE FUNCTION prevent_deployment_event_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'deployment history cannot be deleted'; END $$;
CREATE TRIGGER deployment_event_no_delete BEFORE DELETE ON deployment_events
FOR EACH ROW EXECUTE FUNCTION prevent_deployment_event_delete();
