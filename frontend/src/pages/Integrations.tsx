import { useState } from 'react';
import { useApi, useProposed, type JevIntegration } from '../api';
import { Badge, Button, Dialog, Input } from '../components';
import { useOrg } from '../Layout';
import { Loading, Note, ProposedNote, Section, useAction, when } from '../ui';

// The JEV credential is backed by the integrations module (ADR-0009). The AI model is chosen in the
// control plane's .env, not here (ADR-0019).
// The key is write-only: it is sent once, cleared from state, and never read back or displayed.

function Credential<T extends { connected: boolean }>({ title, desc, path, required, fields, status, disconnectNote }: {
  title: string; desc: React.ReactNode; path: string; disconnectNote: string;
  required: string[] | ((values: Record<string, string>) => string[]);
  fields: (set: (k: string, v: string) => void, values: Record<string, string>) => React.ReactNode;
  status: (d: T) => string;
}) {
  const { org, canEdit } = useOrg();
  const api = useApi();
  const run = useAction();
  const full = `/organizations/${org.id}/integrations/${path}`;
  const r = useProposed<T>(full);
  const [values, setValues] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const connected = r.data?.connected === true;
  const showForm = canEdit && r.status !== 'loading' && (!connected || replacing);
  // Empty optional fields are left out rather than sent as "".
  const missing = (typeof required === 'function' ? required(values) : required).some((k) => !values[k]?.trim());
  const body = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''));

  return (
    <Section title={title} desc={desc} aside={<Badge status={connected ? 'passed' : r.status === 'missing' ? 'review' : 'neutral'}>{connected ? 'Connected' : r.status === 'missing' ? 'Endpoint pending' : 'Not connected'}</Badge>}>
      <div className="stack">
        {r.status === 'missing' && <ProposedNote routes={[`GET ${full}`, `PUT ${full}`, `DELETE ${full}`]} />}
        {r.status === 'error' && <Note tone="error">{r.error}</Note>}
        {r.status === 'loading' && <Loading what={title.toLowerCase()} />}
        {connected && r.data && !replacing && (
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
              {/* The key is write-only: the field only shows that one is stored. */}
              <div className="grow" style={{ minWidth: 0 }}><Input label="API key" mono readOnly tabIndex={-1} value="••••••••••••••••" /></div>
              {canEdit && <Button variant="outline" onClick={() => { setValues({}); setReplacing(true); }}>Replace</Button>}
            </div>
            <span className="spread small">
              <span className="muted">{status(r.data)}</span>
              {canEdit && <button type="button" className="linklike" onClick={() => setConfirm(true)}>Disconnect</button>}
            </span>
          </div>
        )}
        {showForm && (
          <form className="stack" autoComplete="off" onSubmit={(e) => {
            e.preventDefault();
            void run.go(() => api(full, { method: 'PUT', body }), 'Credential saved').then((ok) => { if (ok) { setValues({}); setReplacing(false); r.reload(); } });
          }}>
            {fields((k, v) => setValues((s) => ({ ...s, [k]: v })), values)}
            <div className="actions">
              <Button type="submit" disabled={run.pending || missing}>{connected ? 'Replace' : 'Save'}</Button>
              {replacing && <Button variant="ghost" onClick={() => { setReplacing(false); setValues({}); }}>Cancel</Button>}
            </div>
          </form>
        )}
      </div>
      <Dialog open={confirm} title={`Disconnect ${title}?`} onClose={() => setConfirm(false)}
        description={disconnectNote}
        actions={<>
          <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="danger" disabled={run.pending} onClick={() => void run.go(() => api(full, { method: 'DELETE' }), 'Disconnected').then((ok) => { if (ok) { setConfirm(false); r.reload(); } })}>Disconnect</Button>
        </>} />
    </Section>
  );
}

const keyInput = (set: (k: string, v: string) => void, v: Record<string, string>) => (
  <Input label="API key" type="password" autoComplete="off" placeholder="Paste your key" value={v.apiKey ?? ''} onChange={(e) => set('apiKey', e.target.value)} />
);

export function JevIntegrationCard() {
  return (
    <Credential title="Global JEV integration" path="jev" required={['apiKey']}
      desc={<>Shared by all projects. Proxies fetch it with a deployment key scoped <code className="mono">jev-credentials:read</code>.</>}
      disconnectNote="Proxies drop the key on their next fetch. Until a new key is saved, JEV is unavailable and each project applies its failure behavior."
      status={(d: JevIntegration) => `Version ${d.version ?? '—'} · updated ${when(d.updatedAt)}`}
      fields={keyInput} />
  );
}
