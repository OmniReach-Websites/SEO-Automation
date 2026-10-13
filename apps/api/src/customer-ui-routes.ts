import { randomUUID } from 'node:crypto';

import { hasPermission, type Action } from '@omnireach/auth';
import { PublicationPendingError, RevisionConflictError } from '@omnireach/content';
import {
  renderEditor,
  renderReportingDashboard,
  renderRevisionHistory,
  type EditorField,
  type PublicationStatus,
  type ReportMeasurement,
  type RevisionHistoryEntry,
  type RevisionOrigin,
} from '@omnireach/customer-admin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type {
  CustomerEndpointService,
  CustomerPrincipal,
  ResolveCustomerPrincipal,
} from './customer-routes.ts';
import { requireSameOrigin } from './request-security.ts';

const draftIdSchema = z.string().uuid();
const positiveInteger = z.coerce.number().int().positive();
const reasonSchema = z.string().trim().min(3).max(500);
const fieldTypes = new Set<EditorField['type']>([
  'cards',
  'image',
  'link',
  'metadata',
  'richText',
  'sectionOrder',
  'text',
  'theme',
  'visibility',
]);
const humanEditorRoles = new Set([
  'platform_owner',
  'platform_admin',
  'staff',
  'customer_owner',
  'customer_editor',
]);
const revisionOrigins = new Set<RevisionOrigin>([
  'customer',
  'orap',
  'proposal',
  'restore',
  'seed',
]);

interface CustomerDraftView {
  content: Record<string, unknown>;
  current: boolean;
  id: string;
  publicationStatus?: 'building' | 'queued';
  version: number;
}

interface CustomerFieldView {
  aiMode: EditorField['aiMode'];
  editableBy: string[];
  id: string;
  protected: boolean;
  type: EditorField['type'];
}

