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

export interface OrapSiteManagementModel {
  availability: {
    activeArtifact: boolean;
    preservedDuringDelinquency: boolean;
    publicDomain: boolean;
  };
  budget: { capUsdMicros: number; policyVersion: number } | null;
  emergency: {
    autonomousChangesStopped: boolean;
    automationStopped: boolean;
    editingFrozen: boolean;
    policyVersion: number;
  };
  features: readonly { enabled: boolean; key: string; readiness: string }[];
  integrations: readonly {
    lastSyncedAt: string | null;
    propertyKind: string;
    status: string;
  }[];
  plans: readonly {
    code: string;
    commercialStatus: string;
    id: string;
    name: string;
    version: number;
  }[];
  subscription: {
    aiReviewCyclesPerMonth: number;
    code: string;
    customerSeatLimit: number;
    graceEndsAt: string | null;
    planId: string;
    seoAuditIntervalHours: number;
    standardPageLimit: number;
    status: string;
    version: number;
  } | null;
}

export interface OrapStaffSummary {
  activeSessions: number;
  createdAt: string;
  displayName: string;
  emailCodeEnabled: boolean;
  identityKind: 'platform_admin' | 'platform_owner' | 'staff';
  jobTitle?: string;
  lastLoginAt?: string;
  membershipId: string;
  normalizedEmail: string;
  roleName?: string;
  roleSlug?: string;
  status: 'active' | 'disabled' | 'pending';
  strongFactorEnrolled: boolean;
  userId: string;
}

export interface OrapStaffRoleOption {
  description: string;
  name: string;
  permissionCount: number;
  slug: string;
}

const platformOwnerAuthority: OrapStaffRoleOption = {
  description: 'Full owner authority, including internal staff and security administration.',
  name: 'Platform Owner',
  permissionCount: 0,
  slug: 'platform-owner',
};

export type OrapNavigationItem = 'operations' | 'overview' | 'security' | 'sites' | 'staff';

export interface OrapOverviewModel {
  alerts: readonly { message: string; severity: string; state: string }[];
  budget: { capUsdMicros: number; reservedUsdMicros: number; usedUsdMicros: number } | null;
  jobs: readonly { category: string; state: string }[];
  sites: readonly OrapSiteSummary[];
}

