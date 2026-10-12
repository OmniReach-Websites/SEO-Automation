export interface DashboardModel {
  features: { enabled: boolean; label: string; reason: string }[];
  integrations: { label: string; status: 'connected' | 'not-connected' | 'unavailable' }[];
  publication: { artifact?: string; status: 'healthy' | 'unavailable' | 'never-published' };
  siteName: string;
}

export interface OrapSiteSummary {
  id?: string;
  name: string;
  status: 'active' | 'disabled';
  tenantId?: string;
  tenantName: string;
}

export type OrapNavigationItem = 'operations' | 'security' | 'sites';

export const adminStylesheet = String.raw`
:root{color-scheme:light;--ink:#16201d;--muted:#63706c;--line:#dce3df;--panel:#fff;--canvas:#f4f6f4;--brand:#164b3b;--brand-strong:#0e392c;--accent:#d8f36a;--danger:#a63232;--shadow:0 14px 36px rgba(20,42,34,.09);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-synthesis:none}
*{box-sizing:border-box}html{background:var(--canvas);color:var(--ink)}body{margin:0;min-height:100vh}a{color:var(--brand)}a:hover{text-decoration-thickness:2px}.skip-link{position:fixed;left:1rem;top:-5rem;z-index:20;background:var(--ink);color:#fff;padding:.75rem 1rem;border-radius:.5rem}.skip-link:focus{top:1rem}.app-shell{min-height:100vh;display:grid;grid-template-columns:15rem minmax(0,1fr)}.sidebar{position:sticky;top:0;height:100vh;background:var(--brand-strong);color:#fff;padding:1.5rem 1rem;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:.75rem;padding:.35rem .5rem 2rem;color:#fff;text-decoration:none}.brand-mark{display:grid;place-items:center;width:2.4rem;height:2.4rem;border-radius:.72rem;background:var(--accent);color:var(--brand-strong);font-weight:850;letter-spacing:-.05em}.brand-copy{display:grid;gap:.1rem}.brand-copy strong{font-size:1rem}.brand-copy small{color:#b9cbc4;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase}.nav{display:grid;gap:.35rem}.nav a{color:#dce9e4;text-decoration:none;padding:.72rem .78rem;border-radius:.62rem;font-weight:650}.nav a:hover{background:rgba(255,255,255,.09)}.nav a[aria-current=page]{background:#fff;color:var(--brand-strong)}.sidebar-footer{margin-top:auto;border-top:1px solid rgba(255,255,255,.15);padding-top:1rem}.link-button{appearance:none;border:0;background:transparent;color:#dce9e4;padding:.65rem .5rem;font:inherit;cursor:pointer}.workspace{min-width:0}.topbar{min-height:4.5rem;padding:0 clamp(1.25rem,4vw,3rem);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:rgba(255,255,255,.86)}.topbar p{margin:0;color:var(--muted);font-size:.9rem}.environment{display:inline-flex;align-items:center;gap:.45rem;color:var(--brand);font-size:.78rem;font-weight:750;text-transform:uppercase;letter-spacing:.08em}.environment:before{content:"";width:.5rem;height:.5rem;border-radius:50%;background:#35a268;box-shadow:0 0 0 4px #dff4e7}.content{width:min(78rem,100%);margin:0 auto;padding:clamp(2rem,4vw,3.5rem)}.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:1.5rem;margin-bottom:2rem}.eyebrow{margin:0 0 .45rem;color:var(--brand);font-size:.74rem;font-weight:800;text-transform:uppercase;letter-spacing:.13em}h1{font-size:clamp(2rem,4vw,3.15rem);line-height:1.05;letter-spacing:-.045em;margin:0}h2{font-size:1.22rem;letter-spacing:-.02em;margin:0 0 1rem}h3{margin-top:0}.lede{max-width:45rem;color:var(--muted);font-size:1.02rem;line-height:1.6}.button,button{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;border:1px solid var(--brand);border-radius:.62rem;background:var(--brand);color:#fff;padding:.68rem 1rem;font:inherit;font-weight:720;text-decoration:none;cursor:pointer}.button:hover,button:hover{background:var(--brand-strong);text-decoration:none}.button.secondary,button.secondary{background:#fff;color:var(--brand);border-color:#bccbc5}.button.danger,button.danger{background:#fff;color:var(--danger);border-color:#e0bcbc}.panel{background:var(--panel);border:1px solid var(--line);border-radius:1rem;box-shadow:var(--shadow);padding:clamp(1.15rem,3vw,1.75rem);margin-bottom:1.25rem}.panel.flush{padding:0;overflow:hidden}.panel-header{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.2rem 1.35rem;border-bottom:1px solid var(--line)}.panel-header h2,.panel-header p{margin:0}.empty{padding:3.5rem 1.5rem;text-align:center;color:var(--muted)}.empty strong{display:block;color:var(--ink);font-size:1.05rem;margin-bottom:.35rem}.notice{border:1px solid #b9d8c8;background:#edf8f2;color:#154d38;border-radius:.75rem;padding:.85rem 1rem;margin-bottom:1.25rem}.notice.error{border-color:#e2bcbc;background:#fff1f1;color:#7c2929}.badge{display:inline-flex;align-items:center;border-radius:999px;background:#e8f5ed;color:#17613f;padding:.24rem .55rem;font-size:.78rem;font-weight:750}.badge.disabled{background:#f1eeee;color:#715b5b}table{width:100%;border-collapse:collapse;text-align:left}caption{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}th,td{padding:.9rem 1.2rem;border-bottom:1px solid var(--line);vertical-align:top}thead th{background:#f8faf9;color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em}tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}tbody tr:hover{background:#fafcfb}form{display:grid;gap:.9rem}.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.field{display:grid;gap:.4rem}.field.full{grid-column:1/-1}label{font-size:.84rem;font-weight:720}input,select,textarea{width:100%;border:1px solid #bcc8c3;border-radius:.6rem;background:#fff;color:var(--ink);padding:.72rem .8rem;font:inherit}input:focus,select:focus,textarea:focus{outline:3px solid rgba(34,112,83,.18);border-color:var(--brand)}.help{margin:0;color:var(--muted);font-size:.82rem;line-height:1.5}.actions{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin-bottom:1.25rem}.stat{background:var(--panel);border:1px solid var(--line);border-radius:.9rem;padding:1.2rem}.stat dt{color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.08em}.stat dd{margin:.45rem 0 0;font-size:1.55rem;font-weight:800;letter-spacing:-.04em}.operation-form{display:flex;align-items:end;gap:.55rem}.operation-form .field{min-width:12rem}.operation-form button{white-space:nowrap}.alert-list{list-style:none;padding:0;margin:0;display:grid;gap:.75rem}.alert-card{border:1px solid var(--line);border-radius:.75rem;padding:1rem}.alert-card>p{margin:.45rem 0 1rem}.detail-list{display:grid;grid-template-columns:max-content 1fr;gap:.7rem 1.5rem;margin:0}.detail-list dt{color:var(--muted)}.detail-list dd{margin:0;font-weight:650}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.85em;word-break:break-all}@media(max-width:800px){.app-shell{grid-template-columns:1fr}.sidebar{position:static;height:auto}.brand{padding-bottom:1rem}.nav{display:flex;overflow:auto}.nav a{white-space:nowrap}.sidebar-footer{display:none}.topbar{display:none}.content{padding:1.25rem}.page-head{align-items:flex-start;flex-direction:column}.field-grid,.stats{grid-template-columns:1fr}.field.full{grid-column:auto}.panel.flush{overflow:auto}th,td{white-space:nowrap}}
`;

