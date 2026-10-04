import { useState } from 'react';
import { useApi, useProposed, type AiModelIntegration, type JevIntegration } from '../api';
import { Badge, Button, Dialog, Input, Select } from '../components';
import { useOrg } from '../Layout';
import { Loading, Note, ProposedNote, Section, useAction, when } from '../ui';

// Both credentials are backed by the integrations module (JEV: ADR-0009, AI model: ADR-0010).
// The key is write-only: it is sent once, cleared from state, and never read back or displayed.

function Credential<T extends { connected: boolean }>({ title, desc, path, required, fields, status, disconnectNote, initial }: {
  title: string; desc: string; path: string; disconnectNote: string;
  required: string[] | ((values: Record<string, string>) => string[]);
  fields: (set: (k: string, v: string) => void, values: Record<string, string>) => React.ReactNode;
  status: (d: T) => string;
  /** Non-secret values to prefill when replacing a key. */
  initial?: (d: T) => Record<string, string>;
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
        {connected && r.data && <p className="small muted" style={{ margin: 0 }}>{status(r.data)}</p>}
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
        {canEdit && connected && !replacing && (
          <div className="actions">
            <Button variant="outline" onClick={() => { setValues(r.data && initial ? initial(r.data) : {}); setReplacing(true); }}>Replace</Button>
            <Button variant="ghost" onClick={() => setConfirm(true)}>Disconnect</Button>
          </div>
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
      desc="Shared by all projects. Proxies fetch it with a deployment key that has the jev-credentials:read scope."
      disconnectNote="Proxies drop the key on their next fetch. Until a new key is saved, JEV is unavailable and each project applies its failure behavior."
      status={(d: JevIntegration) => `Version ${d.version ?? '—'} · updated ${when(d.updatedAt)}`}
      fields={keyInput} />
  );
}

export function AiModelCard() {
  return (
    <Credential title="Global AI model" desc="Default model for all projects: a provider API key, or the address of a local model with an Anthropic-compatible API." path="ai-model"
      required={(v) => v.provider === 'local' ? ['provider', 'baseUrl'] : ['provider', 'apiKey']}
      disconnectNote="The stored key or address is deleted and cannot be recovered. Save it again to reconnect."
      status={(d: AiModelIntegration) => `${d.provider ?? 'provider'}${d.baseUrl ? ` · ${d.baseUrl}` : ''} · version ${d.version ?? '—'} · updated ${when(d.updatedAt)}`}
      initial={(d: AiModelIntegration): Record<string, string> => d.provider === 'local' ? { provider: 'local', baseUrl: d.baseUrl ?? '' } : {}}
      fields={(set, v) => (
        <>
          <Select label="Provider" value={v.provider ?? ''} onChange={(e) => { set('provider', e.target.value); set('apiKey', ''); set('baseUrl', ''); }}
            options={[{ value: '', label: 'Choose a provider' }, { value: 'openai', label: 'OpenAI' }, { value: 'anthropic', label: 'Anthropic' }, { value: 'local', label: 'Local' }]} />
          {v.provider === 'local' ? (
            <>
              <Input label="Base URL" type="url" autoComplete="off" placeholder="http://localhost:11434" value={v.baseUrl ?? ''} onChange={(e) => set('baseUrl', e.target.value)} />
              <p className="small muted" style={{ margin: 0 }}>Local and private addresses work only when the control plane allows them (AI_MODEL_ALLOW_PRIVATE_BASE_URL).</p>
            </>
          ) : v.provider ? keyInput(set, v) : null}
        </>
      )} />
  );
}