export function registerCustomerUiRoutes(
  server: FastifyInstance,
  service: CustomerEndpointService,
  resolvePrincipal: ResolveCustomerPrincipal,
): void {
  server.get<{ Querystring: { notice?: string } }>('/proposals', async (request, reply) => {
    const principal = await authorizeUi(request, reply, resolvePrincipal, 'content.read');
    if (!principal) return;
    if (!service.proposals) return reply.code(404).send();
    const proposals = await service.proposals(principal);
    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderCustomerDocument(
          'AI proposals',
          'AI proposals',
          renderProposalList(proposals, hasPermission(principal.role, 'content.edit')),
          'proposals',
          request.query.notice === 'reviewed'
            ? 'Proposal review saved to the draft.'
            : request.query.notice === 'stale'
              ? 'The proposal became stale and was not applied.'
              : undefined,
        ),
      );
  });

  server.post(
    '/proposals/:proposalId/review',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const principal = await authorizeUi(request, reply, resolvePrincipal, 'content.edit');
      if (!principal) return;
      if (!service.reviewProposal) return reply.code(404).send();
      const proposalId = draftIdSchema.safeParse(
        (request.params as { proposalId?: unknown }).proposalId,
      );
      const body = formBody(request.body);
      const action =
        body?.action === 'approve' || body?.action === 'reject' ? body.action : undefined;
      const reviewReason = reasonSchema.safeParse(body?.reason);
      if (!proposalId.success || !action || !reviewReason.success) {
        return reply.code(400).type('text/html; charset=utf-8').send(renderForbidden());
      }
      let editedValue: unknown = body?.editedValue;
      if (action === 'approve' && body?.valueFormat === 'json' && typeof editedValue === 'string') {
        try {
          editedValue = JSON.parse(editedValue) as unknown;
        } catch {
          return reply.code(400).type('text/html; charset=utf-8').send(renderForbidden());
        }
      }
      const result = await service.reviewProposal(principal, {
        action,
        ...(action === 'approve' ? { editedValue } : {}),
        proposalId: proposalId.data,
        reason: reviewReason.data,
      });
      const state = isRecord(result) ? String(result.state ?? '') : '';
      return reply
        .code(303)
        .redirect(state === 'stale' ? '/proposals?notice=stale' : '/proposals?notice=reviewed');
    },
  );

  server.get('/reports', async (request, reply) => {
    const principal = await authorizeUi(request, reply, resolvePrincipal, 'content.read');
    if (!principal) return;
    const raw = await service.reports(principal);
    const report = isRecord(raw) && Array.isArray(raw.measurements) ? raw.measurements : [];
    const measurements = report.filter(isReportMeasurement) as ReportMeasurement[];
    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderCustomerDocument(
          'Reports',
          'Reports',
          renderReportingDashboard(measurements, principal.role),
          'reports',
        ),
      );
  });

  server.get<{ Querystring: { notice?: string } }>('/editor', async (request, reply) => {
    const principal = await authorizeUi(request, reply, resolvePrincipal, 'content.read');
    if (!principal) return;
    const [rawPages, rawDrafts, rawHistory] = await Promise.all([
      service.pages(principal),
      service.drafts(principal),
      service.history(principal),
    ]);
    const fields = parseFields(rawPages);
    const drafts = parseDrafts(rawDrafts);
    if (drafts.length > 1) {
      return invalidUiRequest(
        reply,
        'Multiple active drafts were detected. Editing is blocked until support resolves the lifecycle conflict.',
        'editor',
        409,
      );
    }
    const history = parseHistory(rawHistory);
    const pendingStatus =
      drafts[0]?.publicationStatus ??
      history.find((entry) => entry.publicationPending)?.publicationStatus;
    const draft = drafts[0];
    const canEdit = hasPermission(principal.role, 'content.edit');
    const canPublish = canPerform(principal, 'content.publish') && !pendingStatus;
    let content: string;
    if (draft && !draft.current) {
      content = `<p role="status">The active draft is based on an older published revision and cannot be edited.</p>${
        canEdit && !pendingStatus
          ? '<form method="post" action="/editor/draft/new"><button type="submit">Start from latest published revision</button></form>'
          : '<p>Draft reconciliation is unavailable while publication is in progress.</p>'
      }`;
    } else if (draft) {
      const editingAvailable = canEdit && !pendingStatus;
      const editorFields = fields.map((field): EditorField => ({
        ...field,
        editable: editingAvailable && !field.protected && field.editableBy.includes(principal.role),
        label: fieldLabel(field.id),
        value: draft.content[field.id],
      }));
      content = renderEditor(editorFields, draft.version, {
        canEdit: editingAvailable,
        canPublish,
        draftId: draft.id,
        publishIdempotencyKey: randomUUID(),
      });
      if (pendingStatus) {
        content = `<p role="status">Publication is ${pendingStatus}. Editing is paused so the immutable publication snapshot cannot diverge from this draft.</p>${content}`;
      }
    } else if (pendingStatus) {
      content = `<p role="status">Publication is ${pendingStatus}. A new draft can be created after it finishes.</p>`;
    } else if (canEdit) {
      content =
        '<p>No active draft exists. Create one from the latest published revision.</p><form method="post" action="/editor/draft/new"><button type="submit">Create draft</button></form>';
    } else {
      content = '<p>No active draft is available for this account.</p>';
    }
    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderCustomerDocument(
          'Content editor',
          'Content editor',
          content,
          'editor',
          noticeText(request.query.notice),
        ),
      );
  });

  server.post('/editor/draft/new', { preHandler: requireSameOrigin }, async (request, reply) => {
    const principal = await authorizeUi(request, reply, resolvePrincipal, 'content.edit');
    if (!principal) return;
    try {
      await service.createDraft(principal);
    } catch (error) {
      if (error instanceof PublicationPendingError) {
        return invalidUiRequest(
          reply,
          'A publication is in progress. Drafting resumes after it completes.',
          'editor',
          409,
        );
      }
      throw error;
    }
    return reply.code(303).redirect('/editor?notice=draft-created');
  });

  server.post('/editor/draft', { preHandler: requireSameOrigin }, async (request, reply) => {
    const principal = await authorizeUi(request, reply, resolvePrincipal, 'content.edit');
    if (!principal) return;
    const body = formBody(request.body);
    const draftId = draftIdSchema.safeParse(body?.draftId);
    const expectedVersion = positiveInteger.safeParse(body?.expectedVersion);
    if (!body || !draftId.success || !expectedVersion.success) {
      return invalidUiRequest(reply, 'The draft submission is invalid.', 'editor');
    }

    const [rawPages, rawDrafts] = await Promise.all([
      service.pages(principal),
      service.drafts(principal),
    ]);
    const drafts = parseDrafts(rawDrafts);
    if (drafts.length > 1) {
      return invalidUiRequest(
        reply,
        'Multiple active drafts were detected. Editing is blocked until support resolves the lifecycle conflict.',
        'editor',
        409,
      );
    }
    const draft = drafts.find((entry) => entry.id === draftId.data);
    if (!draft) return invalidUiRequest(reply, 'The active draft was not found.', 'editor', 404);
    if (!draft.current) {
      return invalidUiRequest(
        reply,
        'This draft is based on an older published revision. Start from the latest revision before editing.',
        'editor',
        409,
      );
    }
    if (draft.publicationStatus) {
      return invalidUiRequest(
        reply,
        `Publication is ${draft.publicationStatus}. Editing is paused until it completes.`,
        'editor',
        409,
      );
    }
    if (draft.version !== expectedVersion.data) {
      return invalidUiRequest(
        reply,
        'This draft changed after the editor was loaded. Reload it before saving.',
        'editor',
        409,
      );
    }

    const changes: { fieldId: string; value: unknown }[] = [];
    try {
      for (const field of parseFields(rawPages)) {
        if (field.protected || !field.editableBy.includes(principal.role)) continue;
        const submitted = readFieldValue(body, field);
        if (!submitted.present) continue;
        if (!sameValue(draft.content[field.id], submitted.value)) {
          changes.push({ fieldId: field.id, value: submitted.value });
        }
      }
    } catch (error) {
      if (error instanceof InvalidEditorValueError) {
        return invalidUiRequest(reply, 'One or more field values are invalid.', 'editor');
      }
      throw error;
    }

    if (changes.length > 0) {
      try {
        await service.draftUpdate(principal, {
          draftId: draft.id,
          expectedVersion: expectedVersion.data,
          patch: Object.fromEntries(changes.map((change) => [change.fieldId, change.value])),
        });
      } catch (error) {
        if (error instanceof PublicationPendingError || error instanceof RevisionConflictError) {
          return invalidUiRequest(
            reply,
            error instanceof PublicationPendingError
              ? 'Publication began before this save completed. Reload the editor after it finishes.'
              : 'The draft or published revision changed. Reload before saving.',
            'editor',
            409,
          );
        }
        throw error;
      }
    }
    return reply.code(303).redirect('/editor?notice=draft-saved');
  });

  server.post('/editor/preview', { preHandler: requireSameOrigin }, async (request, reply) => {
    const principal = await authorizeUi(request, reply, resolvePrincipal, 'content.edit');
    if (!principal) return;
    const body = formBody(request.body);
    const draftId = draftIdSchema.safeParse(body?.draftId);
    if (!draftId.success) {
      return invalidUiRequest(reply, 'The preview request is invalid.', 'editor');
    }
    const preview = await service.preview(principal, { draftId: draftId.data });
    return reply
      .setCookie('__Host-omnireach_preview', preview.previewToken, {
        httpOnly: true,
        maxAge: 900,
        path: '/',
        sameSite: 'strict',
        secure: true,
      })
      .code(303)
      .redirect('/v1/customer/preview-content/');
  });

  server.post('/editor/publish', { preHandler: requireSameOrigin }, async (request, reply) => {
    const principal = await authorizeUi(request, reply, resolvePrincipal, 'content.publish');
    if (!principal) return;
    const body = formBody(request.body);
    const draftId = draftIdSchema.safeParse(body?.draftId);
    const expectedVersion = positiveInteger.safeParse(body?.expectedVersion);
    const idempotencyKey = draftIdSchema.safeParse(body?.idempotencyKey);
    const reason = reasonSchema.safeParse(body?.reason);
    if (
      !draftId.success ||
      !expectedVersion.success ||
      !idempotencyKey.success ||
      !reason.success
    ) {
      return invalidUiRequest(reply, 'The publication request is invalid.', 'editor');
    }
    try {
      await service.publish(principal, {
        draftId: draftId.data,
        expectedVersion: expectedVersion.data,
        idempotencyKey: idempotencyKey.data,
        reason: reason.data,
      });
    } catch (error) {
      if (error instanceof PublicationPendingError || error instanceof RevisionConflictError) {
        return invalidUiRequest(
          reply,
          error instanceof PublicationPendingError
            ? 'Another publication is already in progress.'
            : 'This draft changed after the editor was loaded or is no longer based on the active published revision. Reload and reconcile it before publishing.',
          'editor',
          409,
        );
      }
      throw error;
    }
    return reply.code(303).redirect('/history?notice=publication-queued');
  });

  server.get<{ Querystring: { notice?: string } }>('/history', async (request, reply) => {
    const principal = await authorizeUi(request, reply, resolvePrincipal, 'content.read');
    if (!principal) return;
    const entries = parseHistory(await service.history(principal));
    const publicationPending = entries.some((entry) => entry.publicationPending);
    const content = renderRevisionHistory(entries, {
      canRestore: canPerform(principal, 'content.publish') && !publicationPending,
      restoreIdempotencyKeys: Object.fromEntries(
        entries
          .filter((entry) => entry.restoreEligible)
          .map((entry) => [entry.number, randomUUID()]),
      ),
    });
    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderCustomerDocument(
          'Revision history',
          'Revision history',
          content,
          'history',
          noticeText(request.query.notice),
        ),
      );
  });

  server.post<{ Params: { revision: string } }>(
    '/history/:revision/restore',
    { preHandler: requireSameOrigin },
    async (request, reply) => {
      const principal = await authorizeUi(request, reply, resolvePrincipal, 'content.publish');
      if (!principal) return;
      const body = formBody(request.body);
      const idempotencyKey = draftIdSchema.safeParse(body?.idempotencyKey);
      const revision = positiveInteger.safeParse(request.params.revision);
      const reason = reasonSchema.safeParse(body?.reason);
      if (!idempotencyKey.success || !revision.success || !reason.success) {
        return invalidUiRequest(reply, 'The restore request is invalid.', 'history');
      }
      try {
        await service.restore(principal, {
          idempotencyKey: idempotencyKey.data,
          reason: reason.data,
          revision: revision.data,
        });
      } catch (error) {
        if (error instanceof PublicationPendingError || error instanceof RevisionConflictError) {
          return invalidUiRequest(
            reply,
            error instanceof PublicationPendingError
              ? 'Another publication is already in progress.'
              : 'The selected revision is no longer eligible for restore.',
            'history',
            409,
          );
        }
        throw error;
      }
      return reply.code(303).redirect('/history?notice=restore-queued');
    },
  );
}

