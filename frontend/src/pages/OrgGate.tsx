import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useApi, useResource, type Organization, type Page } from '../api';
import { Button, Card, Input } from '../ds';
import { Loading, Note, useAction } from '../ui';

/** `/`: pick up the last organization, or create the first one. */
export function OrgGate() {
  const api = useApi();
  const navigate = useNavigate();
  const wantsNew = useLocation().search.includes('new');
  const orgs = useResource<Page<Organization>>('/organizations?limit=100');
  const [name, setName] = useState('');
  const run = useAction();

  if (orgs.error) return <div className="center"><Note tone="error">{orgs.error}</Note></div>;
  if (!orgs.data) return <div className="center"><Loading what="organizations" /></div>;

  const items = orgs.data.items;
  if (items.length && !wantsNew) {
    let last: string | null = null;
    try { last = localStorage.getItem('tessera.org'); } catch { /* storage unavailable */ }
    const target = items.find((o) => o.id === last) ?? items[0]!;
    return <Navigate to={`/orgs/${target.id}`} replace />;
  }

  const create = () =>
    run.go(async () => {
      const org = await api<Organization>('/organizations', { method: 'POST', body: { name: name.trim() } });
      navigate(`/orgs/${org.id}`);
    }, 'Organization created');

  return (
    <div className="center">
      <Card style={{ width: '100%', maxWidth: 440 }} padding="var(--space-8)">
        <div className="eyebrow">Step I</div>
        <h1 style={{ margin: 'var(--space-2) 0', fontWeight: 300, fontSize: 'var(--fs-h2)', color: 'var(--text-strong)' }}>
          Create an organization.
        </h1>
        <p className="muted small">You become its first owner. Projects, credentials and members live inside it.</p>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <Input label="Organization name" placeholder="Acme" value={name} onChange={(e) => setName(e.target.value)} required />
          <Button type="submit" disabled={run.pending || !name.trim()}>Create organization</Button>
          {items.length > 0 && <Button type="button" variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>}
        </form>
      </Card>
    </div>
  );
}
