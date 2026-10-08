import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, useApi, useResource, type ApiKey, type GitHubInstallation, type Membership, type OperationsOverview, type Page, type Project, type RepositoryBinding, type TelemetrySummary } from '../api';
import { Badge, Button, Dialog, IconButton, Input, Sparkline, StatTile } from '../components';
import { useOrg } from '../Layout';
import { Note, num, PageHead, Section, telemetryQuery, useAction, when } from '../ui';
import { JevIntegrationCard } from './Integrations';
import { emptyRuntime, RuntimeConfigFields, validateRuntime, type RuntimeDraft } from './RuntimeConfigFields';

const count = (p: Page<unknown> | null) => (p ? `${p.items.length}${p.nextCursor ? '+' : ''}` : '—');

interface FleetEntry { ops?: OperationsOverview; trend?: number[]; repo?: RepositoryBinding | null }

/**
 * Per project: operations overview, last-hour request trend and bound repository.
 * A read that fails is simply absent from the entry.
 */
// ponytail: three reads per project; add an org-level summary endpoint if orgs grow past a few dozen projects.
function useFleet(orgId: string, projects: Project[]) {
  const api = useApi();
  const [fleet, setFleet] = useState<Record<string, FleetEntry>>({});
  const [done, setDone] = useState(false);
  const ids = projects.map((p) => p.id).join(',');
  useEffect(() => {
    let live = true;
    setDone(false);
    const q = telemetryQuery('minute', 3_600_000);
    const value = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : undefined);
    void Promise.all(projects.map(async (p) => {
      const path = `/organizations/${orgId}/projects/${p.id}`;
      const [ops, tel, repo] = await Promise.allSettled([
        api<OperationsOverview>(`${path}/operations`),
        api<TelemetrySummary>(`${path}/telemetry?${q}`),
        api<RepositoryBinding>(`${path}/repository`).catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        }),
      ]);
      return [p.id, { ops: value(ops), trend: value(tel)?.series.map((x) => x.requests), repo: value(repo) }] as const;
    })).then((rs) => {
      if (!live) return;
      setFleet(Object.fromEntries(rs));
      setDone(true);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ids` stands in for `projects`
  }, [api, orgId, ids]);
  return { fleet, done };
}

function SystemOverview({ fleet, done }: { fleet: Record<string, FleetEntry>; done: boolean }) {
  const [i, setI] = useState(0);
  const all = Object.values(fleet).flatMap((f) => (f.ops ? [f.ops] : []));
  const sum = (f: (o: OperationsOverview) => number) => all.reduce((n, o) => n + f(o), 0);
  const alerts = sum((o) => o.openAlerts.critical + o.openAlerts.warning + o.openAlerts.info);
  const slides = [
    { value: num(sum((o) => o.lastHour.requests)), label: 'Requests · last hour', sub: 'from proxy telemetry' },
    { value: num(sum((o) => o.lastHour.decisions.block)), label: 'Blocked · last hour', sub: `${num(sum((o) => o.lastHour.staticVerdicts.policyViolation))} policy violations · ${num(sum((o) => o.lastHour.jev.attack))} JEV attacks` },
    { value: `${sum((o) => o.proxies.total - o.proxies.stale)} / ${sum((o) => o.proxies.total)}`, label: 'Proxies reporting', sub: `${sum((o) => o.proxies.restartRequired)} restart required · ${sum((o) => o.proxies.incompatible)} incompatible` },
    { value: num(alerts), label: 'Open alerts', sub: `${sum((o) => o.openAlerts.critical)} critical` },
  ];
  const s = slides[i]!;
  const go = (d: number) => setI((n) => (n + d + slides.length) % slides.length);
  const healthy = done && all.length > 0 && alerts === 0;
  return (
    <Section title="System overview" desc="Key metrics across all projects." aside={<Badge status={!done ? 'neutral' : healthy ? 'passed' : 'review'}>{!done ? 'Checking' : healthy ? 'Healthy' : 'Needs attention'}</Badge>}>
      <div className="carousel">
        <IconButton icon="chevron-right" label="Previous metric" size="sm" style={{ transform: 'scaleX(-1)' }} onClick={() => go(-1)} />
        <div className="slide" aria-live="polite">
          <span className="slide-value">{done ? s.value : '—'}</span>
          <span className="slide-label">{s.label}</span>
          <span className="muted small">{done ? s.sub : 'Loading'}</span>
        </div>
        <IconButton icon="chevron-right" label="Next metric" size="sm" onClick={() => go(1)} />
      </div>
      <div className="dots mono small muted">
        {slides.map((x, n) => <span key={x.label} aria-hidden="true" className={n === i ? 'on' : ''} />)}
        <span style={{ marginLeft: 'var(--space-2)', whiteSpace: 'nowrap' }}>{i + 1} / {slides.length}</span>
      </div>
    </Section>
  );
}

type Tone = 'passed' | 'review' | 'jev' | 'blocked' | 'neutral';
function projectStatus(o: OperationsOverview | undefined): [Tone, string] {
  if (!o) return ['neutral', 'Unknown'];
  if (o.proxies.incompatible > 0) return ['blocked', 'Incompatible proxy'];
  if (!o.activeBundle) return ['review', 'No active bundle'];
  if (o.openAlerts.critical + o.openAlerts.warning + o.openAlerts.info > 0) return ['review', 'Needs attention'];
  if (o.proxies.restartRequired > 0) return ['jev', 'Restart required'];
  if (o.proxies.total === 0) return ['neutral', 'No proxies'];
  return ['passed', 'Healthy'];
}

function projectMeta(p: Project, o: OperationsOverview | undefined): string {
  return [
    p.runtimeConfiguration.upstreamUrl,
    o?.activeBundle ? `bundle ${o.activeBundle.version.slice(0, 8)}` : null,
    o ? `${o.proxies.total} prox${o.proxies.total === 1 ? 'y' : 'ies'}` : null,
    o?.lastTelemetryAt ? `telemetry ${when(o.lastTelemetryAt)}` : null,
  ].filter(Boolean).join(' · ');
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
  const repos = Object.values(fleet).flatMap((f) => (f.repo ? [f.repo.fullName] : []));

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
          <SystemOverview fleet={fleet} done={done} />
          <Section title="Projects" desc="Each project is one protected application with its own policy and bundle."
            aside={<Badge status="neutral" dot={false}>{projects.length} total</Badge>}>
            {projects.length === 0 ? (
              <p className="empty">No projects yet. Create one to describe where the proxy forwards traffic.</p>
            ) : (
              <ul className="list">
                {projects.map((p) => {
                  const f = fleet[p.id];
                  const [tone, label] = projectStatus(f?.ops);
                  return (
                    <li key={p.id} className="link project-row" onClick={() => navigate(`${base}/projects/${p.id}`)}>
                      <span style={{ minWidth: 0 }}>
                        <Link className="title" style={{ textDecoration: 'none' }} to={`${base}/projects/${p.id}`} onClick={(e) => e.stopPropagation()}>{p.name}</Link>
                        <span className="mono muted meta" style={{ display: 'block' }} title={projectMeta(p, f?.ops)}>{projectMeta(p, f?.ops)}</span>
                      </span>
                      {f?.trend && f.trend.length > 1
                        ? <Sparkline data={f.trend} width={64} height={22} color="var(--blue-600)" />
                        : <span />}
                      <Badge status={tone}>{label}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
          <Section title="Credentials" desc="Machine keys, stored hashed and shown once."
            foot={<Link to={`${base}/api-keys`}>Manage API keys</Link>}>
            {keys.data && (
              <dl className="kv">
                {([['collector', 'Collector keys', 'Upload redacted analyses from CI'], ['deployment', 'Deployment keys', 'Let proxies pull bundles and report health']] as const).map(([t, label, hint]) => (
                  <div key={t}>
                    <dt>{label}<small>{hint}</small></dt>
                    <dd>{activeKeys?.items.filter((k) => k.type === t).length ?? 0} active</dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>
        </div>

        <div className="col">
          <JevIntegrationCard />
          <Section title="Source repositories" desc="Analysis source is fetched from GitHub through a linked installation."
            foot={<Link to={`${base}/settings`}>Manage installations</Link>}
            aside={<Badge status={installs.data?.length ? 'passed' : 'review'}>{installs.data?.length ? 'Linked' : 'Not linked'}</Badge>}>
            {repos.length > 0 ? (
              <ul className="chips" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {repos.map((r) => <li key={r}><Badge status="neutral" dot={false} style={{ textTransform: 'none', letterSpacing: 0 }}>{r}</Badge></li>)}
              </ul>
            ) : installs.data?.length ? (
              <p className="muted small" style={{ margin: 0 }}>
                Installed on {installs.data.map((i) => i.accountLogin).join(', ')}. {done ? 'No project has a repository bound yet.' : ''}
              </p>
            ) : <p className="empty">No GitHub App installation is linked yet.</p>}
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
