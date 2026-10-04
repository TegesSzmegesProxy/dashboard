import { useState } from 'react';
import { useApi, useResource, type GitHubInstallation, type RepositoryBinding } from '../api';
import { Badge, Button, Input, Select } from '../components';
import { useOrg } from '../Layout';
import { Note, Section, useAction, when } from '../ui';

/**
 * Starts the GitHub App installation. `state` round-trips the organization id (and
 * the project, to come back to its Policies tab) to /github/callback.
 */
export function ConnectGitHubButton({ tenantId, variant = 'primary' }: { tenantId?: string; variant?: 'primary' | 'outline' }) {
  const { org, canEdit } = useOrg();
  const installUrl = import.meta.env.VITE_GITHUB_APP_INSTALL_URL;
  if (!canEdit) return null;
  if (!installUrl) return <Note tone="info">Set VITE_GITHUB_APP_INSTALL_URL to enable installing the GitHub App from here.</Note>;
  const state = tenantId ? `${org.id}:${tenantId}` : org.id;
  return (
    <Button size="sm" variant={variant} iconRight="external-link" onClick={() => { window.location.href = `${installUrl}?state=${encodeURIComponent(state)}`; }}>
      Connect GitHub
    </Button>
  );
}

/** Binds one GitHub repository to a project; analyses read source only from it. */
export function Repository({ path, bare = false, onChange }: { path: string; /** No card around it, for embedding. */ bare?: boolean; onChange?: () => void }) {
  const { org, canEdit } = useOrg();
  const api = useApi();
  const run = useAction();
  const repo = useResource<RepositoryBinding>(`${path}/repository`, true);
  const installs = useResource<GitHubInstallation[]>(`/organizations/${org.id}/github-installations`);
  const [installationId, setInstallationId] = useState('');
  const [full, setFull] = useState('');
  const [ownerName, repoName] = full.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, '').replace(/\.git$/, '').split('/');
  const chosen = installationId || String(installs.data?.[0]?.installationId ?? '');
  const changed = () => { repo.reload(); onChange?.(); };

  const bind = () =>
    run.go(() => api(`${path}/repository`, { method: 'PUT', body: { installationId: Number(chosen), owner: ownerName, name: repoName } }), 'Repository bound')
      .then((ok) => ok && changed());
  const unbind = () =>
    run.go(() => api(`${path}/repository`, { method: 'DELETE' }), 'Repository unbound').then((ok) => ok && changed());

  const body = (
    <>
      {repo.error && <Note tone="error">{repo.error}</Note>}
      {repo.data ? (
        <div className="spread">
          <span>
            <span className="mono title">{repo.data.fullName}</span>
            <span className="faint small" style={{ display: 'block' }}>{repo.data.private ? 'private' : 'public'} · bound {when(repo.data.boundAt)} by {repo.data.boundBy}</span>
          </span>
          {canEdit && <Button variant="outline" size="sm" disabled={run.pending} onClick={() => void unbind()}>Unbind</Button>}
        </div>
      ) : canEdit && installs.data && (
        installs.data.length === 0 ? <Note tone="info">Link a GitHub installation first.</Note> : (
          <form className="row" onSubmit={(e) => { e.preventDefault(); void bind(); }}>
            <Select label="Installation" value={chosen} onChange={(e) => setInstallationId(e.target.value)}
              options={installs.data.map((i) => ({ value: String(i.installationId), label: i.accountLogin }))} />
            <div className="grow"><Input label="GitHub repository URL or slug" mono placeholder="https://github.com/org/repo or org/repo" value={full} onChange={(e) => setFull(e.target.value)} /></div>
            <Button type="submit" disabled={run.pending || !ownerName || !repoName}>Bind</Button>
          </form>
        )
      )}
    </>
  );
  if (bare) return <div className="stack" style={{ gap: 'var(--space-3)' }}>{body}</div>;
  return (
    <Section title="Repository" desc="The one GitHub repository analyses read source from. Files are filtered and redacted before storage or AI processing."
      aside={repo.data ? <Badge status="passed">Bound</Badge> : <Badge status="review">Not bound</Badge>}>
      {body}
    </Section>
  );
}
