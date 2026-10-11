CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_email varchar(320) NOT NULL UNIQUE,
  display_name varchar(160) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (normalized_email = lower(normalized_email))
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name varchar(160) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  contract_version varchar(32),
  contract_hash varchar(128),
  source_path varchar(500),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX sites_tenant_status_idx ON sites (tenant_id, status);

CREATE TABLE domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  hostname varchar(253) NOT NULL UNIQUE,
  kind varchar(32) NOT NULL CHECK (kind IN ('public', 'admin', 'preview')),
  verification_status varchar(32) NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'failed')),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT,
  CHECK (hostname = lower(hostname) AND hostname !~ '[:/]')
);
CREATE INDEX domains_tenant_site_idx ON domains (tenant_id, site_id);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role varchar(64) NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, site_id, user_id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX memberships_user_active_idx ON memberships (user_id, active);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid,
  actor_id uuid,
  action varchar(160) NOT NULL,
  reason varchar(500),
  trace_id varchar(128) NOT NULL,
  target_type varchar(80),
  target_id uuid,
  before jsonb,
  after jsonb,
  metadata jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX audit_events_scope_created_idx ON audit_events (tenant_id, site_id, created_at);
CREATE INDEX audit_events_trace_idx ON audit_events (trace_id);

CREATE TABLE schema_metadata (
  key varchar(100) PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

INSERT INTO schema_metadata (key, value)
VALUES ('foundation', '{"goal":"G04","version":1}'::jsonb);
