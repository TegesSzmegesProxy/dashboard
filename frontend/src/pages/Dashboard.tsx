import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi, useResource, type ApiKey, type GitHubInstallation, type Membership, type OperationsOverview, type Page, type Project } from '../api';
import { Badge, Button, Dialog, IconButton, Input, StatTile } from '../components';
import { useOrg } from '../Layout';
import { Note, PageHead, Section, useAction, when } from '../ui';
import { AiModelCard, JevIntegrationCard } from './Integrations';
import { emptyRuntime, RuntimeConfigFields, validateRuntime, type RuntimeDraft } from './RuntimeConfigFields';

const count = (p: Page<unknown> | null) => (p ? `${p.items.length}${p.nextCursor ? '+' : ''}` : '—');

/** Operations overview per project; a project whose read fails is simply absent. */
function useFleet(orgId: string, projects: Project[]) {
  const api = useApi();
  const [fleet, setFleet] = useState<Record<string, OperationsOverview>>({});
  const [done, setDone] = useState(false);
  const ids = projects.map((p) => p.id).join(',');
  useEffect(() => {
    let live = true;
    setDone(false);
    void Promise.allSettled(projects.map((p) => api<OperationsOverview>(`/organizations/${orgId}/projects/${p.id}/operations`).then((o) => [p.id, o] as const)))
      .then((rs) => {
        if (!live) return;
        setFleet(Object.fromEntries(rs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))));
        setDone(true);
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ids` stands in for `projects`
  }, [api, orgId, ids]);
  return { fleet, done };
}

function SystemOverview({ projects, fleet, done }: { projects: Project[]; fleet: Record<string, OperationsOverview>; done: boolean }) {
  const [i, setI] = useState(0);
  const all = Object.values(fleet);
  const sum = (f: (o: OperationsOverview) => number) => all.reduce((n, o) => n + f(o), 0);
  const slides = [
    { value: projects.length, label: 'Projects', sub: `${all.filter((o) => o.activeBundle).length} with an active bundle` },
    { value: sum((o) => o.lastHour.requests), label: 'Requests, last hour', sub: `${sum((o) => o.lastHour.decisions.block)} blocked across all projects` },
    { value: `${sum((o) => o.proxies.total - o.proxies.stale)} / ${sum((o) => o.proxies.total)}`, label: 'Proxies reporting', sub: `${sum((o) => o.proxies.restartRequired)} restart required · ${sum((o) => o.proxies.incompatible)} incompatible` },
    { value: sum((o) => o.openAlerts.critical + o.openAlerts.warning + o.openAlerts.info), label: 'Open alerts', sub: `${sum((o) => o.openAlerts.critical)} critical` },
  ];
  const s = slides[i]!;
  const go = (d: number) => setI((n) => (n + d + slides.length) % slides.length);
  const healthy = done && all.length > 0 && slides[3]!.value === 0;
  return (
    <Section title="System overview" desc="Key metrics across all projects." aside={<Badge status={!done ? 'neutral' : healthy ? 'passed' : 'review'}>{!done ? 'Checking' : healthy ? 'Healthy' : 'Needs attention'}</Badge>}>
      <div className="carousel" aria-roledescription="carousel">
        <IconButton icon="chevron-right" label="Previous slide" style={{ transform: 'scaleX(-1)' }} onClick={() => go(-1)} />
        <div className="slide" aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}`}>
          <div className="mono" style={{ fontSize: 'var(--fs-h1)', fontWeight: 300 }}>{done ? s.value : '—'}</div>
          <div className="title">{s.label}</div>
          <div className="muted small">{done ? s.sub : 'Loading'}</div>
        </div>
        <IconButton icon="chevron-right" label="Next slide" onClick={() => go(1)} />
      </div>
      <div className="dots" aria-hidden="true">
        {slides.map((_, n) => <span key={n} className={n === i ? 'on' : ''} />)}
        <small className="mono faint" style={{ marginLeft: 'var(--space-2)' }}>{i + 1} / {slides.length}</small>
      </div>
    </Section>
  );
}

function projectStatus(o: OperationsOverview | undefined): ['passed' | 'review' | 'neutral', string] {
  if (!o) return ['neutral', 'Unknown'];
  const open = o.openAlerts.critical + o.openAlerts.warning + o.openAlerts.info;
  return !o.activeBundle || open > 0 || o.proxies.restartRequired > 0 || o.proxies.incompatible > 0 ? ['review', 'Needs attention'] : ['passed', 'Active'];
}

