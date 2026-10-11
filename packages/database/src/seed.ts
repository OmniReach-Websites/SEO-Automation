import { createDatabase } from './index.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const database = createDatabase(databaseUrl);
try {
  await database.pool.query('BEGIN');
  await database.pool.query(
    `INSERT INTO tenants (id, name, status)
     VALUES ('10000000-0000-4000-8000-000000000001', 'Fictional Lantern Hospitality', 'active')
     ON CONFLICT (id) DO NOTHING`,
  );
  await database.pool.query(
    `INSERT INTO sites (id, tenant_id, name, status, contract_version, contract_hash, source_path)
     VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Fictional Copper Spoon', 'active', '1.0', '659dd329afafcde74f7f099a58984b68d2f7337da778621aa5b15d4dd2b0bdb7', 'sites/_starter')
     ON CONFLICT (id) DO UPDATE SET
       contract_version = EXCLUDED.contract_version,
       contract_hash = EXCLUDED.contract_hash,
       source_path = EXCLUDED.source_path`,
  );
  await database.pool.query(
    `INSERT INTO tenants (id, name, status)
     VALUES ('10000000-0000-4000-8000-000000000002', 'Fictional Night Market Group', 'active')
     ON CONFLICT (id) DO NOTHING`,
  );
  await database.pool.query(
    `INSERT INTO sites (id, tenant_id, name, status, contract_version, contract_hash, source_path)
     VALUES
       ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Fictional Night Market', 'active', '1.0', 'd60c8a80fb5ba9cb7b1261d896dbc2b4fefd80df3752b7342c83b6165d2c9815', 'sites/restaurant-example')
     ON CONFLICT (id) DO UPDATE SET
       contract_version = EXCLUDED.contract_version,
       contract_hash = EXCLUDED.contract_hash,
       source_path = EXCLUDED.source_path`,
  );
  await database.pool.query(
    `INSERT INTO domains (id, tenant_id, site_id, hostname, kind, verification_status, active)
     VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'copper-spoon.test', 'public', 'verified', true)
     ON CONFLICT (id) DO NOTHING`,
  );
  await database.pool.query(
    `INSERT INTO feature_definitions (key, version, description, overrideable, safe_default)
     VALUES
       ('content.edit', 1, 'Structured customer editing', true, false),
       ('content.publish', 1, 'Authorized customer publication', true, false),
       ('content.ai.auto', 1, 'Automatic AI edits for eligible fields', true, false),
       ('public.serving', 1, 'Immutable public website serving', false, true)
     ON CONFLICT (key, version) DO NOTHING`,
  );
  await database.pool.query(
    `INSERT INTO plans (id, code, name, version, active)
     VALUES ('90000000-0000-4000-8000-000000000001', 'fictional-local', 'Fictional Local Plan', 1, true)
     ON CONFLICT (code, version) DO NOTHING`,
  );
  await database.pool.query(
    `INSERT INTO plan_features (plan_id, feature_key, feature_version, enabled)
     VALUES
       ('90000000-0000-4000-8000-000000000001', 'content.edit', 1, true),
       ('90000000-0000-4000-8000-000000000001', 'content.publish', 1, true),
       ('90000000-0000-4000-8000-000000000001', 'content.ai.auto', 1, true),
       ('90000000-0000-4000-8000-000000000001', 'public.serving', 1, true)
     ON CONFLICT (plan_id, feature_key) DO NOTHING`,
  );
  await database.pool.query(
    `INSERT INTO subscriptions (tenant_id, site_id, plan_id, status)
     VALUES
       ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'active'),
       ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', 'active')
     ON CONFLICT (site_id) DO NOTHING`,
  );
  await database.pool.query(
    `INSERT INTO domains (id, tenant_id, site_id, hostname, kind, verification_status, active)
     VALUES
       ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'admin.copper-spoon.test', 'admin', 'verified', true),
       ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'preview.copper-spoon.test', 'preview', 'verified', true),
       ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'night-market.test', 'public', 'verified', true),
       ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'admin.night-market.test', 'admin', 'verified', true)
     ON CONFLICT (id) DO NOTHING`,
  );
  await database.pool.query(
    `INSERT INTO users (id, normalized_email, display_name, status)
     VALUES
       ('40000000-0000-4000-8000-000000000001', 'owner@copper-spoon.example.test', 'Fictional Copper Spoon Owner', 'active'),
       ('40000000-0000-4000-8000-000000000002', 'editor@night-market.example.test', 'Fictional Night Market Editor', 'active')
     ON CONFLICT (id) DO NOTHING`,
  );
  await database.pool.query(
    `INSERT INTO memberships (id, tenant_id, site_id, user_id, role, permissions, active)
     VALUES
       ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'customer_owner', '{}'::jsonb, true),
       ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'customer_editor', '{"content.publish":false}'::jsonb, true)
     ON CONFLICT (id) DO NOTHING`,
  );
  await database.pool.query(
    `INSERT INTO content_pages (id, tenant_id, site_id, stable_id, route)
     VALUES
       ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'home', '/'),
       ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'home', '/')
     ON CONFLICT (id) DO NOTHING`,
  );
  await database.pool.query(
    `INSERT INTO content_fields (id, tenant_id, site_id, page_id, stable_id, field_type, protected, ai_mode)
     VALUES
       ('61000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'home.heading', 'text', false, 'auto'),
       ('61000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 'home.heading', 'text', false, 'suggestion')
     ON CONFLICT (id) DO NOTHING`,
  );
  await database.pool.query(
    `INSERT INTO content_revisions (id, tenant_id, site_id, revision, schema_version, content, facts_snapshot, created_by, origin)
     VALUES
       ('62000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 1, 1, '{"home.heading":"Welcome to Fictional Copper Spoon"}'::jsonb, '{}'::jsonb, '40000000-0000-4000-8000-000000000001', 'seed'),
       ('62000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 1, 1, '{"home.heading":"Welcome to Fictional Night Market"}'::jsonb, '{}'::jsonb, '40000000-0000-4000-8000-000000000002', 'seed')
     ON CONFLICT (tenant_id, site_id, revision) DO NOTHING`,
  );
  await database.pool.query('COMMIT');
  process.stdout.write('{"seed":"fictional","status":"ok"}\n');
} catch (error) {
  await database.pool.query('ROLLBACK');
  throw error;
} finally {
  await database.close();
}