export const adminStylesheet =
  String.raw`
:root{color-scheme:light;--ink:#16201d;--muted:#63706c;--line:#dce3df;--panel:#fff;--canvas:#f4f6f4;--brand:#164b3b;--brand-strong:#0e392c;--accent:#d8f36a;--danger:#a63232;--shadow:0 14px 36px rgba(20,42,34,.09);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-synthesis:none}
*{box-sizing:border-box}html{background:var(--canvas);color:var(--ink)}body{margin:0;min-height:100vh}a{color:var(--brand)}a:hover{text-decoration-thickness:2px}.skip-link{position:fixed;left:1rem;top:-5rem;z-index:20;background:var(--ink);color:#fff;padding:.75rem 1rem;border-radius:.5rem}.skip-link:focus{top:1rem}.app-shell{min-height:100vh;display:grid;grid-template-columns:15rem minmax(0,1fr)}.sidebar{position:sticky;top:0;height:100vh;background:var(--brand-strong);color:#fff;padding:1.5rem 1rem;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:.75rem;padding:.35rem .5rem 2rem;color:#fff;text-decoration:none}.brand-mark{display:grid;place-items:center;width:2.4rem;height:2.4rem;border-radius:.72rem;background:var(--accent);color:var(--brand-strong);font-weight:850;letter-spacing:-.05em}.brand-copy{display:grid;gap:.1rem}.brand-copy strong{font-size:1rem}.brand-copy small{color:#b9cbc4;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase}.nav{display:grid;gap:.35rem}.nav a{color:#dce9e4;text-decoration:none;padding:.72rem .78rem;border-radius:.62rem;font-weight:650}.nav a:hover{background:rgba(255,255,255,.09)}.nav a[aria-current=page]{background:#fff;color:var(--brand-strong)}.sidebar-footer{margin-top:auto;border-top:1px solid rgba(255,255,255,.15);padding-top:1rem}.link-button{appearance:none;border:0;background:transparent;color:#dce9e4;padding:.65rem .5rem;font:inherit;cursor:pointer}.workspace{min-width:0}.topbar{min-height:4.5rem;padding:0 clamp(1.25rem,4vw,3rem);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:rgba(255,255,255,.86)}.topbar p{margin:0;color:var(--muted);font-size:.9rem}.environment{display:inline-flex;align-items:center;gap:.45rem;color:var(--brand);font-size:.78rem;font-weight:750;text-transform:uppercase;letter-spacing:.08em}.environment:before{content:"";width:.5rem;height:.5rem;border-radius:50%;background:#35a268;box-shadow:0 0 0 4px #dff4e7}.content{width:min(78rem,100%);margin:0 auto;padding:clamp(2rem,4vw,3.5rem)}.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:1.5rem;margin-bottom:2rem}.eyebrow{margin:0 0 .45rem;color:var(--brand);font-size:.74rem;font-weight:800;text-transform:uppercase;letter-spacing:.13em}h1{font-size:clamp(2rem,4vw,3.15rem);line-height:1.05;letter-spacing:-.045em;margin:0}h2{font-size:1.22rem;letter-spacing:-.02em;margin:0 0 1rem}h3{margin-top:0}.lede{max-width:45rem;color:var(--muted);font-size:1.02rem;line-height:1.6}.button,button{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;border:1px solid var(--brand);border-radius:.62rem;background:var(--brand);color:#fff;padding:.68rem 1rem;font:inherit;font-weight:720;text-decoration:none;cursor:pointer}.button:hover,button:hover{background:var(--brand-strong);text-decoration:none}.button.secondary,button.secondary{background:#fff;color:var(--brand);border-color:#bccbc5}.button.danger,button.danger{background:#fff;color:var(--danger);border-color:#e0bcbc}.panel{background:var(--panel);border:1px solid var(--line);border-radius:1rem;box-shadow:var(--shadow);padding:clamp(1.15rem,3vw,1.75rem);margin-bottom:1.25rem}.panel.flush{padding:0;overflow:hidden}.panel-header{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.2rem 1.35rem;border-bottom:1px solid var(--line)}.panel-header h2,.panel-header p{margin:0}.empty{padding:3.5rem 1.5rem;text-align:center;color:var(--muted)}.empty strong{display:block;color:var(--ink);font-size:1.05rem;margin-bottom:.35rem}.notice{border:1px solid #b9d8c8;background:#edf8f2;color:#154d38;border-radius:.75rem;padding:.85rem 1rem;margin-bottom:1.25rem}.notice.error{border-color:#e2bcbc;background:#fff1f1;color:#7c2929}.badge{display:inline-flex;align-items:center;border-radius:999px;background:#e8f5ed;color:#17613f;padding:.24rem .55rem;font-size:.78rem;font-weight:750}.badge.disabled{background:#f1eeee;color:#715b5b}table{width:100%;border-collapse:collapse;text-align:left}caption{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}th,td{padding:.9rem 1.2rem;border-bottom:1px solid var(--line);vertical-align:top}thead th{background:#f8faf9;color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em}tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}tbody tr:hover{background:#fafcfb}form{display:grid;gap:.9rem}.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.field{display:grid;gap:.4rem}.field.full{grid-column:1/-1}label{font-size:.84rem;font-weight:720}input,select,textarea{width:100%;border:1px solid #bcc8c3;border-radius:.6rem;background:#fff;color:var(--ink);padding:.72rem .8rem;font:inherit}input:focus,select:focus,textarea:focus{outline:3px solid rgba(34,112,83,.18);border-color:var(--brand)}.help{margin:0;color:var(--muted);font-size:.82rem;line-height:1.5}.actions{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin-bottom:1.25rem}.stat{background:var(--panel);border:1px solid var(--line);border-radius:.9rem;padding:1.2rem}.stat dt{color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.08em}.stat dd{margin:.45rem 0 0;font-size:1.55rem;font-weight:800;letter-spacing:-.04em}.operation-form{display:flex;align-items:end;gap:.55rem}.operation-form .field{min-width:12rem}.operation-form button{white-space:nowrap}.alert-list{list-style:none;padding:0;margin:0;display:grid;gap:.75rem}.alert-card{border:1px solid var(--line);border-radius:.75rem;padding:1rem}.alert-card>p{margin:.45rem 0 1rem}.detail-list{display:grid;grid-template-columns:max-content 1fr;gap:.7rem 1.5rem;margin:0}.detail-list dt{color:var(--muted)}.detail-list dd{margin:0;font-weight:650}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.85em;word-break:break-all}@media(max-width:800px){.app-shell{grid-template-columns:1fr}.sidebar{position:static;height:auto}.brand{padding-bottom:1rem}.nav{display:flex;overflow:auto}.nav a{white-space:nowrap}.sidebar-footer{display:none}.topbar{display:none}.content{padding:1.25rem}.page-head{align-items:flex-start;flex-direction:column}.field-grid,.stats{grid-template-columns:1fr}.field.full{grid-column:auto}.panel.flush{overflow:auto}th,td{white-space:nowrap}}
` +
  String.raw`
:root{--ink:#172033;--muted:#687386;--line:#dfe4eb;--panel:#fff;--canvas:#f6f7fa;--brand:#3157d5;--brand-strong:#2444ad;--accent:#7dd3fc;--danger:#b42318;--shadow:0 1px 2px rgba(16,24,40,.04),0 12px 28px rgba(16,24,40,.06)}
body{font-size:15px;line-height:1.5}.app-shell{grid-template-columns:17rem minmax(0,1fr)}.sidebar{background:#11182b;padding:1.35rem 1.15rem}.brand{padding:.35rem .55rem 1.65rem}.brand-mark{width:2.5rem;height:2.5rem;background:linear-gradient(145deg,#8be2ff,#78a3ff);color:#101828;border-radius:.8rem}.brand-copy small{color:#94a3bd}.nav{gap:.2rem}.nav-label{margin:1rem .72rem .35rem;color:#71809e;font-size:.66rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.nav a{color:#cbd5e7;padding:.66rem .76rem;border-radius:.55rem;font-size:.9rem}.nav a:hover{background:#1d2943;color:#fff}.nav a[aria-current=page]{background:#2b55cc;color:#fff;box-shadow:inset 3px 0 0 #8bdcff}.sidebar-footer{border-color:#293550}.workspace{background:var(--canvas)}.topbar{min-height:4.25rem;background:rgba(255,255,255,.92);backdrop-filter:blur(10px);padding:0 clamp(1.4rem,3vw,3rem)}.topbar strong{font-size:.88rem}.topbar p{font-size:.82rem}.environment{color:#176b49;background:#ecfdf3;border:1px solid #abefc6;border-radius:999px;padding:.3rem .65rem;font-size:.68rem}.environment:before{width:.42rem;height:.42rem;box-shadow:none}.content{width:min(86rem,100%);padding:clamp(1.6rem,3.2vw,3rem)}.page-head{align-items:center;margin-bottom:1.55rem}.eyebrow{color:#3157d5;font-size:.7rem}h1{font-size:clamp(1.8rem,3vw,2.6rem);letter-spacing:-.035em}h2{font-size:1.08rem}.button,button{border-radius:.55rem;background:#3157d5;border-color:#3157d5;padding:.65rem .92rem;font-size:.88rem}.button:hover,button:hover{background:#2444ad}.button.secondary,button.secondary{color:#344054;border-color:#d0d5dd}.panel{border-radius:.8rem;box-shadow:var(--shadow);padding:1.3rem}.panel.flush{padding:0}.panel-header{padding:1rem 1.2rem}.stats{grid-template-columns:repeat(4,minmax(0,1fr));gap:.8rem}.stat{border-radius:.75rem;padding:1rem 1.05rem;box-shadow:0 1px 2px rgba(16,24,40,.03)}.stat dt{font-size:.68rem}.stat dd{font-size:1.45rem}.stat small{display:block;margin-top:.2rem;color:var(--muted);font-size:.75rem}.notice{border-radius:.6rem}.badge{font-size:.72rem}.badge.neutral{background:#f2f4f7;color:#475467}th,td{padding:.78rem 1.05rem}thead th{background:#f9fafb;font-size:.67rem}tbody tr:hover{background:#f7f9ff}.auth-page{min-height:100vh;display:grid;grid-template-columns:minmax(20rem,38%) minmax(0,1fr);background:#f7f8fb}.auth-brand-panel{display:flex;flex-direction:column;justify-content:space-between;padding:clamp(2rem,5vw,5rem);background:linear-gradient(150deg,#11182b 0%,#18284b 65%,#214ca9 120%);color:#fff}.auth-brand{display:flex;align-items:center;gap:.75rem;color:#fff;text-decoration:none}.auth-brand .brand-mark{flex:0 0 auto}.auth-brand-copy{max-width:30rem}.auth-brand-copy .eyebrow{color:#8bdcff}.auth-brand-copy h2{max-width:12ch;margin:0 0 1rem;font-size:clamp(2rem,4vw,3.6rem);line-height:1.02;letter-spacing:-.05em}.auth-brand-copy p{max-width:36rem;color:#bdc9dc;font-size:1rem}.auth-meta{color:#91a0ba;font-size:.75rem}.auth-workspace{display:grid;place-items:center;padding:2rem}.auth-card{width:min(27rem,100%);background:#fff;border:1px solid #e1e5ec;border-radius:1rem;box-shadow:0 18px 55px rgba(16,24,40,.1);padding:clamp(1.5rem,4vw,2.4rem)}.auth-card .eyebrow{margin-bottom:.55rem}.auth-card h1{font-size:2rem;margin-bottom:.75rem}.auth-card>.lede{margin:0 0 1.5rem;font-size:.93rem}.auth-card form+form{margin-top:1rem;padding-top:1rem;border-top:1px solid var(--line)}.auth-card-footer{margin:1.3rem 0 0;color:var(--muted);font-size:.86rem}.auth-card .button,.auth-card button{width:100%;margin-top:.15rem}.checkbox-label{display:grid;grid-template-columns:auto 1fr;gap:.65rem;align-items:start;font-weight:500;line-height:1.45}.checkbox-label input{width:auto;margin-top:.2rem}.surface-note{border:1px solid #d8e2ff;background:#f5f7ff;color:#344054;border-radius:.65rem;padding:.8rem .9rem;font-size:.82rem}.section-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.section-grid .panel{margin:0}.quick-links{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem}.quick-link{display:block;border:1px solid var(--line);border-radius:.7rem;background:#fff;padding:1rem;text-decoration:none;color:var(--ink)}.quick-link:hover{border-color:#a9b8e8;box-shadow:var(--shadow)}.quick-link strong{display:block;margin-bottom:.25rem}.quick-link span{color:var(--muted);font-size:.8rem}.page-subtitle{margin:.4rem 0 1.25rem;color:var(--muted);font-size:.92rem}.table-action{white-space:nowrap}@media(max-width:900px){.auth-page{grid-template-columns:1fr}.auth-brand-panel{min-height:14rem;padding:1.5rem}.auth-brand-copy{margin-top:2.5rem}.auth-brand-copy h2{font-size:2rem}.auth-meta{display:none}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.quick-links,.section-grid{grid-template-columns:1fr}.app-shell{grid-template-columns:14rem minmax(0,1fr)}}@media(max-width:680px){.app-shell{grid-template-columns:1fr}.sidebar{position:static;height:auto}.brand{padding-bottom:.75rem}.nav{display:flex;overflow:auto;padding-bottom:.2rem}.nav-label{display:none}.nav a{white-space:nowrap}.sidebar-footer{display:none}.topbar{display:none}.content{padding:1rem}.page-head{align-items:flex-start;flex-direction:column}.field-grid,.stats{grid-template-columns:1fr}.field.full{grid-column:auto}.panel.flush{overflow:auto}th,td{white-space:nowrap}.auth-workspace{padding:1rem}.auth-card{padding:1.35rem}.auth-brand-panel{min-height:11rem}.auth-brand-copy{display:none}}
@media(max-width:800px){.app-shell{grid-template-columns:minmax(0,1fr);width:100%}.sidebar,.workspace,.content{min-width:0;max-width:100%}.sidebar{position:static;height:auto}.brand{padding-bottom:.75rem}.nav{display:flex;min-width:0;max-width:100%;overflow:auto;padding-bottom:.2rem}.nav-label{display:none}.nav a{white-space:nowrap}.sidebar-footer{display:none}.topbar{display:none}.content{padding:1rem}.page-head{align-items:flex-start;flex-direction:column}.panel.flush{max-width:100%;overflow:auto}}
:root{color-scheme:dark;--ink:#daf7dc;--muted:#aac4ca;--line:#2f4858;--panel:#132832;--canvas:#0b1820;--brand:#86bbd8;--brand-strong:#336699;--accent:#9ee493;--danger:#ffaaa7;--shadow:0 18px 45px rgba(0,0,0,.24)}
.panel-actions{padding:1.2rem 1.35rem;border-top:1px solid rgba(134,187,216,.18)}.integration-actions{display:grid;gap:.85rem}.integration-actions form{display:inline-flex}
html,body{background:var(--canvas);color:var(--ink)}body{accent-color:var(--accent)}::selection{background:var(--brand-strong);color:var(--ink)}a{color:var(--brand)}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid rgba(158,228,147,.42);outline-offset:2px}.skip-link{background:var(--accent);color:#0b1820}.app-shell{background:var(--canvas)}.sidebar{background:#08141a;border-right:1px solid rgba(134,187,216,.2)}.brand{color:var(--ink)}.brand-mark{display:block;width:2.75rem;height:2.75rem;object-fit:contain;border-radius:0;background:transparent;color:inherit;letter-spacing:normal}.brand-copy strong{color:var(--ink)}.brand-copy small{color:var(--brand)}.nav-label{color:#7093a3}.nav a{color:#b9d3d8}.nav a:hover{background:rgba(134,187,216,.1);color:var(--ink)}.nav a[aria-current=page]{background:rgba(51,102,153,.45);color:var(--ink);box-shadow:inset 3px 0 0 var(--accent)}.sidebar-footer{border-color:rgba(134,187,216,.18)}.link-button{color:#b9d3d8}.link-button:hover{color:var(--accent)}.workspace{background:var(--canvas)}.topbar{background:rgba(11,24,32,.94);border-color:rgba(134,187,216,.2);backdrop-filter:blur(12px)}.topbar strong{color:var(--ink)}.topbar p{color:var(--muted)}.environment{color:var(--accent);background:rgba(158,228,147,.08);border-color:rgba(158,228,147,.3)}.environment:before{background:var(--accent)}.eyebrow{color:var(--accent)}h1,h2,h3{color:var(--ink)}.page-subtitle,.lede,.help{color:var(--muted)}.button,button{background:var(--accent);border-color:var(--accent);color:#0b1820;box-shadow:0 8px 22px rgba(0,0,0,.16)}.button:hover,button:hover{background:#b6efad;border-color:#b6efad;color:#0b1820}.button.secondary,button.secondary{background:transparent;color:var(--brand);border-color:rgba(134,187,216,.52);box-shadow:none}.button.secondary:hover,button.secondary:hover{background:rgba(134,187,216,.1);color:var(--ink);border-color:var(--brand)}.button.danger,button.danger{background:transparent;color:var(--danger);border-color:rgba(255,170,167,.5);box-shadow:none}.button.danger:hover,button.danger:hover{background:rgba(255,170,167,.1);border-color:var(--danger)}.panel,.stat{background:var(--panel);border-color:rgba(134,187,216,.2);box-shadow:var(--shadow)}.panel-header{border-color:rgba(134,187,216,.18)}.stat dt{color:var(--brand)}.stat dd{color:var(--ink)}.stat small{color:var(--muted)}.empty{color:var(--muted)}.empty strong{color:var(--ink)}.notice{border-color:rgba(158,228,147,.34);background:rgba(158,228,147,.08);color:var(--ink)}.notice.error{border-color:rgba(255,170,167,.45);background:rgba(255,170,167,.08);color:#ffd0ce}.badge{background:rgba(158,228,147,.12);color:var(--accent);border:1px solid rgba(158,228,147,.22)}.badge.disabled{background:rgba(255,170,167,.09);color:#ffc0bd;border-color:rgba(255,170,167,.2)}.badge.neutral{background:rgba(134,187,216,.1);color:var(--brand);border-color:rgba(134,187,216,.2)}th,td{border-color:rgba(134,187,216,.15)}thead th{background:#0f222b;color:var(--brand)}tbody tr:hover{background:rgba(134,187,216,.055)}label{color:var(--ink)}input,select,textarea{background:#0d2029;color:var(--ink);border-color:rgba(134,187,216,.35)}input::placeholder,textarea::placeholder{color:#78929a}input:focus,select:focus,textarea:focus{border-color:var(--accent);outline:3px solid rgba(158,228,147,.18)}input[type=checkbox]{width:auto}select{color-scheme:dark}code{color:#bce7f5}.detail-list dt{color:var(--muted)}.detail-list dd{color:var(--ink)}.alert-card{border-color:rgba(134,187,216,.2);background:#10242d}.quick-link{background:#10242d;color:var(--ink);border-color:rgba(134,187,216,.2)}.quick-link:hover{background:#162f3a;border-color:var(--brand);box-shadow:var(--shadow)}.quick-link span{color:var(--muted)}.surface-note{border-color:rgba(134,187,216,.26);background:rgba(51,102,153,.13);color:var(--ink)}.auth-page{background:var(--canvas)}.auth-brand-panel{background:#08141a;color:var(--ink);border-right:1px solid rgba(134,187,216,.2)}.auth-brand{color:var(--ink)}.auth-brand-copy .eyebrow{color:var(--accent)}.auth-brand-copy p,.auth-meta{color:var(--muted)}.auth-workspace{background:radial-gradient(circle at 85% 10%,rgba(51,102,153,.18),transparent 32%),var(--canvas)}.auth-card{background:var(--panel);border-color:rgba(134,187,216,.23);box-shadow:0 24px 70px rgba(0,0,0,.35)}.auth-card form+form{border-color:rgba(134,187,216,.18)}.auth-card-footer{color:var(--muted)}
.auth-workspace{background:var(--canvas)}
@media(max-width:900px){.auth-brand-panel{border-right:0;border-bottom:1px solid rgba(134,187,216,.2)}}
@media(max-width:680px){th,td{white-space:normal;padding:.68rem .52rem}.site-table th:nth-child(2),.site-table td:nth-child(2){display:none}.table-action{white-space:normal}.table-action .button{padding:.48rem .55rem;font-size:.78rem}}
`;

