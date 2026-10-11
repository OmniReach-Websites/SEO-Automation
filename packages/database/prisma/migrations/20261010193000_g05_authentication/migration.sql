ALTER TABLE memberships
  ADD CONSTRAINT memberships_role_check CHECK (
    role IN ('customer_owner', 'customer_editor', 'customer_viewer')
  );

CREATE TABLE platform_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role varchar(64) NOT NULL CHECK (role IN ('platform_owner', 'platform_admin', 'staff')),
  active boolean NOT NULL DEFAULT true,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
CREATE INDEX platform_memberships_role_active_idx ON platform_memberships (role, active);

CREATE TABLE credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  password_changed_at timestamptz(3) NOT NULL DEFAULT now(),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  blocked_until timestamptz(3),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid,
  host varchar(253) NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  rotated_from_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  expires_at timestamptz(3) NOT NULL,
  last_seen_at timestamptz(3) NOT NULL DEFAULT now(),
  revoked_at timestamptz(3),
  revoke_reason varchar(160),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE CASCADE,
  CHECK (host = lower(host) AND host !~ '[:/]')
);
CREATE INDEX sessions_user_active_idx ON sessions (user_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX sessions_site_active_idx ON sessions (tenant_id, site_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE password_recovery_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz(3) NOT NULL,
  used_at timestamptz(3),
  requested_ip_hash char(64),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX password_recovery_active_idx ON password_recovery_tokens (user_id, expires_at) WHERE used_at IS NULL;

CREATE TABLE mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(32) NOT NULL CHECK (kind = 'totp'),
  encrypted_secret bytea NOT NULL,
  key_version integer NOT NULL CHECK (key_version > 0),
  verified_at timestamptz(3),
  revoked_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mfa_factors_one_active_totp_idx ON mfa_factors (user_id, kind) WHERE revoked_at IS NULL;

CREATE TABLE mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factor_id uuid NOT NULL REFERENCES mfa_factors(id) ON DELETE CASCADE,
  code_hash char(64) NOT NULL UNIQUE,
  used_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE owner_bootstrap (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz(3) NOT NULL,
  consumed_at timestamptz(3),
  consumed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
