import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useApi, usePaged, useResource, type ActiveBundle, type Project as ProjectT, type ProxyInstance, type RepositoryBinding } from '../api';
import { Badge, Button, Dialog, Input, StatTile } from '../components';
import { PROJECT_SECTIONS, useOrg } from '../Layout';
import { LoadMore, Loading, Note, PageHead, ProxyBadges, Section, useAction, when } from '../ui';
import { ProjectAnalyses } from './ProjectAnalyses';
import { Repository } from './GitHubSource';
import { ProjectOperations } from './ProjectOperations';
import { ProjectPolicies } from './ProjectPolicies';
import { ProjectTuning } from './ProjectTuning';
import { RuntimeConfigFields, toDraft, validateRuntime } from './RuntimeConfigFields';

export function Project() {
  const { tenantId = '', section } = useParams();
  const { org, base } = useOrg();
  const tab = section ?? '';
  const project = useResource<ProjectT>(`/organizations/${org.id}/projects/${tenantId}`);
  const p = project.data;

  if (!PROJECT_SECTIONS.some((s) => s.id === tab)) return <Navigate to={`${base}/projects/${tenantId}/overview`} replace />;
  if (project.error) return <Note tone="error">{project.error}</Note>;
  if (!p) return <Loading what="project" />;
  const path = `/organizations/${org.id}/projects/${p.id}`;

  return (
    <>
      <PageHead title={p.name} desc={<span className="mono">{p.slug} → {p.runtimeConfiguration.upstreamUrl}</span>} />
      {tab === 'overview' && <Overview path={path} />}
      {tab === 'operations' && <ProjectOperations path={path} />}
      {tab === 'tuning' && <ProjectTuning path={path} />}
      {tab === 'policies' && <ProjectPolicies path={path} />}
      {tab === 'analyses' && <ProjectAnalyses path={path} />}
      {tab === 'settings' && <Settings key={p.updatedAt} project={p} path={path} reload={project.reload} />}
    </>
  );
}