export function renderOrapShell(input: {
  actions?: string;
  content: string;
  current: OrapNavigationItem;
  eyebrow?: string;
  heading: string;
  notice?: { kind?: 'error' | 'success'; message: string };
  title: string;
}): string {
  const current = (item: OrapNavigationItem) =>
    input.current === item ? ' aria-current="page"' : '';
  const notice = input.notice
    ? `<div class="notice${input.notice.kind === 'error' ? ' error' : ''}" role="status" tabindex="-1">${escapeHtml(input.notice.message)}</div>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><link rel="stylesheet" href="/assets/admin.css"><title>${escapeHtml(input.title)} | OmniReach Administration</title></head><body><a class="skip-link" href="#main">Skip to content</a><div class="app-shell"><aside class="sidebar"><a class="brand" href="/orap/sites"><span class="brand-mark" aria-hidden="true">OR</span><span class="brand-copy"><strong>OmniReach</strong><small>Administration</small></span></a><nav class="nav" aria-label="Administration"><a href="/orap/sites"${current('sites')}>Sites</a><a href="/orap/operations"${current('operations')}>Operations</a><a href="/security"${current('security')}>Security</a></nav><div class="sidebar-footer"><form method="post" action="/auth/logout"><button class="link-button" type="submit">Sign out</button></form></div></aside><div class="workspace"><header class="topbar"><p>Agency operations console</p><span class="environment">Staff workspace</span></header><main class="content" id="main"><div class="page-head"><div>${input.eyebrow ? `<p class="eyebrow">${escapeHtml(input.eyebrow)}</p>` : ''}<h1>${escapeHtml(input.heading)}</h1></div>${input.actions ?? ''}</div>${notice}${input.content}</main></div></div></body></html>`;
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
    .map((site) => {
      const identifier = site.id ?? site.name;
      return `<tr><th scope="row">${escapeHtml(site.name)}</th><td>${escapeHtml(site.tenantName)}</td><td><span class="badge${site.status === 'disabled' ? ' disabled' : ''}">${escapeHtml(site.status)}</span></td><td><a class="button secondary" href="/orap/sites/${encodeURIComponent(identifier)}">Manage</a></td></tr>`;
    })
    .join('');
  const body = rows
    ? `<table><caption>Sites authorized for this staff account</caption><thead><tr><th scope="col">Site</th><th scope="col">Tenant</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty"><strong>No customer sites yet</strong>Add the first managed site when its repository path and owner approval are ready.</div>';
  return renderOrapShell({
    actions: '<a class="button" href="/orap/sites/new">Add customer site</a>',
    content: `<section class="panel flush"><div class="panel-header"><div><h2>Managed sites</h2><p class="help">Sites this account is authorized to administer.</p></div></div>${body}</section>`,
    current: 'sites',
    eyebrow: 'Portfolio',
    heading: 'Customer sites',
    ...(notice ? { notice: { message: notice } } : {}),
    title: 'Sites',
  });
}

export function renderOrapSiteForm(error?: string): string {
  return renderOrapShell({
    content: `<section class="panel"><p class="lede">Register an agency-built website and its tenant. This creates platform records only; it does not change DNS or deploy a site.</p>${error ? `<div class="notice error" role="alert">${escapeHtml(error)}</div>` : ''}<form method="post" action="/orap/sites"><div class="field-grid"><div class="field"><label for="tenantName">Customer or organization</label><input id="tenantName" name="tenantName" maxlength="160" autocomplete="organization" required></div><div class="field"><label for="siteName">Site name</label><input id="siteName" name="siteName" maxlength="160" required></div><div class="field full"><label for="sourcePath">Repository source path</label><input id="sourcePath" name="sourcePath" value="sites/" pattern="sites/[a-z0-9_-]+" maxlength="300" required><p class="help">Use a path such as <code>sites/copper-spoon</code>.</p></div><div class="field full"><label for="reason">Audit reason</label><textarea id="reason" name="reason" minlength="3" maxlength="500" rows="3" required></textarea><p class="help">Explain why this site is being registered. This is retained in the audit record.</p></div></div><div class="actions"><button type="submit">Create site record</button><a class="button secondary" href="/orap/sites">Cancel</a></div></form></section>`,
    current: 'sites',
    eyebrow: 'Site onboarding',
    heading: 'Add customer site',
    title: 'Add site',
  });
}

export function renderOrapSiteDetails(site: OrapSiteSummary): string {
  return renderOrapShell({
    actions: '<a class="button secondary" href="/orap/sites">Back to sites</a>',
    content: `<section class="panel"><h2>Site record</h2><dl class="detail-list"><dt>Site</dt><dd>${escapeHtml(site.name)}</dd><dt>Tenant</dt><dd>${escapeHtml(site.tenantName)}</dd><dt>Status</dt><dd><span class="badge${site.status === 'disabled' ? ' disabled' : ''}">${escapeHtml(site.status)}</span></dd>${site.id ? `<dt>Site ID</dt><dd><code>${escapeHtml(site.id)}</code></dd>` : ''}${site.tenantId ? `<dt>Tenant ID</dt><dd><code>${escapeHtml(site.tenantId)}</code></dd>` : ''}</dl></section><section class="panel"><h2>Management controls</h2><p class="lede">Subscription, customer access, integrations, feature overrides, and publishing controls will appear here as each tested service is connected to this screen. No unavailable control is presented as functional.</p></section>`,
    current: 'sites',
    eyebrow: 'Site management',
    heading: site.name,
    title: site.name,
  });
}

export function renderOrapNotFound(): string {
  return renderOrapShell({
    content:
      '<section class="panel"><p class="lede">That site is not available to this administration account.</p><a class="button secondary" href="/orap/sites">Return to sites</a></section>',
    current: 'sites',
    eyebrow: 'Not found',
    heading: 'Site unavailable',
    title: 'Site unavailable',
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}
