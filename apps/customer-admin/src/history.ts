export type RevisionOrigin = 'customer' | 'orap' | 'proposal' | 'restore' | 'seed';
export type PublicationStatus = 'building' | 'failed' | 'published' | 'queued' | 'unpublished';

export interface RevisionHistoryEntry {
  active: boolean;
  actorLabel: string;
  createdAt: string;
  number: number;
  origin: RevisionOrigin;
  publicationPending: boolean;
  publicationStatus: PublicationStatus;
  restoreEligible: boolean;
  restoredFrom?: number;
  summary: string;
}

export function renderRevisionHistory(
  entries: readonly RevisionHistoryEntry[],
  options: {
    canRestore: boolean;
    csrfToken?: string;
    restoreIdempotencyKeys?: Readonly<Record<number, string>>;
  },
): string {
  const rows = [...entries]
    .sort((left, right) => right.number - left.number)
    .map((entry) => {
      const csrfToken = options.csrfToken
        ? `<input type="hidden" name="csrfToken" value="${escapeHtml(options.csrfToken)}">`
        : '';
      const idempotencyKey = options.restoreIdempotencyKeys?.[entry.number];
      const idempotency = idempotencyKey
        ? `<input type="hidden" name="idempotencyKey" value="${escapeHtml(idempotencyKey)}">`
        : '';
      const restore =
        options.canRestore && entry.restoreEligible && idempotencyKey
          ? `<form method="post" action="/history/${entry.number}/restore">${csrfToken}${idempotency}<label for="restore-reason-${entry.number}">Restore reason</label><input id="restore-reason-${entry.number}" name="reason" minlength="3" maxlength="500" required><button type="submit">Restore revision ${entry.number}</button></form>`
          : `<span>${
              options.canRestore && !entry.restoreEligible
                ? 'Only published revisions and the authoritative initial baseline can be restored'
                : 'Restore unavailable'
            }</span>`;
      const source = entry.restoredFrom
        ? `${entry.origin}; restored from revision ${entry.restoredFrom}`
        : entry.origin;
      return `<tr><th scope="row">${entry.number}</th><td>${escapeHtml(entry.createdAt)}</td><td>${escapeHtml(entry.actorLabel)}</td><td>${escapeHtml(source)}</td><td>${escapeHtml(publicationLabel(entry))}</td><td>${escapeHtml(entry.summary)}</td><td>${restore}</td></tr>`;
    })
    .join('');

  const body = rows || '<tr><td colspan="7">No revisions are available.</td></tr>';
  return `<section aria-labelledby="revision-history-heading"><h2 id="revision-history-heading">Revision history</h2><p>Restoring creates a new validated revision. After it activates, starting the next draft archives the prior draft and copies the active content without erasing revision, draft, or failed-publication history. Successfully published revisions and the authoritative initial baseline can be restored.</p><table><caption>Content revisions, newest first</caption><thead><tr><th scope="col">Revision</th><th scope="col">Created</th><th scope="col">Changed by</th><th scope="col">Origin</th><th scope="col">Publication state</th><th scope="col">Summary</th><th scope="col">Action</th></tr></thead><tbody>${body}</tbody></table></section>`;
}

function publicationLabel(entry: RevisionHistoryEntry): string {
  if (entry.publicationStatus === 'published') {
    return entry.active ? 'Published (active)' : 'Published (superseded)';
  }
  return {
    building: 'Building',
    failed: 'Failed',
    queued: 'Queued',
    unpublished: 'Not published',
  }[entry.publicationStatus];
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}