function Overview({ path }: { path: string }) {
  const bundle = useResource<ActiveBundle>(`${path}/bundles/active`, true);
  const proxies = usePaged<ProxyInstance>(`${path}/proxies`);
  const repo = useResource<RepositoryBinding>(`${path}/repository`, true);
  const b = bundle.data;
  const restart = proxies.items.filter((x) => x.restartRequired).length;

  return (
    <div className="stack" style={{ gap: 'var(--space-5)' }}>
      <div className="stats">
        <StatTile label="Active bundle" value={b ? b.version : '—'} />
        <StatTile label="Proxies reporting" value={proxies.items.filter((x) => !x.stale).length} unit={`/ ${proxies.items.length}`} />
        <StatTile label="Restart required" value={restart} deltaTone={restart ? 'bad' : 'neutral'} />
        <StatTile label="Repository" value={repo.data ? 'Bound' : '—'} />
      </div>

      <div className="grid-main">
        <Section title="Proxies" desc="Display state from heartbeats. Proxies keep running their last known good bundle if the control plane is unreachable.">
          {proxies.error && <Note tone="error">{proxies.error}</Note>}
          {proxies.loading && !proxies.items.length ? <Loading what="proxies" /> : proxies.items.length === 0 ? (
            <p className="muted small">No proxy has sent a heartbeat for this project. Deploy one with a deployment key.</p>
          ) : (
            <ul className="list">
              {proxies.items.map((x) => (
                <li key={x.instanceId} style={{ alignItems: 'flex-start' }}>
                  <span>
                    <span className="mono title">{x.instanceId}</span>
                    <span className="mono faint" style={{ display: 'block' }}>
                      v{x.proxyVersion} · loaded {x.loadedBundleVersion ?? 'none'} · active {x.activeBundleVersion ?? 'none'} · seen {when(x.lastSeenAt)}
                    </span>
                  </span>
                  <ProxyBadges p={x} />
                </li>
              ))}
            </ul>
          )}
          <LoadMore hasMore={proxies.hasMore} loadMore={proxies.loadMore} />
        </Section>

        <Section title="Active bundle" aside={b ? <Badge status="passed">Signed</Badge> : <Badge status="neutral">None</Badge>}
          desc="The signed runtime configuration and compiled policy selected for distribution.">
          {bundle.error && <Note tone="error">{bundle.error}</Note>}
          {!bundle.loading && !b && !bundle.error && <p className="muted small">Nothing is active yet. Approve and activate a policy version.</p>}
          {b && (
            <div className="stack">
              {b.runtimeConfigurationPending && (
                <Note>Runtime configuration changed after this bundle was built. Activate a policy version to distribute it.</Note>
              )}
              <dl className="mono small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-2) var(--space-4)', margin: 0 }}>
                <dt className="muted">bundle</dt><dd style={{ margin: 0 }}>{b.version}</dd>
                <dt className="muted">policy</dt><dd style={{ margin: 0 }}>{b.policyVersion}</dd>
                <dt className="muted">schema</dt><dd style={{ margin: 0 }}>{b.schemaVersion}</dd>
                <dt className="muted">tools</dt><dd style={{ margin: 0 }}>{b.toolRegistryVersion}</dd>
                <dt className="muted">key</dt><dd style={{ margin: 0 }}>{b.signingKeyId}</dd>
                <dt className="muted">activated</dt><dd style={{ margin: 0 }}>{when(b.activatedAt)} by {b.activatedBy}</dd>
              </dl>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Settings({ project, path, reload }: { project: ProjectT; path: string; reload: () => void }) {
  const { canEdit, reloadProjects } = useOrg();
  const api = useApi();
  const run = useAction();
  const [name, setName] = useState(project.name);
  const [slug, setSlug] = useState(project.slug);
  const [draft, setDraft] = useState(toDraft(project.runtimeConfiguration));
  const { errors, value } = validateRuntime(draft);

  const save = () => {
    if (!value) return;
    void run.go(async () => {
      await api(path, { method: 'PATCH', body: { name: name.trim(), slug, runtimeConfiguration: value } });
      reload();
      reloadProjects();
    }, 'Project saved');
  };

  return (
    <div className="stack" style={{ gap: 'var(--space-5)' }}>
      <Repository path={path} />

      <Section title="Runtime configuration" desc="Saved changes reach proxies only in the next activated bundle.">
        <div className="stack">
          <div className="grid-2">
            <Input label="Name" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
            <Input label="Slug" mono value={slug} disabled={!canEdit} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <RuntimeConfigFields draft={draft} set={setDraft} errors={errors} disabled={!canEdit} />
          {canEdit && (
            <div className="actions" style={{ justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => { setName(project.name); setSlug(project.slug); setDraft(toDraft(project.runtimeConfiguration)); }}>Reset</Button>
              <Button disabled={!value || run.pending} onClick={save}>Save changes</Button>
            </div>
          )}
        </div>
      </Section>

      {canEdit && <DeleteProject project={project} path={path} />}
    </div>
  );
}

function DeleteProject({ project, path }: { project: ProjectT; path: string }) {
  const { base, reloadProjects } = useOrg();
  const api = useApi();
  const navigate = useNavigate();
  const run = useAction();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  return (
    <Section title="Delete project" desc="Removes the project and its configuration from the control plane.">
      <Button variant="danger" onClick={() => setOpen(true)}>Delete project</Button>
      <Dialog open={open} title={`Delete ${project.name}?`} onClose={() => setOpen(false)}
        description="Type the project slug to confirm. This cannot be undone."
        actions={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="danger" disabled={typed !== project.slug || run.pending}
            onClick={() => void run.go(() => api(path, { method: 'DELETE' }), 'Project deleted').then((ok) => { if (ok) { reloadProjects(); navigate(base); } })}>
            Delete
          </Button>
        </>}>
        <Input mono placeholder={project.slug} value={typed} onChange={(e) => setTyped(e.target.value)} />
      </Dialog>
    </Section>
  );
}
