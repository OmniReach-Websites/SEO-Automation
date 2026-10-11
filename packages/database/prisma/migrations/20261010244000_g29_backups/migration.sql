CREATE TABLE backup_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind varchar(20) NOT NULL CHECK (kind IN ('daily','weekly','restore_test')),
  state varchar(30) NOT NULL CHECK (state IN ('creating','complete','failed','corrupt','pruned')),
  storage_ref varchar(500) NOT NULL, off_server_ref varchar(500), envelope_hash char(64) NOT NULL,
  key_version integer NOT NULL, byte_size bigint NOT NULL CHECK (byte_size >= 0), manifest jsonb NOT NULL,
  active boolean NOT NULL DEFAULT false, hold boolean NOT NULL DEFAULT false, created_at timestamptz(3) NOT NULL,
  verified_at timestamptz(3), off_server_copied_at timestamptz(3), restore_tested_at timestamptz(3), error_code varchar(100)
);
CREATE INDEX backup_records_created_kind_state_idx ON backup_records (created_at, kind, state);
GRANT SELECT, INSERT, UPDATE ON backup_records TO omnireach_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON backup_records TO omnireach_platform;

CREATE OR REPLACE FUNCTION guard_backup_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.active OR OLD.hold OR OLD.state <> 'complete' THEN RAISE EXCEPTION 'active, held, or incomplete backup cannot be pruned'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER backup_delete_guard BEFORE DELETE ON backup_records FOR EACH ROW EXECUTE FUNCTION guard_backup_delete();
