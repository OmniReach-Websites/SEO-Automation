import { orapCapabilityCatalog, orapRoleTemplates } from '@omnireach/auth';
import { pathToFileURL } from 'node:url';
import { Pool, type PoolClient } from 'pg';

async function synchronizeCatalog(client: PoolClient): Promise<void> {
  const sourceKeys = orapCapabilityCatalog.map(({ key }) => key);
  const unknown = await client.query<{ key: string }>(
    `SELECT key FROM permission_definitions
      WHERE deprecated_at IS NULL AND NOT (key = ANY($1::varchar[]))
      ORDER BY key`,
    [sourceKeys],
  );
  if (unknown.rows.length > 0) {
    throw new Error(
      `Active database capabilities are absent from source: ${unknown.rows.map(({ key }) => key).join(', ')}`,
    );
  }

  for (const definition of orapCapabilityCatalog) {
    await client.query(
      `INSERT INTO permission_definitions
         (key, module, label, description, risk_level, scope_type, is_owner_only,
          requires_step_up, requires_reason, version, compatibility_metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{}'::jsonb)
       ON CONFLICT (key) DO UPDATE
         SET module = EXCLUDED.module,
             label = EXCLUDED.label,
             description = EXCLUDED.description,
             risk_level = EXCLUDED.risk_level,
             scope_type = EXCLUDED.scope_type,
             is_owner_only = EXCLUDED.is_owner_only,
             requires_step_up = EXCLUDED.requires_step_up,
             requires_reason = EXCLUDED.requires_reason,
             version = EXCLUDED.version,
             deprecated_at = NULL,
             replacement_key = NULL,
             updated_at = now()`,
      [
        definition.key,
        definition.module,
        definition.label,
        definition.description,
        definition.risk,
        definition.scope,
        definition.ownerOnly,
        definition.requiresStrongStepUp,
        definition.requiresReason,
        definition.version,
      ],
    );
  }
}

async function synchronizeTemplates(client: PoolClient): Promise<void> {
  for (const template of orapRoleTemplates) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO staff_roles
         (slug, name, description, built_in, owner_identity_only, display_order)
       VALUES ($1,$2,$3,true,$4,$5)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [
        template.slug,
        template.name,
        template.description,
        template.ownerIdentityOnly,
        template.displayOrder,
      ],
    );
    const role =
      inserted.rows[0] ??
      (
        await client.query<{ id: string }>('SELECT id FROM staff_roles WHERE slug = $1', [
          template.slug,
        ])
      ).rows[0];
    if (!role)
      throw new Error(`Role template was not found after synchronization: ${template.slug}`);

    const existingVersion = await client.query<{ id: string }>(
      'SELECT id FROM staff_role_versions WHERE role_id = $1 AND version = 1',
      [role.id],
    );
    if (existingVersion.rows[0]) continue;

    const roleVersion = await client.query<{ id: string }>(
      `INSERT INTO staff_role_versions
         (role_id, version, name, description, permission_count, change_reason)
       VALUES ($1,1,$2,$3,$4,'Initial source-defined role template')
       RETURNING id`,
      [role.id, template.name, template.description, template.permissionKeys.length],
    );
    const roleVersionId = roleVersion.rows[0]?.id;
    if (!roleVersionId) throw new Error(`Role version was not created: ${template.slug}`);
    for (const permissionKey of template.permissionKeys) {
      await client.query(
        `INSERT INTO staff_role_permissions (role_version_id, permission_key)
         VALUES ($1,$2)`,
        [roleVersionId, permissionKey],
      );
    }
  }
}

export async function syncOrapAuthorizationCatalog(databaseUrl: string): Promise<{
  capabilityCount: number;
  templateCount: number;
}> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'omnireach:orap-authorization-catalog',
    ]);
    await synchronizeCatalog(client);
    await synchronizeTemplates(client);
    await client.query(
      `INSERT INTO schema_metadata (key, value)
       VALUES ('orap_authorization_contract', to_jsonb('1-catalog-synced'::text))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    );
    await client.query('COMMIT');
    return {
      capabilityCount: orapCapabilityCatalog.length,
      templateCount: orapRoleTemplates.length,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const result = await syncOrapAuthorizationCatalog(databaseUrl);
  process.stdout.write(`${JSON.stringify({ ...result, status: 'ok' })}\n`);
}
