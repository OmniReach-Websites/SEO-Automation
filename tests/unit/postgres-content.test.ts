import {
  PostgresContentRepository,
  ProtectedFieldError,
  PublicationPendingError,
  RevisionConflictError,
} from '@omnireach/content';
import type { TenantTransactionPool } from '@omnireach/tenant';
import { describe, expect, it, vi } from 'vitest';

const context = {
  role: 'customer_owner',
  siteId: '20000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000001',
  traceId: 'trace-content-1',
  userId: '40000000-0000-4000-8000-000000000001',
};
const draftId = '80000000-0000-4000-8000-000000000001';

function repository(field: {
  ai_mode: 'auto' | 'disabled' | 'suggestion';
  editable_by?: string[];
  protected: boolean;
}) {
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    void values;
    if (text.includes('WITH latest_feature')) return { rows: [allowedPolicy()] };
    if (text.includes("status IN ('queued', 'building')")) return { rows: [] };
    if (text.includes('revision.revision = COALESCE')) {
      return { rows: [{ content: { 'home.heading': 'Before' }, revision: 1 }] };
    }
    if (text.includes('FROM content_drafts')) {
      return {
        rows: [
          {
            base_revision: 1,
            content: { 'home.heading': 'Before' },
            id: draftId,
            version: 2,
          },
        ],
      };
    }
    if (text.includes('FROM content_fields')) {
      return {
        rows: [
          {
            ...field,
            editable_by: field.editable_by ?? ['customer_owner'],
            field_type: 'text',
            stable_id: 'home.heading',
          },
        ],
      };
    }
    if (text.includes('UPDATE content_drafts')) {
      return {
        rows: [
          {
            base_revision: 1,
            content: { 'home.heading': 'After' },
            id: draftId,
            version: 3,
          },
        ],
      };
    }
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  const pool: TenantTransactionPool = { connect: vi.fn(async () => client) };
  return { content: new PostgresContentRepository(pool), query };
}

