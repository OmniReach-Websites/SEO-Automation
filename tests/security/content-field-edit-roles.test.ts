import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261011010000_post_v2_content_field_edit_roles/migration.sql',
  ),
  'utf8',
);
const schema = readFileSync(resolve(root, 'packages/database/prisma/schema.prisma'), 'utf8');
const repository = readFileSync(resolve(root, 'packages/content/src/postgres.ts'), 'utf8');

describe('content field human-edit authorization boundary', () => {
  it('migrates existing fields to an owner-only fail-closed policy', () => {
    expect(migration).toContain('ADD COLUMN editable_by varchar(40)[] NOT NULL');
    expect(migration).toContain("DEFAULT ARRAY['customer_owner']::varchar(40)[]");
    expect(migration).toContain("SET editable_by = ARRAY['customer_owner']::varchar(40)[]");
    expect(migration).toContain('content_fields_editable_by_policy');
    expect(migration).toContain('cardinality(editable_by) > 0');
  });

  it('keeps persisted policy in the Prisma model and repository authorization path', () => {
    expect(schema).toMatch(
      /editableBy\s+String\[\]\s+@default\(\["customer_owner"\]\)\s+@map\("editable_by"\)/u,
    );
    expect(repository).toContain("'editableBy', f.editable_by");
    expect(repository).toContain('!field.editable_by.includes(context.role)');
    expect(repository).toContain(
      "throw new ProtectedFieldError('Role cannot edit this content field')",
    );
  });
});