export function Dashboard() {
  const { org, base, projects, canEdit } = useOrg();
  const navigate = useNavigate();
  const keys = useResource<Page<ApiKey>>(`/organizations/${org.id}/api-keys?limit=100`);
  const members = useResource<Page<Membership>>(`/organizations/${org.id}/memberships?limit=100`);
  const installs = useResource<GitHubInstallation[]>(`/organizations/${org.id}/github-installations`);
  const health = useResource<{ status: string }>('/health');
  const [creating, setCreating] = useState(false);
  const { fleet, done } = useFleet(org.id, projects);

  const activeKeys = keys.data ? { ...keys.data, items: keys.data.items.filter((k) => !k.revokedAt) } : null;

  return (
    <>
      <PageHead title="Dashboard" desc={<>Projects and shared configuration for <strong>{org.name}</strong>.</>}>
        <Badge status={health.data?.status === 'ok' ? 'passed' : health.error ? 'blocked' : 'neutral'}>
          {health.data?.status === 'ok' ? 'Control plane reachable' : health.error ? 'Control plane unreachable' : 'Checking'}
        </Badge>
        {canEdit && <Button size="sm" iconLeft="plus" onClick={() => setCreating(true)}>New project</Button>}
      </PageHead>

      <div className="stats" style={{ marginBottom: 'var(--space-5)' }}>
        <StatTile label="Projects" value={projects.length} />
        <StatTile label="Active API keys" value={count(activeKeys)} />
        <StatTile label="GitHub installations" value={installs.data?.length ?? '—'} />
        <StatTile label="Members" value={count(members.data)} />
      </div>

      <div className="grid-main">
        <div className="col">
          <SystemOverview projects={projects} fleet={fleet} done={done} />
          <Section title="Projects" desc="Each project is one protected application with its own policy and bundle."
            aside={<Badge status="neutral" dot={false}>{projects.length} total</Badge>}>
            {projects.length === 0 ? (
              <p className="muted small">No projects yet. Create one to describe where the proxy forwards traffic.</p>
            ) : (
              <ul className="list">
                {projects.map((p) => (
                  <li key={p.id} className="link" onClick={() => navigate(`${base}/projects/${p.id}`)}>
                    <span>
                      <span className="title">{p.name}</span>
                      <span className="mono muted" style={{ display: 'block' }}>{p.slug} · {p.runtimeConfiguration.upstreamUrl} · updated {when(p.updatedAt)}</span>
                    </span>
                    <span className="actions">
                      <Badge status={projectStatus(fleet[p.id])[0]}>{projectStatus(fleet[p.id])[1]}</Badge>
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); navigate(`${base}/projects/${p.id}/settings`); }}>Open settings</Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="col">
          <JevIntegrationCard />
          <AiModelCard />
          <Section title="Source repositories" desc="Analysis source is fetched from GitHub through a linked installation."
            aside={<Badge status={installs.data?.length ? 'passed' : 'review'}>{installs.data?.length ? 'Linked' : 'Not linked'}</Badge>}>
            {installs.data?.length ? (
              <ul className="list">
                {installs.data.map((i) => (
                  <li key={i.installationId}><span className="mono">{i.accountLogin}</span><span className="faint small">{when(i.linkedAt)}</span></li>
                ))}
              </ul>
            ) : <p className="muted small">No GitHub App installation is linked yet.</p>}
            <div style={{ marginTop: 'var(--space-4)' }}><Link to={`${base}/settings`}>Manage installations</Link></div>
          </Section>

          <Section title="Credentials" desc="Collector keys upload analyses. Deployment keys let proxies pull bundles and report health.">
            {keys.data && (
              <ul className="list">
                {(['collector', 'deployment'] as const).map((t) => (
                  <li key={t}>
                    <span className="small" style={{ textTransform: 'capitalize' }}>{t} keys</span>
                    <span className="mono">{activeKeys?.items.filter((k) => k.type === t).length ?? 0} active</span>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ marginTop: 'var(--space-4)' }}><Link to={`${base}/api-keys`}>Manage API keys</Link></div>
          </Section>
        </div>
      </div>

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const navigate = useNavigate();
  const { org, base, reloadProjects } = useOrg();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [draft, setDraft] = useState<RuntimeDraft>(emptyRuntime);
  const [touched, setTouched] = useState(false);
  const run = useAction();
  const { errors, value } = validateRuntime(draft);
  const slugOk = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 63;

  const submit = () => {
    setTouched(true);
    if (!value || !name.trim() || !slugOk) return;
    void run.go(async () => {
      const p = await api<Project>(`/organizations/${org.id}/projects`, {
        method: 'POST',
        body: { name: name.trim(), slug, runtimeConfiguration: value },
      });
      reloadProjects();
      navigate(`${base}/projects/${p.id}`);
    }, 'Project created');
  };

  return (
    <Dialog open width={760} title="New project" onClose={onClose}
      description="Runtime configuration is distributed to proxies only after a policy is activated."
      actions={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={run.pending} onClick={submit}>Create project</Button>
      </>}>
      <div className="stack">
        <div className="grid-2">
          <Input label="Name" placeholder="Checkout API" value={name}
            error={touched && !name.trim() ? 'Required' : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63));
            }} />
          <Input label="Slug" mono placeholder="checkout-api" value={slug} onChange={(e) => setSlug(e.target.value)}
            error={touched && !slugOk ? 'Lowercase letters, digits and single dashes' : undefined} />
        </div>
        <RuntimeConfigFields draft={draft} set={setDraft} errors={touched ? errors : {}} />
        {run.error && <Note tone="error">{run.error}</Note>}
      </div>
    </Dialog>
  );
}