export function renderOrapShell(input: {
  actions?: string;
  content: string;
  current: OrapNavigationItem;
  eyebrow?: string;
  heading: string;
  notice?: { kind?: 'error' | 'success'; message: string };
  navigation?: readonly OrapNavigationItem[];
  title: string;
}): string {
  const current = (item: OrapNavigationItem) =>
    input.current === item ? ' aria-current="page"' : '';
  const notice = input.notice
    ? `<div class="notice${input.notice.kind === 'error' ? ' error' : ''}" role="status" tabindex="-1">${escapeHtml(input.notice.message)}</div>`
    : '';
  const navigation = new Set(input.navigation ?? ['overview', 'sites', 'operations', 'security']);
  const overviewLink = navigation.has('overview')
    ? `<p class="nav-label">Workspace</p><a href="/orap"${current('overview')}>Overview</a>`
    : '';
  const siteLink = navigation.has('sites')
    ? `<p class="nav-label">Portfolio</p><a href="/orap/sites"${current('sites')}>Customer sites</a>`
    : '';
  const operationsLink = navigation.has('operations')
    ? `<p class="nav-label">Operations</p><a href="/orap/operations"${current('operations')}>Jobs &amp; alerts</a>`
    : '';
  const securityLink = navigation.has('security')
    ? `<p class="nav-label">Account</p><a href="/security"${current('security')}>Security settings</a>`
    : '';
  const staffLink = navigation.has('staff')
    ? `<p class="nav-label">Owner controls</p><a href="/orap/security/staff"${current('staff')}>Team &amp; access</a>`
    : '';
  const home = navigation.has('overview')
    ? '/orap'
    : navigation.has('sites')
      ? '/orap/sites'
      : navigation.has('operations')
        ? '/orap/operations'
        : '/security';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><meta name="theme-color" content="#0b1820"><link rel="icon" type="image/png" href="/assets/omnireach-logo.png"><link rel="stylesheet" href="/assets/admin.css?v=orap-3"><title>${escapeHtml(input.title)} | OmniReach Administration</title></head><body><a class="skip-link" href="#main">Skip to content</a><div class="app-shell"><aside class="sidebar"><a class="brand" href="${home}"><img class="brand-mark" src="/assets/omnireach-logo.png" alt="" width="48" height="48"><span class="brand-copy"><strong>OmniReach</strong><small>Agency operations</small></span></a><nav class="nav" aria-label="Administration">${overviewLink}${siteLink}${operationsLink}${staffLink}${securityLink}</nav><div class="sidebar-footer"><form method="post" action="/auth/logout"><button class="link-button" type="submit">Sign out</button></form></div></aside><div class="workspace"><main class="content" id="main"><div class="page-head"><div>${input.eyebrow ? `<p class="eyebrow">${escapeHtml(input.eyebrow)}</p>` : ''}<h1>${escapeHtml(input.heading)}</h1></div>${input.actions ?? ''}</div>${notice}${input.content}</main></div></div></body></html>`;
}

export function renderOrapStaffDirectory(
  staff: readonly OrapStaffSummary[],
  navigation?: readonly OrapNavigationItem[],
  notice?: { kind?: 'error' | 'success'; message: string },
): string {
  const rows = staff
    .map(
      (member) =>
        `<tr><th scope="row"><strong>${escapeHtml(member.displayName)}</strong><br><span class="help">${escapeHtml(member.normalizedEmail)}</span></th><td>${escapeHtml(formatIdentityKind(member.identityKind))}${member.jobTitle ? `<br><span class="help">${escapeHtml(member.jobTitle)}</span>` : ''}</td><td><span class="badge${member.status === 'active' ? '' : ' disabled'}">${escapeHtml(member.status)}</span></td><td>${member.emailCodeEnabled ? 'Email code' : 'Email code not enabled'}${member.strongFactorEnrolled ? '<br><span class="help">Strong factor enrolled</span>' : ''}</td><td>${member.activeSessions}</td><td>${escapeHtml(member.lastLoginAt ?? 'Never')}</td><td><a href="/orap/security/staff/${encodeURIComponent(member.userId)}">Open</a></td></tr>`,
    )
    .join('');
  const active = staff.filter(({ status }) => status === 'active').length;
  const owners = staff.filter(
    ({ identityKind, status }) => identityKind === 'platform_owner' && status === 'active',
  ).length;
  return renderOrapShell({
    actions: '<a class="button" href="/orap/security/staff/invite">Invite staff</a>',
    content: `<p class="page-subtitle">Owner-only directory of internal ORAP identities. Customer accounts are managed separately inside their website scope.</p><dl class="stats"><div class="stat"><dt>Active staff</dt><dd>${active}</dd><small>Including owners</small></div><div class="stat"><dt>Platform owners</dt><dd>${owners}</dd><small>Protected identity</small></div><div class="stat"><dt>Active sessions</dt><dd>${staff.reduce((total, member) => total + member.activeSessions, 0)}</dd><small>Privileged sessions</small></div></dl><section class="surface-note"><strong>You are signed in as a Platform Owner.</strong> You can invite staff and manage another staff member's authority. Changes are logged automatically, and last-owner and session-revocation safeguards remain enforced.</section><section class="panel flush"><div class="panel-header"><div><h2>Internal staff</h2><p class="help">Authentication posture is shown without exposing factors, recovery codes, or session tokens.</p></div></div><table><caption>Internal ORAP staff accounts</caption><thead><tr><th>Staff member</th><th>Identity</th><th>Status</th><th>Verification</th><th>Sessions</th><th>Last login</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="7"><div class="empty"><strong>No staff records</strong>No internal identities are available.</div></td></tr>'}</tbody></table></section>`,
    current: 'staff',
    eyebrow: 'Owner controls',
    heading: 'Team & access',
    ...(navigation ? { navigation } : {}),
    ...(notice ? { notice } : {}),
    title: 'Team & access',
  });
}

export function renderOrapStaffDetails(
  member: OrapStaffSummary,
  input: {
    currentUserId: string;
    notice?: { kind?: 'error' | 'success'; message: string };
    roles?: readonly OrapStaffRoleOption[];
  },
  navigation?: readonly OrapNavigationItem[],
): string {
  const mayMutate = member.status === 'active' && member.userId !== input.currentUserId;
  const profileEditor = `<section class="panel"><h2>Edit account</h2><p class="help">A Platform Owner can update this account's profile or replace its password. Current passwords, password hashes, verification secrets, internal IDs, and audit history are never displayed or editable. Saving revokes every active ORAP session for this account; mandatory two-step verification still applies at the next login. The change is recorded automatically.</p><form method="post" action="/orap/security/staff/${encodeURIComponent(member.userId)}/profile"><div class="field-grid"><div class="field"><label for="displayName">Name</label><input id="displayName" name="displayName" value="${escapeHtml(member.displayName)}" maxlength="160" required></div><div class="field"><label for="email">Email</label><input id="email" name="email" type="email" value="${escapeHtml(member.normalizedEmail)}" maxlength="320" required></div><div class="field full"><label for="jobTitle">Job title</label><input id="jobTitle" name="jobTitle" value="${escapeHtml(member.jobTitle ?? '')}" maxlength="160"></div><div class="field"><label for="newPassword">New password</label><input id="newPassword" name="newPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password"><p class="help">Leave blank to keep the current password.</p></div><div class="field"><label for="confirmPassword">Confirm new password</label><input id="confirmPassword" name="confirmPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password"></div></div><button type="submit">Save account details</button></form></section>`;
  const authorityOptions = [
    platformOwnerAuthority,
    ...(input.roles ?? []).filter(({ slug }) => slug !== platformOwnerAuthority.slug),
  ];
  const roleOptions = authorityOptions
    .map((role) => {
      const selected =
        member.roleSlug === role.slug ||
        (role.slug === platformOwnerAuthority.slug && member.identityKind === 'platform_owner');
      return `<option value="${escapeHtml(role.slug)}"${selected ? ' selected' : ''}>${escapeHtml(role.name)}</option>`;
    })
    .join('');
  const actionContent = mayMutate
    ? `<section class="panel"><h2>Authority</h2><p class="help">Platform Owner grants the same owner-level authority you have. Changing authority takes effect immediately, signs this person out, and is recorded automatically.</p><form method="post" action="/orap/security/staff/${encodeURIComponent(member.userId)}/role"><div class="field"><label for="roleSlug">Authority level</label><select id="roleSlug" name="roleSlug" required>${roleOptions}</select></div><button type="submit">Update authority</button></form></section><div class="section-grid"><section class="panel"><h2>Revoke sessions</h2><p class="help">Signs this staff member out of every active ORAP session.</p><form method="post" action="/orap/security/staff/${encodeURIComponent(member.userId)}/sessions/revoke-all"><button type="submit">Revoke all sessions</button></form></section><section class="panel"><h2>Send password reset</h2><p class="help">Creates a time-limited recovery message. Required privileged verification still applies.</p><form method="post" action="/orap/security/staff/${encodeURIComponent(member.userId)}/reset"><button type="submit">Send reset instructions</button></form></section></div><section class="panel"><h2>Disable staff access</h2><p class="help">Revokes privileged sessions and removes ORAP access. Public customer websites remain online.</p><form method="post" action="/orap/security/staff/${encodeURIComponent(member.userId)}/disable"><button class="danger" type="submit">Disable staff access</button></form></section>`
    : `<section class="surface-note">${member.userId === input.currentUserId ? 'This is your owner account. Self-disable and self-demotion are blocked so the platform cannot lose its final owner. Use Security settings to manage your own sign-in methods.' : 'This staff account is not active.'}</section>`;
  return renderOrapShell({
    actions: '<a class="button secondary" href="/orap/security/staff">Back to team</a>',
    content: `<section class="panel"><h2>Staff identity</h2><dl class="detail-list"><dt>Name</dt><dd>${escapeHtml(member.displayName)}</dd><dt>Email</dt><dd>${escapeHtml(member.normalizedEmail)}</dd><dt>Identity</dt><dd>${escapeHtml(formatIdentityKind(member.identityKind))}</dd><dt>Assigned role</dt><dd>${escapeHtml(member.roleName ?? formatIdentityKind(member.identityKind))}</dd><dt>Status</dt><dd><span class="badge${member.status === 'active' ? '' : ' disabled'}">${escapeHtml(member.status)}</span></dd><dt>Email codes</dt><dd>${member.emailCodeEnabled ? 'Enabled' : 'Not enabled'}</dd><dt>Strong factor</dt><dd>${member.strongFactorEnrolled ? 'Enrolled' : 'Not enrolled'}</dd><dt>Active sessions</dt><dd>${member.activeSessions}</dd><dt>Last login</dt><dd>${escapeHtml(member.lastLoginAt ?? 'Never')}</dd><dt>User ID</dt><dd><code>${escapeHtml(member.userId)}</code></dd></dl></section>${profileEditor}${actionContent}`,
    current: 'staff',
    eyebrow: 'Owner controls',
    heading: member.displayName,
    ...(navigation ? { navigation } : {}),
    ...(input.notice ? { notice: input.notice } : {}),
    title: member.displayName,
  });
}

