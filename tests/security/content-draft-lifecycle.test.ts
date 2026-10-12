import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migration = readFileSync(
  resolve(
    root,
    'packages/database/prisma/migrations/20261011012000_content_draft_lifecycle/migration.sql',
  ),
  'utf8',
);
const contentRepository = readFileSync(resolve(root, 'packages/content/src/postgres.ts'), 'utf8');
const publisher = readFileSync(
  resolve(root, 'workers/publisher/src/postgres-publication.ts'),
  'utf8',
);

describe('content draft and publication lifecycle boundary', () => {
  it('enforces one active draft and retains archived evidence at the database boundary', () => {
    expect(migration).toContain('ALTER TABLE content_drafts RENAME TO content_draft_records');
    expect(migration).toContain('one_active_content_draft_per_site');
    expect(migration).toMatch(
      /ON content_draft_records \(tenant_id, site_id\)\s+WHERE state = 'active'/u,
    );
    expect(migration).toContain('archived content drafts are immutable');
    expect(migration).toContain('content draft history cannot be deleted');
    expect(migration).toContain('archiving cannot rewrite content draft evidence');
    expect(migration).toContain('NEW.content IS DISTINCT FROM OLD.content');
    expect(migration).toContain('CREATE VIEW content_drafts');
    expect(migration).toContain("WHERE state = 'active'");
    expect(migration).toContain(
      'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
    );
    expect(migration).toContain(
      'REVOKE ALL ON content_draft_records FROM omnireach_app, omnireach_worker',
    );
    expect(migration).toContain('REVOKE ALL ON content_draft_records FROM PUBLIC');
    expect(migration).toContain('REVOKE ALL ON content_drafts FROM PUBLIC');
    expect(migration).toContain('REVOKE DELETE ON content_drafts FROM omnireach_app');
  });

  it('serializes save/publish/rebase and blocks stale or in-flight draft mutation', () => {
    expect(contentRepository).toContain(':content-lifecycle`');
    expect(contentRepository).toContain(':publication`');
    expect(contentRepository).toContain('pg_try_advisory_xact_lock');
    expect(contentRepository).toContain("error_code = 'publication_lease_expired'");
    expect(contentRepository).toContain('PublicationPendingError');
    expect(contentRepository).toContain("AND state = 'active'");
    expect(contentRepository).toContain('draft.base_revision !== base.revision');
    expect(contentRepository).toContain('draft.version !== input.expectedVersion');
  });

  it('fails closed before an older publication can replace a newer active artifact', () => {
    expect(publisher).toContain('artifact.content_revision > $3');
    expect(publisher).toContain('newer.content_revision > $3');
    expect(publisher).toContain(
      '(current.rows[0]?.content_revision ?? 0) > request.contentRevision',
    );
  });
});