async function authorizeUi(
  request: FastifyRequest,
  reply: FastifyReply,
  resolvePrincipal: ResolveCustomerPrincipal,
  action: Action,
): Promise<CustomerPrincipal | undefined> {
  const principal = await resolvePrincipal(request);
  if (!principal) {
    await reply.code(303).redirect('/login');
    return undefined;
  }
  if (!canPerform(principal, action)) {
    await reply.code(403).type('text/html; charset=utf-8').send(renderForbidden());
    return undefined;
  }
  return principal;
}

function canPerform(principal: CustomerPrincipal, action: Action): boolean {
  const grants = principal.editorPublishGrant ? new Set<Action>(['content.publish']) : undefined;
  return hasPermission(principal.role, action, grants);
}

function parseDrafts(value: unknown): CustomerDraftView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): CustomerDraftView[] => {
    if (!isRecord(entry) || !isRecord(entry.content)) return [];
    const id = draftIdSchema.safeParse(entry.id);
    const version = positiveInteger.safeParse(entry.version);
    const publicationStatus =
      entry.publicationStatus === 'queued' || entry.publicationStatus === 'building'
        ? entry.publicationStatus
        : undefined;
    return id.success && version.success && typeof entry.current === 'boolean'
      ? [
          {
            content: entry.content,
            current: entry.current,
            id: id.data,
            ...(publicationStatus ? { publicationStatus } : {}),
            version: version.data,
          },
        ]
      : [];
  });
}

