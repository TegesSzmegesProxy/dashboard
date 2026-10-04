import { useAuth0 } from '@auth0/auth0-react';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { useResource, type Organization, type Page, type Project } from './api';
import { Badge, Button, Icon, IconButton, type IconName } from './components';
import { Loading, Note } from './ui';

interface OrgCtx {
  org: Organization;
  /** owner/admin may mutate; viewers get read-only UI. The backend still enforces. */
  canEdit: boolean;
  projects: Project[];
  reloadProjects: () => void;
  base: string;
}
const Ctx = createContext<OrgCtx | null>(null);

/** Project sections, each a route under `projects/:tenantId/`. */
export const PROJECT_SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'layers' },
  { id: 'operations', label: 'Operations', icon: 'activity' },
  { id: 'policies', label: 'Policies', icon: 'file-code' },
  { id: 'analyses', label: 'Analyses', icon: 'scan-line' },
  { id: 'tuning', label: 'Tuning', icon: 'sliders-horizontal' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];
export function useOrg(): OrgCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useOrg outside Layout');
  return c;
}

export function Layout() {
  const { orgId = '', tenantId } = useParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth0();
  const orgs = useResource<Page<Organization>>('/organizations?limit=100');
  const org = useResource<Organization>(`/organizations/${orgId}`);
  // ponytail: sidebar shows the first 100 projects; add paging when an org outgrows it.
  const projects = useResource<Page<Project>>(`/organizations/${orgId}/projects?limit=100`);

  if (org.error) return <div className="center"><Note tone="error">{org.error}</Note></div>;
  if (!org.data) return <div className="center"><Loading what="organization" /></div>;

  const base = `/orgs/${orgId}`;
  const ctx: OrgCtx = {
    org: org.data,
    canEdit: org.data.role !== 'viewer',
    projects: projects.data?.items ?? [],
    reloadProjects: projects.reload,
    base,
  };
  // Auth0 often fills `name` with the email; the sidebar shows a name only.
  const userName = user?.name && !user.name.includes('@') ? user.name : user?.nickname ?? 'Signed in';
  try { localStorage.setItem('tessera.org', orgId); } catch { /* storage unavailable */ }

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <aside className="sidebar">
          <Link to={base} className="wordmark">TESSERA</Link>
          <nav className="nav" aria-label="Primary">
            <NavLink to={base} end><Icon name="gauge" />Dashboard</NavLink>
            <div className="nav-label eyebrow">Settings</div>
            <div className="nav-compact">
              <NavLink to={`${base}/settings`}><Icon name="settings" />General</NavLink>
              <NavLink to={`${base}/api-keys`}><Icon name="key-round" />API keys</NavLink>
            </div>
            <div className="nav-label eyebrow">Projects</div>
            {ctx.projects.map((p) => (
              <ProjectNav key={p.id} project={p} to={`${base}/projects/${p.id}`} current={p.id === tenantId} />
            ))}
            {projects.data && ctx.projects.length === 0 && <span className="nav-label faint small">No projects yet.</span>}
          </nav>
          <AccountDrawer name={userName} email={user?.email} role={org.data.role} canEdit={ctx.canEdit}
            onSignOut={() => logout({ logoutParams: { returnTo: window.location.origin } })}>
            <label className="org-switch">
              <span className="eyebrow" style={{ display: 'block', margin: '0 0 var(--space-1)' }}>Organization</span>
              <select value={orgId} onChange={(e) => navigate(e.target.value === '+' ? '/?new' : `/orgs/${e.target.value}`)}>
                {(orgs.data?.items ?? [org.data]).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                <option value="+">+ New organization</option>
              </select>
            </label>
          </AccountDrawer>
        </aside>
        <div className="main">
          <header className="topbar">
            <div className="crumbs"><strong>{org.data.name}</strong></div>
          </header>
          <main className="content">
            <Outlet />
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}

function ProjectNav({ project, to, current }: { project: Project; to: string; current: boolean }) {
  const [open, setOpen] = useState(current);
  const [wasCurrent, setWasCurrent] = useState(current);
  // Expand when navigation lands on this project; the user may still collapse it.
  if (current !== wasCurrent) {
    setWasCurrent(current);
    if (current) setOpen(true);
  }
  return (
    <div className="nav-group">
      <button type="button" className={current ? 'current' : undefined} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="shield" />
        <span className="grow">{project.name}</span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} />
      </button>
      {open && (
        <div className="nav-sub">
          {PROJECT_SECTIONS.map((s) => (
            <NavLink key={s.id} to={`${to}/${s.id}`}><Icon name={s.icon} />{s.label}</NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountDrawer({ name, email, role, canEdit, onSignOut, children }: { name: string; email?: string; role: string; canEdit: boolean; onSignOut: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={open ? 'sidebar-foot open' : 'sidebar-foot'}>
      <div className="user">
        <span className="user-id">
          <span className="user-name" title={name}>{name}</span>
          {open && email && <span className="user-meta" title={email}>{email}</span>}
        </span>
        <IconButton icon="chevron-down" label={open ? 'Hide account' : 'Show account'} size="sm"
          aria-expanded={open} aria-controls="account-drawer" onClick={() => setOpen(!open)} />
      </div>
      <div id="account-drawer" className="drawer" inert={!open}>
        <div className="drawer-body">
          <div className="spread">
            <span className="eyebrow">Role</span>
            <Badge status={canEdit ? 'jev' : 'neutral'}>{role}</Badge>
          </div>
          {children}
          <Button variant="outline" size="sm" full iconLeft="log-out" onClick={onSignOut}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}