describe('PostgreSQL content repository', () => {
  it('creates a revision and queued publication atomically, then reuses its idempotency key', async () => {
    let existing = false;
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.includes('WITH latest_feature')) return { rows: [allowedPolicy()] };
      if (text.includes("status IN ('queued', 'building')")) return { rows: [] };
      if (text.includes('idempotency_key = $3')) {
        return existing ? { rows: [{ content_revision: 3, status: 'queued' }] } : { rows: [] };
      }
      if (text.includes('revision.revision = COALESCE')) {
        return { rows: [{ content: { 'home.heading': 'Ready' }, revision: 2 }] };
      }
      if (text.includes('FROM content_drafts')) {
        return {
          rows: [
            { base_revision: 2, content: { 'home.heading': 'Ready' }, id: draftId, version: 2 },
          ],
        };
      }
      if (text.includes('FROM content_revisions')) return { rows: [{ revision: 2 }] };
      if (text.includes('AS facts')) return { rows: [{ facts: {} }] };
      if (text.includes('max(schema_version)')) return { rows: [{ schema_version: 1 }] };
      if (text.includes('INSERT INTO publication_requests')) existing = true;
      return { rows: [] };
    });
    const pool: TenantTransactionPool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };
    const content = new PostgresContentRepository(pool);
    const input = {
      draftId,
      expectedVersion: 2,
      idempotencyKey: 'publish-content-1',
      reason: 'Approved update',
    };
    await expect(content.prepareDraftPublication(context, input)).resolves.toEqual({
      contentRevision: 3,
      status: 'queued',
    });
    expect(query.mock.calls.some(([text]) => text.includes('INSERT INTO content_revisions'))).toBe(
      true,
    );
    expect(
      query.mock.calls.findIndex(([text]) => text.includes('INSERT INTO content_revisions')),
    ).toBeLessThan(
      query.mock.calls.findIndex(([text]) => text.includes('INSERT INTO publication_requests')),
    );
    query.mockClear();
    await expect(content.prepareDraftPublication(context, input)).resolves.toEqual({
      contentRevision: 3,
      status: 'queued',
    });
    expect(query.mock.calls.some(([text]) => text.includes('INSERT INTO content_revisions'))).toBe(
      false,
    );
  });

  it('rejects a stale expected draft version while holding the draft row lock', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('WITH latest_feature')) return { rows: [allowedPolicy()] };
      if (text.includes('SELECT EXISTS')) return { rows: [{ stale: false }] };
      if (text.includes('idempotency_key = $3')) return { rows: [] };
      if (text.includes("status IN ('queued', 'building')")) return { rows: [] };
      if (text.includes('FROM content_drafts')) {
        return {
          rows: [
            {
              base_revision: 2,
              content: { 'home.heading': 'Newer edit' },
              id: draftId,
              version: 3,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const content = new PostgresContentRepository({
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    });

    await expect(
      content.prepareDraftPublication(context, {
        draftId,
        expectedVersion: 2,
        idempotencyKey: 'publish-stale-draft',
        reason: 'Stale browser publication',
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    expect(
      query.mock.calls.some(
        ([text]) => text.includes('FROM content_drafts') && text.includes('FOR UPDATE'),
      ),
    ).toBe(true);
    expect(query.mock.calls.some(([text]) => text.includes('INSERT INTO content_revisions'))).toBe(
      false,
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it('updates one explicit draft with optimistic concurrency, tenant context, and audit', async () => {
    const { content, query } = repository({ ai_mode: 'auto', protected: false });
    await expect(
      content.updateDraftField(context, {
        draftId,
        expectedVersion: 2,
        fieldId: 'home.heading',
        value: 'After',
      }),
    ).resolves.toMatchObject({ id: draftId, version: 3 });
    expect(query.mock.calls.slice(0, 5).map(([text]) => text)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE omnireach_app',
      `SELECT set_config('app.tenant_id', $1, true)`,
      `SELECT set_config('app.site_id', $1, true)`,
      `SELECT set_config('app.user_id', $1, true)`,
    ]);
    expect(query.mock.calls.some(([text]) => text.includes('INSERT INTO audit_events'))).toBe(true);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('rejects protected fields and stale draft versions without issuing an update', async () => {
    const protectedRepo = repository({ ai_mode: 'disabled', protected: true });
    await expect(
      protectedRepo.content.updateDraftField(context, {
        draftId,
        expectedVersion: 2,
        fieldId: 'home.heading',
        value: 'Forbidden',
      }),
    ).rejects.toBeInstanceOf(ProtectedFieldError);
    expect(
      protectedRepo.query.mock.calls.some(([text]) => text.includes('UPDATE content_drafts')),
    ).toBe(false);
    expect(protectedRepo.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');

    const stale = repository({ ai_mode: 'auto', protected: false });
    await expect(
      stale.content.updateDraftField(context, {
        draftId,
        expectedVersion: 1,
        fieldId: 'home.heading',
        value: 'Stale',
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    expect(stale.query.mock.calls.some(([text]) => text.includes('UPDATE content_drafts'))).toBe(
      false,
    );
  });

  it('enforces persisted field editing roles for direct repository updates', async () => {
    const editorContext = { ...context, role: 'customer_editor' };
    const denied = repository({
      ai_mode: 'disabled',
      editable_by: ['customer_owner'],
      protected: false,
    });
    await expect(
      denied.content.updateDraftField(editorContext, {
        draftId,
        expectedVersion: 2,
        fieldId: 'home.heading',
        value: 'Editor attempt',
      }),
    ).rejects.toBeInstanceOf(ProtectedFieldError);
    expect(denied.query.mock.calls.some(([text]) => text.includes('UPDATE content_drafts'))).toBe(
      false,
    );

    const allowed = repository({
      ai_mode: 'disabled',
      editable_by: ['customer_owner'],
      protected: false,
    });
    await expect(
      allowed.content.updateDraftField(context, {
        draftId,
        expectedVersion: 2,
        fieldId: 'home.heading',
        value: 'Owner update',
      }),
    ).resolves.toMatchObject({ id: draftId, version: 3 });
    expect(allowed.query.mock.calls.some(([text]) => text.includes('UPDATE content_drafts'))).toBe(
      true,
    );
  });

  it('validates and commits a multi-field patch with one version compare-and-swap', async () => {
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      if (text.includes('WITH latest_feature')) return { rows: [allowedPolicy()] };
      if (text.includes("status IN ('queued', 'building')")) return { rows: [] };
      if (text.includes('revision.revision = COALESCE')) {
        return {
          rows: [
            {
              content: { 'home.heading': 'Before', 'home.link': 'https://before.test' },
              revision: 1,
            },
          ],
        };
      }
      if (text.includes('FROM content_drafts')) {
        return {
          rows: [
            {
              base_revision: 1,
              content: { 'home.heading': 'Before', 'home.link': 'https://before.test' },
              id: draftId,
              version: 2,
            },
          ],
        };
      }
      if (text.includes('FROM content_fields')) {
        return {
          rows: [
            {
              ai_mode: 'auto',
              editable_by: ['customer_owner', 'customer_editor'],
              field_type: 'text',
              protected: false,
              stable_id: 'home.heading',
            },
            {
              ai_mode: 'disabled',
              editable_by: ['customer_owner', 'customer_editor'],
              field_type: 'link',
              protected: false,
              stable_id: 'home.link',
            },
          ],
        };
      }
      if (text.includes('UPDATE content_drafts')) {
        return {
          rows: [
            {
              base_revision: 1,
              content: JSON.parse(String(values?.[0])) as Record<string, unknown>,
              id: draftId,
              version: Number(values?.[1]),
            },
          ],
        };
      }
      return { rows: [] };
    });
    const content = new PostgresContentRepository({
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    });

    await expect(
      content.updateDraftFields(context, {
        draftId,
        expectedVersion: 2,
        patch: {
          'home.heading': 'After',
          'home.link': 'https://after.test',
        },
      }),
    ).resolves.toMatchObject({
      content: { 'home.heading': 'After', 'home.link': 'https://after.test' },
      version: 3,
    });
    expect(
      query.mock.calls.filter(([text]) => text.includes('UPDATE content_drafts')),
    ).toHaveLength(1);
    const update = query.mock.calls.find(([text]) => text.includes('UPDATE content_drafts'));
    expect(update?.[1]?.[5]).toBe(2);

    query.mockClear();
    await expect(
      content.updateDraftFields(context, {
        draftId,
        expectedVersion: 2,
        patch: {
          'home.heading': 'Would otherwise be valid',
          'home.link': 'javascript:alert(1)',
        },
      }),
    ).rejects.toThrow(/unsafe URL/u);
    expect(query.mock.calls.some(([text]) => text.includes('UPDATE content_drafts'))).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it('serializes draft creation and atomically archives a stale active draft before upsert', async () => {
    let activeBase = 1;
    let insertCount = 0;
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.includes('WITH latest_feature')) return { rows: [allowedPolicy()] };
      if (text.includes("status IN ('queued', 'building')")) return { rows: [] };
      if (text.includes('revision.revision = COALESCE')) {
        return { rows: [{ content: { 'home.heading': 'Published revision two' }, revision: 2 }] };
      }
      if (text.includes('FROM content_drafts') && text.includes("state = 'active'")) {
        return activeBase
          ? {
              rows: [
                {
                  base_revision: activeBase,
                  content: { 'home.heading': 'Old draft' },
                  id: draftId,
                  version: 2,
                },
              ],
            }
          : { rows: [] };
      }
      if (text.includes("archive_reason = 'rebased_to_published_revision'")) {
        activeBase = 0;
        return { rows: [] };
      }
      if (text.includes('INSERT INTO content_drafts')) {
        insertCount += 1;
        activeBase = 2;
        return {
          rows: [
            {
              base_revision: 2,
              content: { 'home.heading': 'Published revision two' },
              id: '80000000-0000-4000-8000-000000000002',
              version: 1,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const content = new PostgresContentRepository({
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    });

    await expect(content.createDraft(context)).resolves.toMatchObject({
      baseRevision: 2,
      current: true,
    });
    await expect(content.createDraft(context)).resolves.toMatchObject({
      baseRevision: 2,
      current: true,
    });
    expect(insertCount).toBe(1);
    expect(
      query.mock.calls.some(
        ([text, values]) =>
          text.includes('pg_advisory_xact_lock') &&
          values?.[0] === `${context.tenantId}:${context.siteId}:content-lifecycle`,
      ),
    ).toBe(true);
    expect(
      query.mock.calls.some(
        ([text]) => text.includes('INSERT INTO content_drafts') && !text.includes('ON CONFLICT'),
      ),
    ).toBe(true);
    expect(
      query.mock.calls.findIndex(([text]) => text.includes("archive_reason = 'rebased")),
    ).toBeLessThan(
      query.mock.calls.findIndex(([text]) => text.includes('INSERT INTO content_drafts')),
    );
  });

  it('freezes queued drafts, rejects stale post-activation clients, and unlocks failed publications', async () => {
    const pendingQuery = vi.fn(async (text: string) => {
      if (text.includes('WITH latest_feature')) return { rows: [allowedPolicy()] };
      if (text.includes("status IN ('queued', 'building')")) {
        return { rows: [{ status: 'queued' }] };
      }
      return { rows: [] };
    });
    const pending = new PostgresContentRepository({
      connect: vi.fn(async () => ({ query: pendingQuery, release: vi.fn() })),
    });
    await expect(
      pending.updateDraftField(context, {
        draftId,
        expectedVersion: 2,
        fieldId: 'home.heading',
        value: 'Must wait',
      }),
    ).rejects.toBeInstanceOf(PublicationPendingError);
    expect(pendingQuery.mock.calls.some(([text]) => text.includes('UPDATE content_drafts'))).toBe(
      false,
    );

    const staleQuery = vi.fn(async (text: string) => {
      if (text.includes('WITH latest_feature')) return { rows: [allowedPolicy()] };
      if (text.includes("status IN ('queued', 'building')")) return { rows: [] };
      if (text.includes('FROM content_drafts')) {
        return {
          rows: [
            {
              base_revision: 1,
              content: { 'home.heading': 'Old base' },
              id: draftId,
              version: 2,
            },
          ],
        };
      }
      if (text.includes('revision.revision = COALESCE')) {
        return { rows: [{ content: { 'home.heading': 'Published' }, revision: 2 }] };
      }
      return { rows: [] };
    });
    const stale = new PostgresContentRepository({
      connect: vi.fn(async () => ({ query: staleQuery, release: vi.fn() })),
    });
    await expect(
      stale.updateDraftField(context, {
        draftId,
        expectedVersion: 2,
        fieldId: 'home.heading',
        value: 'Stale browser edit',
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    expect(staleQuery.mock.calls.some(([text]) => text.includes('UPDATE content_drafts'))).toBe(
      false,
    );

    const failed = repository({ ai_mode: 'auto', protected: false });
    await expect(
      failed.content.updateDraftField(context, {
        draftId,
        expectedVersion: 2,
        fieldId: 'home.heading',
        value: 'Recovered after failure',
      }),
    ).resolves.toMatchObject({ current: true, version: 3 });
  });

  it('expires an abandoned request only after proving no publication worker owns the site lock', async () => {
    const activeQuery = vi.fn(async (text: string) => {
      if (text.includes('WITH latest_feature')) return { rows: [allowedPolicy()] };
      if (text.includes('SELECT EXISTS')) return { rows: [{ stale: true }] };
      if (text.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: false }] };
      if (text.includes("status IN ('queued', 'building')")) {
        return { rows: [{ status: 'building' }] };
      }
      return { rows: [] };
    });
    const active = new PostgresContentRepository({
      connect: vi.fn(async () => ({ query: activeQuery, release: vi.fn() })),
    });
    await expect(
      active.updateDraftField(context, {
        draftId,
        expectedVersion: 2,
        fieldId: 'home.heading',
        value: 'Must not race a live build',
      }),
    ).rejects.toBeInstanceOf(PublicationPendingError);
    expect(activeQuery.mock.calls.some(([text]) => text.includes('WITH abandoned'))).toBe(false);

    const abandonedQuery = vi.fn(async (text: string, values?: unknown[]) => {
      void values;
      if (text.includes('SELECT EXISTS')) return { rows: [{ stale: true }] };
      if (text.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }] };
      if (text.includes('WITH abandoned')) {
        return {
          rows: [
            {
              content_revision: 4,
              id: '90000000-0000-4000-8000-000000000001',
              prior_status: 'queued',
            },
          ],
        };
      }
      if (text.includes('FROM content_drafts')) {
        return {
          rows: [
            {
              base_revision: 3,
              content: { 'home.heading': 'Recovered draft' },
              id: draftId,
              version: 2,
            },
          ],
        };
      }
      if (text.includes('revision.revision = COALESCE')) {
        return { rows: [{ content: { 'home.heading': 'Published' }, revision: 3 }] };
      }
      if (text.includes("status IN ('queued', 'building')")) return { rows: [] };
      return { rows: [] };
    });
    const abandoned = new PostgresContentRepository({
      connect: vi.fn(async () => ({ query: abandonedQuery, release: vi.fn() })),
    });
    await expect(abandoned.listDrafts(context)).resolves.toEqual([
      expect.objectContaining({ id: draftId }),
    ]);
    expect(abandonedQuery.mock.calls.some(([text]) => text.includes('WITH abandoned'))).toBe(true);
    expect(
      abandonedQuery.mock.calls.some(
        ([text, values]) =>
          text.includes('INSERT INTO audit_events') &&
          values?.includes('content.publication_lease_expired'),
      ),
    ).toBe(true);
  });

  it('returns publication-request and active-artifact state instead of assuming every revision is published', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('LEFT JOIN LATERAL')) {
        return {
          rows: [
            {
              active: false,
              created_at: new Date('2026-10-11T02:00:00.000Z'),
              created_by: context.userId,
              error_code: 'publication_failed',
              origin: 'human',
              publication_pending: false,
              publication_status: 'failed',
              restore_eligible: false,
              restored_from: null,
              revision: 3,
            },
            {
              active: true,
              created_at: new Date('2026-10-11T01:00:00.000Z'),
              created_by: context.userId,
              error_code: null,
              origin: 'human',
              publication_pending: false,
              publication_status: 'published',
              restore_eligible: true,
              restored_from: null,
              revision: 2,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const content = new PostgresContentRepository({
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    });
    await expect(content.listHistory(context)).resolves.toEqual([
      expect.objectContaining({
        active: false,
        errorCode: 'publication_failed',
        publicationStatus: 'failed',
        restoreEligible: false,
        revision: 3,
      }),
      expect.objectContaining({
        active: true,
        publicationStatus: 'published',
        restoreEligible: true,
        revision: 2,
      }),
    ]);
  });

  it('queues a restore from the authoritative seed baseline', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('WITH latest_feature')) return { rows: [allowedPolicy()] };
      if (text.includes('SELECT EXISTS')) return { rows: [{ stale: false }] };
      if (text.includes('idempotency_key = $3')) return { rows: [] };
      if (text.includes("status IN ('queued', 'building')")) return { rows: [] };
      if (text.includes('FROM content_revisions target')) {
        return {
          rows: [
            {
              content: { 'home.heading': 'Initial baseline' },
              facts_snapshot: {},
              revision: 1,
              schema_version: 1,
            },
          ],
        };
      }
      if (text.includes('SELECT revision FROM content_revisions')) {
        return { rows: [{ revision: 3 }] };
      }
      return { rows: [] };
    });
    const content = new PostgresContentRepository({
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    });
    await expect(
      content.prepareRestorePublication(context, {
        idempotencyKey: 'restore-authoritative-seed',
        reason: 'Return to the original approved baseline',
        revision: 1,
      }),
    ).resolves.toEqual({ contentRevision: 4, status: 'queued' });
    expect(
      query.mock.calls.some(
        ([text]) =>
          text.includes("target.origin = 'seed'") && text.includes('ORDER BY seed.revision DESC'),
      ),
    ).toBe(true);
  });

  it('allows restore only from a successfully published, active, or authoritative seed revision', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('WITH latest_feature')) return { rows: [allowedPolicy()] };
      if (text.includes('idempotency_key = $3')) return { rows: [] };
      if (text.includes("status IN ('queued', 'building')")) return { rows: [] };
      if (text.includes('FROM content_revisions target')) return { rows: [] };
      return { rows: [] };
    });
    const content = new PostgresContentRepository({
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    });
    await expect(
      content.prepareRestorePublication(context, {
        idempotencyKey: 'restore-failed-revision',
        reason: 'Unsafe failed revision',
        revision: 4,
      }),
    ).rejects.toThrow(RevisionConflictError);
    expect(query.mock.calls.some(([text]) => text.includes('INSERT INTO content_revisions'))).toBe(
      false,
    );
    expect(
      query.mock.calls.some(
        ([text]) =>
          text.includes("published.status = 'published'") &&
          text.includes('active_artifacts') &&
          text.includes("target.origin = 'seed'") &&
          text.includes('ORDER BY seed.revision DESC'),
      ),
    ).toBe(true);
  });
});

function allowedPolicy() {
  return {
    editing_frozen: false,
    feature_enabled: true,
    grace_ends_at: null,
    subscription_status: 'active',
  };
}