function parseFields(value: unknown): CustomerFieldView[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, CustomerFieldView>();
  for (const page of value) {
    if (!isRecord(page) || !Array.isArray(page.fields)) continue;
    for (const entry of page.fields) {
      if (!isRecord(entry)) continue;
      const id = typeof entry.id === 'string' ? entry.id : '';
      const type = entry.type;
      const aiMode = entry.aiMode;
      const editableBy = Array.isArray(entry.editableBy)
        ? entry.editableBy.filter(
            (role): role is string => typeof role === 'string' && humanEditorRoles.has(role),
          )
        : [];
      if (
        !id ||
        !fieldTypes.has(type as EditorField['type']) ||
        !['auto', 'suggestion', 'disabled'].includes(String(aiMode)) ||
        editableBy.length === 0 ||
        editableBy.length !== (Array.isArray(entry.editableBy) ? entry.editableBy.length : 0) ||
        typeof entry.protected !== 'boolean'
      ) {
        continue;
      }
      byId.set(id, {
        aiMode: aiMode as EditorField['aiMode'],
        editableBy,
        id,
        protected: entry.protected,
        type: type as EditorField['type'],
      });
    }
  }
  return [...byId.values()];
}

function parseHistory(value: unknown): RevisionHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): RevisionHistoryEntry[] => {
    if (!isRecord(entry)) return [];
    const revision = positiveInteger.safeParse(entry.revision);
    const createdAt = dateText(entry.createdAt);
    const createdBy = typeof entry.createdBy === 'string' ? entry.createdBy : '';
    const origin = revisionOrigin(entry.origin);
    const publicationStatus = revisionStatus(entry.publicationStatus);
    const restoredFrom = positiveInteger.safeParse(entry.restoredFrom);
    if (
      !revision.success ||
      !createdAt ||
      !createdBy ||
      !origin ||
      !publicationStatus ||
      typeof entry.active !== 'boolean' ||
      typeof entry.publicationPending !== 'boolean' ||
      typeof entry.restoreEligible !== 'boolean'
    ) {
      return [];
    }
    return [
      {
        active: entry.active,
        actorLabel: createdBy,
        createdAt,
        number: revision.data,
        origin,
        publicationPending: entry.publicationPending,
        publicationStatus,
        restoreEligible: entry.restoreEligible,
        ...(restoredFrom.success ? { restoredFrom: restoredFrom.data } : {}),
        summary: historySummary(publicationStatus, origin, revision.data),
      },
    ];
  });
}

