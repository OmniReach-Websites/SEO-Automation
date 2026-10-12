import {
  PostgresContentRepository,
  ProtectedFieldError,
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
    const query = vi.fn(async (text: string) => {
      if (text.includes('WITH latest_feature')) return { rows: [allowedPolicy()] };
      if (text.includes('FROM publication_requests')) {
        return existing ? { rows: [{ content_revision: 3, status: 'queued' }] } : { rows: [] };
      }
      if (text.includes('FROM content_drafts')) {
        return {
          rows: [{ base_revision: 2, content: { 'home.heading': 'Ready' }, id: draftId }],
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
});

function allowedPolicy() {
  return {
    editing_frozen: false,
    feature_enabled: true,
    grace_ends_at: null,
    subscription_status: 'active',
  };
}