export function renderOrapStaffInviteForm(
  roles: readonly OrapStaffRoleOption[],
  error?: string,
  navigation?: readonly OrapNavigationItem[],
): string {
  const roleOptions = roles
    .map(
      (role) =>
        `<option value="${escapeHtml(role.slug)}">${escapeHtml(role.name)} — ${role.permissionCount} permissions</option>`,
    )
    .join('');
  return renderOrapShell({
    actions: '<a class="button secondary" href="/orap/security/staff">Back to team</a>',
    content: `${error ? `<div class="notice error" role="alert">${escapeHtml(error)}</div>` : ''}<section class="panel"><h2>Send a secure invitation</h2><p class="help">The recipient creates their own password and completes mandatory email verification. Invitation links expire after seven days and can be used once. The invitation is recorded automatically.</p><form method="post" action="/orap/security/staff/invite"><div class="field"><label for="displayName">Name</label><input id="displayName" name="displayName" maxlength="160" required autofocus></div><div class="field"><label for="email">Work email</label><input id="email" name="email" type="email" maxlength="320" required></div><div class="field"><label for="jobTitle">Job title</label><input id="jobTitle" name="jobTitle" maxlength="160"></div><div class="field"><label for="roleSlug">Staff role</label><select id="roleSlug" name="roleSlug" required>${roleOptions}</select></div><button type="submit">Send invitation</button></form></section>`,
    current: 'staff',
    eyebrow: 'Owner controls',
    heading: 'Invite staff',
    ...(navigation ? { navigation } : {}),
    title: 'Invite staff',
  });
}