function revisionStatus(value: unknown): PublicationStatus | undefined {
  return ['queued', 'building', 'published', 'failed', 'unpublished'].includes(String(value))
    ? (value as PublicationStatus)
    : undefined;
}

function historySummary(
  status: PublicationStatus,
  origin: RevisionOrigin,
  revision: number,
): string {
  if (status === 'queued') return `Publication queued for revision ${revision}`;
  if (status === 'building') return `Publication build in progress for revision ${revision}`;
  if (status === 'failed')
    return `Publication failed for revision ${revision}; live content unchanged`;
  if (status === 'unpublished') return `Revision ${revision} has not been published`;
  return origin === 'restore'
    ? `Restored content published as revision ${revision}`
    : `Published content revision ${revision}`;
}

function revisionOrigin(value: unknown): RevisionOrigin | undefined {
  if (value === 'human') return 'customer';
  return revisionOrigins.has(value as RevisionOrigin) ? (value as RevisionOrigin) : undefined;
}

function readFieldValue(
  body: Record<string, unknown>,
  field: CustomerFieldView,
): { present: boolean; value: unknown } {
  if (field.type === 'visibility') {
    return { present: true, value: body[field.id] === 'true' };
  }
  const raw = body[field.id];
  if (!Object.hasOwn(body, field.id) || typeof raw !== 'string') {
    return { present: false, value: undefined };
  }
  if (field.type === 'cards' || field.type === 'metadata' || field.type === 'sectionOrder') {
    try {
      return { present: true, value: JSON.parse(raw) as unknown };
    } catch {
      throw new InvalidEditorValueError();
    }
  }
  if (field.type === 'link' && raw) {
    try {
      const parsed = new URL(raw, 'https://local.invalid');
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        throw new InvalidEditorValueError();
      }
    } catch {
      throw new InvalidEditorValueError();
    }
  }
  return { present: true, value: raw };
}

