export interface DashboardModel {
  features: { enabled: boolean; label: string; reason: string }[];
  integrations: { label: string; status: 'connected' | 'not-connected' | 'unavailable' }[];
  publication: { artifact?: string; status: 'healthy' | 'unavailable' | 'never-published' };
  siteName: string;
}

export interface OrapSiteSummary {
  name: string;
  status: 'active' | 'disabled';
  tenantName: string;
}

export function renderCustomerDashboard(model: DashboardModel): string {
  const featureItems = model.features
    .map(
      (feature) =>
        `<li><strong>${escapeHtml(feature.label)}</strong>: ${feature.enabled ? 'Enabled' : 'Disabled'} <small>${escapeHtml(feature.reason)}</small></li>`,
    )
    .join('');
  const integrationItems = model.integrations
    .map(
      (integration) =>
        `<li>${escapeHtml(integration.label)}: <strong>${escapeHtml(integration.status)}</strong></li>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>${escapeHtml(model.siteName)} administration</title></head><body><a href="#main">Skip to content</a><header><strong>${escapeHtml(model.siteName)}</strong><nav aria-label="Site administration"><a href="/" aria-current="page">Overview</a><a href="/editor">Editor</a><a href="/history">History</a><a href="/security">Security</a></nav></header><main id="main"><h1>Site overview</h1><section aria-labelledby="publication"><h2 id="publication">Publication</h2><p>Status: <strong>${escapeHtml(model.publication.status)}</strong></p>${model.publication.artifact ? `<p>Version: <code>${escapeHtml(model.publication.artifact)}</code></p>` : '<p>No publication version is available.</p>'}</section><section aria-labelledby="features"><h2 id="features">Features</h2><ul>${featureItems}</ul></section><section aria-labelledby="integrations"><h2 id="integrations">Integrations</h2><ul>${integrationItems}</ul></section></main></body></html>`;
}

export function renderOrapDashboard(sites: readonly OrapSiteSummary[], notice?: string): string {
  const rows = sites
    .map(
      (site) =>
        `<tr><th scope="row">${escapeHtml(site.name)}</th><td>${escapeHtml(site.tenantName)}</td><td><span>${escapeHtml(site.status)}</span></td><td><a href="/orap/sites/${encodeURIComponent(site.name)}">Manage</a></td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>Sites | OmniReach Administration</title></head><body><a href="#main">Skip to content</a><header><strong>OmniReach Administration</strong><nav aria-label="Administration"><a href="/orap/sites" aria-current="page">Sites</a><a href="/orap/users">Users</a><a href="/orap/audit">Audit</a></nav></header><main id="main"><h1>Customer sites</h1>${notice ? `<div role="status" tabindex="-1">${escapeHtml(notice)}</div>` : ''}<a href="/orap/sites/new">Create a fictional site</a><table><caption>Sites authorized for this staff account</caption><thead><tr><th scope="col">Site</th><th scope="col">Tenant</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>${rows}</tbody></table></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}
