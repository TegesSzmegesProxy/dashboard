import { useAuth0 } from '@auth0/auth0-react';
import { createContext, useContext } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { useResource, type Organization, type Page, type Project } from './api';
import { Badge, Icon, IconButton } from './ds';
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
export function useOrg(): OrgCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useOrg outside Layout');
  return c;
}

export function Layout() {
  const { orgId = '' } = useParams();
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
  try { localStorage.setItem('tessera.org', orgId); } catch { /* storage unavailable */ }

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <aside className="sidebar">
          <Link to={base} className="wordmark">TESSERA</Link>
          <label className="org-switch">
            <span className="eyebrow" style={{ display: 'block', margin: '0 var(--space-2) var(--space-1)' }}>Organization</span>
            <select value={orgId} onChange={(e) => navigate(e.target.value === '+' ? '/?new' : `/orgs/${e.target.value}`)}>
              {(orgs.data?.items ?? [org.data]).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              <option value="+">+ New organization</option>
            </select>
          </label>
          <nav className="nav" aria-label="Primary">
            <NavLink to={base} end><Icon name="gauge" />Dashboard</NavLink>
            <NavLink to={`${base}/api-keys`}><Icon name="key-round" />API keys</NavLink>
            <NavLink to={`${base}/settings`}><Icon name="settings" />Settings</NavLink>
            <div className="nav-label eyebrow">Projects</div>
            {ctx.projects.map((p) => (
              <NavLink key={p.id} to={`${base}/projects/${p.id}`}><Icon name="shield" />{p.name}</NavLink>
            ))}
            {projects.data && ctx.projects.length === 0 && <span className="nav-label faint small">No projects yet.</span>}
          </nav>
          <div className="sidebar-foot">
            <Badge status={ctx.canEdit ? 'jev' : 'neutral'}>{org.data.role}</Badge>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <div className="crumbs"><strong>{org.data.name}</strong></div>
            <span className="mono muted">{user?.email ?? user?.sub}</span>
            <IconButton icon="log-out" label="Sign out" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })} />
          </header>
          <main className="content">
            <Outlet />
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