function formBody(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fieldLabel(id: string): string {
  const name = id.split('.').at(-1) ?? id;
  const spaced = name.replace(/[-_]+/gu, ' ').replace(/([a-z])([A-Z])/gu, '$1 $2');
  return spaced ? `${spaced[0]?.toUpperCase() ?? ''}${spaced.slice(1)}` : id;
}

function dateText(value: unknown): string | undefined {
  const date =
    value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
}

function noticeText(value: string | undefined): string | undefined {
  return {
    'draft-created': 'Draft created from the latest published revision.',
    'draft-saved': 'Draft saved.',
    'publication-queued': 'Publication queued.',
    'restore-queued': 'Restore queued as a new revision.',
  }[value ?? ''];
}

function invalidUiRequest(
  reply: FastifyReply,
  message: string,
  current: 'editor' | 'history',
  statusCode = 400,
): FastifyReply {
  return reply
    .code(statusCode)
    .type('text/html; charset=utf-8')
    .send(
      renderCustomerDocument(
        'Request not accepted',
        'Request not accepted',
        `<p>${message}</p>`,
        current,
      ),
    );
}

function renderCustomerDocument(
  title: string,
  heading: string,
  content: string,
  current: 'editor' | 'history' | 'proposals' | 'reports',
  notice?: string,
): string {
  const editorCurrent = current === 'editor' ? ' aria-current="page"' : '';
  const historyCurrent = current === 'history' ? ' aria-current="page"' : '';
  const reportsCurrent = current === 'reports' ? ' aria-current="page"' : '';
  const proposalsCurrent = current === 'proposals' ? ' aria-current="page"' : '';
  const status = notice ? `<div role="status" tabindex="-1">${escapeHtml(notice)}</div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>${escapeHtml(title)} | OmniReach</title></head><body><a href="#main">Skip to content</a><header><strong>OmniReach</strong><nav aria-label="Site administration"><a href="/">Overview</a><a href="/editor"${editorCurrent}>Editor</a><a href="/proposals"${proposalsCurrent}>Proposals</a><a href="/history"${historyCurrent}>History</a><a href="/reports"${reportsCurrent}>Reports</a><a href="/security">Security</a></nav></header><main id="main"><h1>${escapeHtml(heading)}</h1>${status}${content}</main></body></html>`;
}

function renderProposalList(raw: unknown, canEdit: boolean): string {
  const proposals = Array.isArray(raw) ? raw.filter(isRecord) : [];
  if (proposals.length === 0) {
    return '<p>No AI proposals are waiting for review. The AI provider remains disabled unless an owner explicitly enables it.</p>';
  }
  return proposals
    .map((proposal) => {
      const id = stringValue(proposal.id);
      const fieldId = stringValue(proposal.field_id) ?? 'Unknown field';
      const state = stringValue(proposal.state) ?? 'unknown';
      if (!id) return '';
      const currentValue = proposal.current_value;
      const proposedValue = proposal.proposed_value;
      const proposedText =
        typeof proposedValue === 'string' ? proposedValue : JSON.stringify(proposedValue, null, 2);
      const valueFormat = typeof proposedValue === 'string' ? 'text' : 'json';
      const stale = proposal.stale === true;
      const evidence = Array.isArray(proposal.evidence)
        ? proposal.evidence
            .filter((value): value is string => typeof value === 'string')
            .map((value) => `<li>${escapeHtml(value)}</li>`)
            .join('')
        : '';
      const decision =
        canEdit && state === 'pending' && !stale
          ? `<form method="post" action="/proposals/${escapeHtml(id)}/review"><input name="action" type="hidden" value="approve"><input name="valueFormat" type="hidden" value="${valueFormat}"><label for="proposal-value-${escapeHtml(id)}">Approved or edited value</label><textarea id="proposal-value-${escapeHtml(id)}" name="editedValue" rows="6" required>${escapeHtml(proposedText ?? '')}</textarea><label for="proposal-reason-${escapeHtml(id)}">Review reason</label><input id="proposal-reason-${escapeHtml(id)}" name="reason" minlength="3" maxlength="500" required><button type="submit">Apply to versioned draft</button></form><form method="post" action="/proposals/${escapeHtml(id)}/review"><input name="action" type="hidden" value="reject"><label for="proposal-reject-${escapeHtml(id)}">Rejection reason</label><input id="proposal-reject-${escapeHtml(id)}" name="reason" minlength="3" maxlength="500" required><button type="submit">Reject proposal</button></form>`
          : `<p>${stale ? 'This proposal is stale and cannot overwrite newer work.' : 'This proposal is read-only.'}</p>`;
      return `<article><h2>${escapeHtml(fieldId)}</h2><p>Status: ${escapeHtml(state)} · Mode: ${escapeHtml(stringValue(proposal.effective_mode) ?? 'SUGGEST')} · Model: ${escapeHtml(stringValue(proposal.model) ?? 'not recorded')}</p><h3>Current value</h3><pre>${escapeHtml(JSON.stringify(currentValue, null, 2))}</pre><h3>Suggested value</h3><pre>${escapeHtml(proposedText ?? '')}</pre><p>${escapeHtml(stringValue(proposal.rationale) ?? 'No rationale was recorded.')}</p><h3>Evidence</h3>${evidence ? `<ul>${evidence}</ul>` : '<p>No evidence was recorded.</p>'}${decision}</article>`;
    })
    .join('');
}

function renderForbidden(): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>Access denied</title></head><body><main><h1>Access denied</h1><p>This action is not available to this account.</p></main></body></html>';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isReportMeasurement(value: unknown): value is ReportMeasurement {
  if (!isRecord(value)) return false;
  return (
    typeof value.kind === 'string' &&
    typeof value.label === 'string' &&
    typeof value.source === 'string' &&
    typeof value.state === 'string' &&
    typeof value.freshness === 'string'
  );
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}

class InvalidEditorValueError extends Error {}
