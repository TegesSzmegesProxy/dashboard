import { useAuth0 } from '@auth0/auth0-react';
import { useState } from 'react';
import { useApi, usePaged, useResource, type GitHubInstallation, type Membership, type Organization, type Role } from '../api';
import { Badge, Button, Dialog, IconButton, Input, Select } from '../components';
import { useOrg } from '../Layout';
import { LoadMore, Loading, Note, PageHead, Section, useAction, when } from '../ui';

const ROLES: Role[] = ['owner', 'admin', 'viewer'];

export function OrgSettings() {
  const { org, canEdit } = useOrg();
  return (
    <>
      <PageHead title="Settings" desc="Organization name, members and GitHub access." />
      <div className="stack" style={{ gap: 'var(--space-5)' }}>
        <OrgName org={org} canEdit={canEdit} />
        <Members />
        <Installations />
      </div>
    </>
  );
}

function OrgName({ org, canEdit }: { org: Organization; canEdit: boolean }) {
  const api = useApi();
  const run = useAction();
  const [name, setName] = useState(org.name);
  return (
    <Section title="Organization">
      <form className="row" onSubmit={(e) => {
        e.preventDefault();
        // ponytail: full reload refreshes the sidebar name; lift org into context state if this feels slow.
        void run.go(() => api(`/organizations/${org.id}`, { method: 'PATCH', body: { name: name.trim() } }), 'Name saved').then((ok) => ok && window.location.reload());
      }}>
        <div className="grow"><Input label="Name" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} /></div>
        {canEdit && <Button type="submit" disabled={run.pending || !name.trim() || name === org.name}>Save</Button>}
      </form>
      <p className="mono faint" style={{ margin: 'var(--space-3) 0 0' }}>id {org.id}</p>
    </Section>
  );
}

function Members() {
  const { org, canEdit } = useOrg();
  const { user } = useAuth0();
  const api = useApi();
  const members = usePaged<Membership>(`/organizations/${org.id}/memberships`);
  const run = useAction();
  const [subject, setSubject] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [removing, setRemoving] = useState<Membership | null>(null);
  const isOwner = org.role === 'owner';
  const path = `/organizations/${org.id}/memberships`;

  return (
    <Section title="Members" desc="Members sign in with Auth0. Add them by their Auth0 subject identifier.">
      {members.error && <Note tone="error">{members.error}</Note>}
      {members.loading && !members.items.length ? <Loading what="members" /> : (
        <ul className="list">
          {members.items.map((m) => (
            <li key={m.id}>
              <span>
                <span className="mono">{m.subject}</span>
                {m.subject === user?.sub && <Badge status="jev" style={{ marginLeft: 'var(--space-2)' }}>You</Badge>}
                <span className="faint small" style={{ display: 'block' }}>since {when(m.createdAt)}</span>
              </span>
              <span className="actions">
                {canEdit && (isOwner || m.role !== 'owner') ? (
                  <Select aria-label={`Role for ${m.subject}`} value={m.role} style={{ height: 'var(--control-sm)' }}
                    options={ROLES.filter((r) => isOwner || r !== 'owner')}
                    onChange={(e) => void run.go(() => api(`${path}/${m.id}`, { method: 'PATCH', body: { role: e.target.value } }), 'Role updated').then(members.reload)} />
                ) : <Badge status="neutral" dot={false}>{m.role}</Badge>}
                {canEdit && (isOwner || m.role !== 'owner') && (
                  <IconButton icon="x" label="Remove member" size="sm" onClick={() => setRemoving(m)} />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <LoadMore hasMore={members.hasMore} loadMore={members.loadMore} />

      {canEdit && (
        <form className="row sub" onSubmit={(e) => {
          e.preventDefault();
          void run.go(() => api(path, { method: 'POST', body: { subject: subject.trim(), role } }), 'Member added')
            .then((ok) => { if (ok) { setSubject(''); members.reload(); } });
        }}>
          <div className="grow"><Input label="Auth0 subject" mono placeholder="auth0|64f1…" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <Select label="Role" value={role} options={ROLES.filter((r) => isOwner || r !== 'owner')} onChange={(e) => setRole(e.target.value as Role)} />
          <Button type="submit" disabled={run.pending || !subject.trim()}>Add member</Button>
        </form>
      )}

      <Dialog open={!!removing} title="Remove member?" onClose={() => setRemoving(null)}
        description={removing ? `${removing.subject} loses access to ${org.name} immediately.` : undefined}
        actions={<>
          <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
          <Button variant="danger" disabled={run.pending} onClick={() => removing && void run.go(() => api(`${path}/${removing.id}`, { method: 'DELETE' }), 'Member removed')
            .then((ok) => { if (ok) { setRemoving(null); members.reload(); } })}>Remove</Button>
        </>} />
    </Section>
  );
}

function Installations() {
  const { org, canEdit } = useOrg();
  const api = useApi();
  const run = useAction();
  const installs = useResource<GitHubInstallation[]>(`/organizations/${org.id}/github-installations`);
  const installUrl = import.meta.env.VITE_GITHUB_APP_INSTALL_URL;
  const [unlinking, setUnlinking] = useState<GitHubInstallation | null>(null);

  return (
    <Section title="GitHub installations" desc="Tessera reads source only from repositories bound to a project, through these installations."
      aside={canEdit && installUrl ? (
        // `state` round-trips the organization id to /github/callback.
        <Button size="sm" variant="outline" iconRight="external-link" onClick={() => { window.location.href = `${installUrl}?state=${encodeURIComponent(org.id)}`; }}>
          Install GitHub App
        </Button>
      ) : undefined}>
      {installs.error && <Note tone="error">{installs.error}</Note>}
      {!installUrl && canEdit && <Note tone="info">Set VITE_GITHUB_APP_INSTALL_URL to enable installing the GitHub App from here.</Note>}
      {installs.data && (installs.data.length === 0 ? <p className="muted small">No installations linked.</p> : (
        <ul className="list">
          {installs.data.map((i) => (
            <li key={i.installationId}>
              <span><span className="title">{i.accountLogin}</span><span className="mono faint" style={{ display: 'block' }}>installation {i.installationId} · linked {when(i.linkedAt)}</span></span>
              {canEdit && <Button size="sm" variant="ghost" onClick={() => setUnlinking(i)}>Unlink</Button>}
            </li>
          ))}
        </ul>
      ))}
      <Dialog open={!!unlinking} title={`Unlink ${unlinking?.accountLogin}?`} onClose={() => setUnlinking(null)}
        description="Projects bound to repositories through this installation can no longer be analyzed."
        actions={<>
          <Button variant="ghost" onClick={() => setUnlinking(null)}>Cancel</Button>
          <Button variant="danger" disabled={run.pending} onClick={() => unlinking && void run.go(() => api(`/organizations/${org.id}/github-installations/${unlinking.installationId}`, { method: 'DELETE' }), 'Installation unlinked')
            .then((ok) => { if (ok) { setUnlinking(null); installs.reload(); } })}>Unlink</Button>
        </>} />
    </Section>
  );
}
