export interface ProposalView {
  readonly expiresAt: string;
  readonly fieldLabel: string;
  readonly id: string;
  readonly rationale: string;
  readonly replacement: string;
  readonly stale: boolean;
}

export function renderProposalReview(
  proposals: readonly ProposalView[],
  csrfToken: string,
): string {
  const cards = proposals
    .map((proposal) => {
      const disabled = proposal.stale ? ' disabled' : '';
      return `<article data-proposal-id="${escapeHtml(proposal.id)}"><h3>${escapeHtml(proposal.fieldLabel)}</h3><p>${escapeHtml(proposal.rationale)}</p><label>Proposed value<textarea readonly>${escapeHtml(proposal.replacement)}</textarea></label><p>Expires ${escapeHtml(proposal.expiresAt)}</p><form method="post" action="/proposals/${escapeHtml(proposal.id)}/decision"><input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}"><button name="decision" value="accept"${disabled}>Accept and preview</button><button name="decision" value="reject"${disabled}>Reject</button><button name="decision" value="edit"${disabled}>Edit as draft</button></form>${proposal.stale ? '<p role="status">This proposal is stale and must be regenerated.</p>' : ''}</article>`;
    })
    .join('');
  return `<section aria-labelledby="proposal-heading"><h2 id="proposal-heading">AI suggestions</h2>${cards || '<p>No pending suggestions.</p>'}</section>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}