export function renderOrapOverview(
  model: OrapOverviewModel,
  canCreateSite: boolean,
  navigation?: readonly OrapNavigationItem[],
): string {
  const activeSites = model.sites.filter(({ status }) => status === 'active').length;
  const customers = new Set(model.sites.map(({ tenantId, tenantName }) => tenantId ?? tenantName))
    .size;
  const criticalAlerts = model.alerts.filter(
    ({ severity, state }) => severity === 'critical' && state !== 'resolved',
  );
  const failedJobs = model.jobs.filter(({ state }) => state === 'failed');
  const spend = model.budget ? formatUsd(model.budget.usedUsdMicros) : 'Restricted';
  const attention = [
    ...criticalAlerts
      .slice(0, 5)
      .map(
        ({ message }) =>
          `<li><span class="badge disabled">Critical</span> <strong>${escapeHtml(message)}</strong></li>`,
      ),
    ...failedJobs
      .slice(0, Math.max(0, 5 - criticalAlerts.length))
      .map(
        ({ category }) =>
          `<li><span class="badge neutral">Failed job</span> ${escapeHtml(category)}</li>`,
      ),
  ].join('');
  const recentSites = model.sites
    .slice(0, 6)
    .map((site) => {
      const identifier = site.id ?? site.name;
      return `<tr><th scope="row">${escapeHtml(site.name)}</th><td>${escapeHtml(site.tenantName)}</td><td><span class="badge${site.status === 'disabled' ? ' disabled' : ''}">${escapeHtml(site.status)}</span></td><td><a href="/orap/sites/${encodeURIComponent(identifier)}">Open</a></td></tr>`;
    })
    .join('');
  return renderOrapShell({
    ...(canCreateSite
      ? { actions: '<a class="button" href="/orap/sites/new">Add customer site</a>' }
      : {}),
    content: `<p class="page-subtitle">Your authorized OmniReach operation at a glance. Every value comes from the current platform records.</p><dl class="stats"><div class="stat"><dt>Active websites</dt><dd>${activeSites}</dd><small>${model.sites.length} in scope</small></div><div class="stat"><dt>Customers</dt><dd>${customers}</dd><small>Authorized organizations</small></div><div class="stat"><dt>Critical alerts</dt><dd>${criticalAlerts.length}</dd><small>Open in your scope</small></div><div class="stat"><dt>AI spend</dt><dd>${spend}</dd><small>${model.budget ? 'Current UTC month' : 'Financial access required'}</small></div></dl><div class="section-grid"><section class="panel"><div class="panel-header"><div><h2>Requires attention</h2><p class="help">Critical incidents and failed automation.</p></div><a href="/orap/operations">View operations</a></div><ul class="alert-list">${attention || '<li class="empty"><strong>No urgent items</strong>No critical alerts or failed jobs are visible in your scope.</li>'}</ul></section><section class="panel"><h2>Platform controls</h2><div class="quick-links"><a class="quick-link" href="/orap/sites"><strong>Customer sites</strong><span>Open websites and onboarding records.</span></a><a class="quick-link" href="/orap/operations"><strong>Jobs &amp; alerts</strong><span>Review failures and operational incidents.</span></a><a class="quick-link" href="/security"><strong>Account security</strong><span>Manage your verification methods.</span></a></div></section></div><section class="panel flush"><div class="panel-header"><div><h2>Websites</h2><p class="help">The first sites in your current authorization scope.</p></div><a href="/orap/sites">View all</a></div>${recentSites ? `<table><caption>Authorized websites</caption><thead><tr><th>Website</th><th>Customer</th><th>Status</th><th>Action</th></tr></thead><tbody>${recentSites}</tbody></table>` : '<div class="empty"><strong>No customer websites yet</strong>Add the first site when its source contract is ready.</div>'}</section>`,
    current: 'overview',
    eyebrow: 'Operations overview',
    heading: 'Overview',
    ...(navigation ? { navigation } : {}),
    title: 'Overview',
  });
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

export function renderOrapDashboard(
  sites: readonly OrapSiteSummary[],
  notice?: string,
  canCreateSite = true,
  navigation?: readonly OrapNavigationItem[],
): string {
  const activeSites = sites.filter(({ status }) => status === 'active').length;
  const disabledSites = sites.length - activeSites;
  const customers = new Set(sites.map(({ tenantId, tenantName }) => tenantId ?? tenantName)).size;
  const rows = sites
    .map((site) => {
      const identifier = site.id ?? site.name;
      return `<tr><th scope="row">${escapeHtml(site.name)}</th><td>${escapeHtml(site.tenantName)}</td><td><span class="badge${site.status === 'disabled' ? ' disabled' : ''}">${escapeHtml(site.status)}</span></td><td class="table-action"><a class="button secondary" href="/orap/sites/${encodeURIComponent(identifier)}">Open site</a></td></tr>`;
    })
    .join('');
  const body = rows
    ? `<table class="site-table"><caption>Sites authorized for this staff account</caption><thead><tr><th scope="col">Site</th><th scope="col">Tenant</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty"><strong>No customer sites yet</strong>Add the first managed site when its repository path and owner approval are ready.</div>';
  return renderOrapShell({
    ...(canCreateSite
      ? { actions: '<a class="button" href="/orap/sites/new">Add customer site</a>' }
      : {}),
    content: `<p class="page-subtitle">Manage the websites and customers assigned to this account.</p><dl class="stats"><div class="stat"><dt>Customer sites</dt><dd>${sites.length}</dd><small>Authorized portfolio</small></div><div class="stat"><dt>Active</dt><dd>${activeSites}</dd><small>Serving or ready</small></div><div class="stat"><dt>Customers</dt><dd>${customers}</dd><small>Organizations</small></div><div class="stat"><dt>Needs attention</dt><dd>${disabledSites}</dd><small>Disabled sites</small></div></dl><section class="panel flush"><div class="panel-header"><div><h2>Managed sites</h2><p class="help">Only sites within your current authorization scope appear here.</p></div></div>${body}</section>`,
    current: 'sites',
    eyebrow: 'Portfolio',
    heading: 'Customer sites',
    ...(navigation ? { navigation } : {}),
    ...(notice ? { notice: { message: notice } } : {}),
    title: 'Sites',
  });
}

export function renderOrapSiteForm(
  error?: string,
  navigation?: readonly OrapNavigationItem[],
): string {
  return renderOrapShell({
    content: `<section class="panel"><p class="lede">Register an agency-built website and its tenant. This creates platform records only; it does not change DNS or deploy a site.</p>${error ? `<div class="notice error" role="alert">${escapeHtml(error)}</div>` : ''}<form method="post" action="/orap/sites"><div class="field-grid"><div class="field"><label for="tenantName">Customer or organization</label><input id="tenantName" name="tenantName" maxlength="160" autocomplete="organization" required></div><div class="field"><label for="siteName">Site name</label><input id="siteName" name="siteName" maxlength="160" required></div><div class="field full"><label for="sourcePath">Repository source path</label><input id="sourcePath" name="sourcePath" value="sites/" pattern="sites/[a-z0-9_-]+" maxlength="300" required><p class="help">Use a path such as <code>sites/copper-spoon</code>.</p></div><div class="field full"><label for="reason">Audit reason</label><textarea id="reason" name="reason" minlength="3" maxlength="500" rows="3" required></textarea><p class="help">Explain why this site is being registered. This is retained in the audit record.</p></div></div><div class="actions"><button type="submit">Create site record</button><a class="button secondary" href="/orap/sites">Cancel</a></div></form></section>`,
    current: 'sites',
    eyebrow: 'Site onboarding',
    heading: 'Add customer site',
    ...(navigation ? { navigation } : {}),
    title: 'Add site',
  });
}

export function renderOrapSiteDetails(
  site: OrapSiteSummary,
  navigation?: readonly OrapNavigationItem[],
  management?: OrapSiteManagementModel,
  permissions: {
    canEditAutomation?: boolean;
    canEditBudget?: boolean;
    canEditSubscription?: boolean;
    canManageGoogle?: boolean;
    notice?: string | undefined;
  } = {},
): string {
  const effective = management ? renderEffectiveSiteManagement(site, management, permissions) : '';
  return renderOrapShell({
    actions: '<a class="button secondary" href="/orap/sites">Back to sites</a>',
    content: `${permissions.notice ? `<div class="notice" role="status">${escapeHtml(permissions.notice)}</div>` : ''}<section class="panel"><h2>Site record</h2><dl class="detail-list"><dt>Site</dt><dd>${escapeHtml(site.name)}</dd><dt>Tenant</dt><dd>${escapeHtml(site.tenantName)}</dd><dt>Status</dt><dd><span class="badge${site.status === 'disabled' ? ' disabled' : ''}">${escapeHtml(site.status)}</span></dd>${site.id ? `<dt>Site ID</dt><dd><code>${escapeHtml(site.id)}</code></dd>` : ''}${site.tenantId ? `<dt>Tenant ID</dt><dd><code>${escapeHtml(site.tenantId)}</code></dd>` : ''}</dl></section>${effective || '<section class="panel"><h2>Management controls</h2><p class="lede">Effective controls are unavailable for this account.</p></section>'}`,
    current: 'sites',
    eyebrow: 'Site management',
    heading: site.name,
    ...(navigation ? { navigation } : {}),
    title: site.name,
  });
}

function renderEffectiveSiteManagement(
  site: OrapSiteSummary,
  management: OrapSiteManagementModel,
  permissions: {
    canEditAutomation?: boolean;
    canEditBudget?: boolean;
    canEditSubscription?: boolean;
    canManageGoogle?: boolean;
  },
): string {
  if (!site.id || !site.tenantId) return '';
  const hidden = `<input type="hidden" name="tenantId" value="${escapeHtml(site.tenantId)}">`;
  const subscription = management.subscription;
  const planOptions = management.plans
    .map(
      (plan) =>
        `<option value="${escapeHtml(plan.id)}"${subscription?.planId === plan.id ? ' selected' : ''}>${escapeHtml(plan.code)} v${plan.version}${plan.commercialStatus === 'approved' ? '' : ' — draft commercial terms'}</option>`,
    )
    .join('');
  const features = management.features
    .map(
      (feature) =>
        `<tr><th scope="row">${escapeHtml(feature.key)}</th><td>${feature.enabled ? 'Enabled' : 'Disabled'}</td><td>${escapeHtml(feature.readiness)}</td></tr>`,
    )
    .join('');
  const integrations = management.integrations
    .map(
      (integration) =>
        `<tr><th scope="row">${escapeHtml(integration.propertyKind)}</th><td>${escapeHtml(integration.status)}</td><td>${escapeHtml(integration.lastSyncedAt ?? 'Never')}</td></tr>`,
    )
    .join('');
  const planControl = permissions.canEditSubscription
    ? `<form method="post" action="/orap/sites/${encodeURIComponent(site.id)}/plan">${hidden}<label for="planId">Assigned plan</label><select id="planId" name="planId" required>${planOptions}</select><label for="planReason">Audit reason</label><textarea id="planReason" name="reason" minlength="3" maxlength="500" required></textarea><button type="submit">Assign plan</button></form><form method="post" action="/orap/sites/${encodeURIComponent(site.id)}/subscription">${hidden}<label for="subscriptionStatus">Subscription status</label><select id="subscriptionStatus" name="status"><option value="active"${subscription?.status === 'active' ? ' selected' : ''}>Active</option><option value="past_due"${subscription?.status === 'past_due' ? ' selected' : ''}>Past due (public site stays online)</option><option value="cancelled"${subscription?.status === 'cancelled' ? ' selected' : ''}>Cancelled (public site stays online)</option></select><label for="subscriptionReason">Audit reason</label><textarea id="subscriptionReason" name="reason" minlength="3" maxlength="500" required></textarea><button type="submit">Update subscription</button></form>`
    : '<p class="help">Subscription changes require the subscriptions permission.</p>';
  const emergencyControl = permissions.canEditAutomation
    ? `<form method="post" action="/orap/sites/${encodeURIComponent(site.id)}/emergency">${hidden}<input type="hidden" name="policyVersion" value="${management.emergency.policyVersion + 1}"><label><input type="checkbox" name="editingFrozen" value="true"${management.emergency.editingFrozen ? ' checked' : ''}> Freeze editing</label><label><input type="checkbox" name="automationStopped" value="true"${management.emergency.automationStopped ? ' checked' : ''}> Stop automation</label><label><input type="checkbox" name="autonomousChangesStopped" value="true"${management.emergency.autonomousChangesStopped ? ' checked' : ''}> Stop autonomous changes</label><label for="emergencyReason">Audit reason</label><textarea id="emergencyReason" name="reason" minlength="3" maxlength="500" required></textarea><button type="submit">Apply emergency controls</button></form>`
    : '<p class="help">Emergency changes require the automation-control permission.</p>';
  const budgetControl = permissions.canEditBudget
    ? `<form method="post" action="/orap/sites/${encodeURIComponent(site.id)}/ai-budget">${hidden}<input type="hidden" name="policyVersion" value="${(management.budget?.policyVersion ?? 0) + 1}"><label for="budgetUsd">Monthly AI ceiling in USD</label><input id="budgetUsd" name="budgetUsd" type="number" min="0" max="10000" step="0.01" value="${((management.budget?.capUsdMicros ?? 0) / 1_000_000).toFixed(2)}" required><label for="budgetReason">Audit reason</label><textarea id="budgetReason" name="reason" minlength="3" maxlength="500" required></textarea><button type="submit">Update hard ceiling</button></form>`
    : '<p class="help">Budget changes require the site AI-budget permission.</p>';
  const googleControls = permissions.canManageGoogle
    ? `<div class="integration-actions"><p class="help">Authorize each read-only Google data source separately. OmniReach never receives your Google password.</p><div class="actions"><form method="post" action="/orap/sites/${encodeURIComponent(site.id)}/integrations/google/start"><input type="hidden" name="propertyKind" value="search_console"><button type="submit">Connect Search Console</button></form><form method="post" action="/orap/sites/${encodeURIComponent(site.id)}/integrations/google/start"><input type="hidden" name="propertyKind" value="ga4"><button type="submit">Connect Google Analytics</button></form></div></div>`
    : '<p class="help">Google connections require the integrations management permission.</p>';
  return `<section class="panel"><h2>Effective subscription</h2><dl class="detail-list"><dt>Plan</dt><dd>${escapeHtml(subscription ? `${subscription.code} v${subscription.version}` : 'Not assigned')}</dd><dt>Status</dt><dd>${escapeHtml(subscription?.status ?? 'Not assigned')}</dd><dt>Seats</dt><dd>${subscription?.customerSeatLimit ?? 0}</dd><dt>Pages</dt><dd>${subscription?.standardPageLimit ?? 0}</dd><dt>SEO cadence</dt><dd>${subscription ? `${subscription.seoAuditIntervalHours} hours` : 'Unavailable'}</dd><dt>AI review cycles</dt><dd>${subscription?.aiReviewCyclesPerMonth ?? 0}</dd><dt>Grace ends</dt><dd>${escapeHtml(subscription?.graceEndsAt ?? 'None')}</dd><dt>Public availability</dt><dd>${management.availability.activeArtifact && management.availability.publicDomain ? 'Published static site available' : 'Not fully activated'}</dd></dl><p class="help">Past-due or cancelled billing state never removes an existing static artifact.</p>${planControl}</section><section class="panel flush"><div class="panel-header"><h2>Effective features</h2></div><table><caption>Effective feature settings</caption><thead><tr><th>Feature</th><th>State</th><th>Readiness</th></tr></thead><tbody>${features || '<tr><td colspan="3">No feature definitions found.</td></tr>'}</tbody></table></section><section class="panel"><h2>Emergency controls</h2>${emergencyControl}</section><section class="panel"><h2>AI cost ceiling</h2><p class="help">Provider execution remains separately disabled until owner approval.</p>${budgetControl}</section><section class="panel flush"><div class="panel-header"><div><h2>Integrations</h2><p class="help">Read-only reporting connections for this website.</p></div></div><table><caption>Connected data providers</caption><thead><tr><th>Property</th><th>Status</th><th>Last sync</th></tr></thead><tbody>${integrations || '<tr><td colspan="3">Not connected</td></tr>'}</tbody></table><div class="panel-actions">${googleControls}</div></section>`;
}

export function renderOrapNotFound(navigation?: readonly OrapNavigationItem[]): string {
  return renderOrapShell({
    content:
      '<section class="panel"><p class="lede">That site is not available to this administration account.</p><a class="button secondary" href="/orap/sites">Return to sites</a></section>',
    current: 'sites',
    eyebrow: 'Not found',
    heading: 'Site unavailable',
    ...(navigation ? { navigation } : {}),
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

function formatUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

function formatIdentityKind(kind: OrapStaffSummary['identityKind']): string {
  if (kind === 'platform_owner') return 'Platform Owner';
  if (kind === 'platform_admin') return 'Platform Admin';
  return 'Staff';
}
