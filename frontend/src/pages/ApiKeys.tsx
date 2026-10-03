import { useState } from 'react';
import { SCOPES_BY_TYPE, useApi, usePaged, type ApiKey, type ApiKeyScope, type ApiKeyType, type RevealedApiKey } from '../api';
import { Badge, Button, Checkbox, Dialog, IconButton, Input, Radio, Tag, Ticket } from '../ds';
import { useOrg } from '../Layout';
import { LoadMore, Loading, newIdempotencyKey, Note, PageHead, Section, useAction, useToast, when } from '../ui';

export function ApiKeys() {
  const { org, canEdit, projects } = useOrg();
  const api = useApi();
  const keys = usePaged<ApiKey>(`/organizations/${org.id}/api-keys`);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<RevealedApiKey | null>(null);
  const [confirm, setConfirm] = useState<{ key: ApiKey; action: 'rotate' | 'revoke'; idem: string } | null>(null);
  const run = useAction();
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;

  const doConfirm = () => {
    if (!confirm) return;
    const { key, action, idem } = confirm;
    const path = `/organizations/${org.id}/api-keys/${key.id}/${action}`;
    void run.go(async () => {
      if (action === 'rotate') {
        setRevealed(await api<RevealedApiKey>(path, { method: 'POST', idempotencyKey: idem }));
      } else {
        await api<ApiKey>(path, { method: 'POST' });
      }
      setConfirm(null);
      keys.reload();
    }, action === 'rotate' ? 'Key rotated' : 'Key revoked');
  };

  return (
    <>
      <PageHead title="API keys" desc="Machine credentials for collectors and proxies. The secret is shown once, at creation or rotation.">
        {canEdit && <Button size="sm" iconLeft="plus" onClick={() => setCreating(true)}>New API key</Button>}
      </PageHead>

      <Section title="Keys">
        {keys.error && <Note tone="error">{keys.error}</Note>}
        {keys.loading && !keys.items.length ? <Loading what="keys" /> : keys.items.length === 0 ? (
          <p className="muted small">No keys yet. Create a collector key for CI, or a deployment key for a proxy.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Type</th><th>Prefix</th><th>Scopes</th><th>Projects</th><th>Last used</th><th>State</th><th /></tr></thead>
              <tbody>
                {keys.items.map((k) => (
                  <tr key={k.id}>
                    <td className="title">{k.name}</td>
                    <td><Badge status={k.type === 'deployment' ? 'jev' : 'neutral'} dot={false}>{k.type}</Badge></td>
                    <td className="mono">{k.displayPrefix}…</td>
                    <td><span className="actions">{k.scopes.map((s) => <Tag key={s}>{s}</Tag>)}</span></td>
                    <td className="small">{k.allowedTenantIds.map(projectName).join(', ')}</td>
                    <td className="mono muted">{when(k.lastUsedAt)}</td>
                    <td>{k.revokedAt ? <Badge status="blocked">Revoked</Badge> : <Badge status="passed">Active</Badge>}</td>
                    <td>
                      {canEdit && !k.revokedAt && (
                        <span className="actions">
                          <IconButton icon="refresh-cw" label="Rotate" size="sm" onClick={() => setConfirm({ key: k, action: 'rotate', idem: newIdempotencyKey() })} />
                          <IconButton icon="x" label="Revoke" size="sm" onClick={() => setConfirm({ key: k, action: 'revoke', idem: '' })} />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore hasMore={keys.hasMore} loadMore={keys.loadMore} />
      </Section>

      {creating && <NewKeyDialog onClose={() => setCreating(false)} onCreated={(r) => { setCreating(false); setRevealed(r); keys.reload(); }} />}

      <Dialog open={!!confirm} title={confirm?.action === 'rotate' ? `Rotate “${confirm.key.name}”?` : `Revoke “${confirm?.key.name}”?`}
        description={confirm?.action === 'rotate'
          ? 'A new secret is issued and shown once. The current secret stops working.'
          : 'Collectors or proxies using this key lose access immediately. This cannot be undone.'}
        onClose={() => setConfirm(null)}
        actions={<>
          <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="danger" disabled={run.pending} onClick={doConfirm}>{confirm?.action === 'rotate' ? 'Rotate key' : 'Revoke key'}</Button>
        </>} />

      {revealed && <RevealDialog r={revealed} onClose={() => setRevealed(null)} />}
    </>
  );
}

function NewKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (r: RevealedApiKey) => void }) {
  const { org, projects } = useOrg();
  const api = useApi();
  const run = useAction();
  const [name, setName] = useState('');
  const [type, setType] = useState<ApiKeyType | ''>('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>([]);
  const [tenants, setTenants] = useState<string[]>([]);
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));
  const valid = name.trim() && type && scopes.length && tenants.length;

  const submit = () =>
    run.go(async () => {
      onCreated(await api<RevealedApiKey>(`/organizations/${org.id}/api-keys`, {
        method: 'POST',
        body: { name: name.trim(), type, scopes, allowedTenantIds: tenants },
      }));
    });

  return (
    <Dialog open width={560} title="New API key" description="Scope the key to the least it needs: one type, explicit scopes, explicit projects." onClose={onClose}
      actions={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!valid || run.pending} onClick={() => void submit()}>Create key</Button>
      </>}>
      <div className="stack">
        <Input label="Name" placeholder="Production collector" value={name} onChange={(e) => setName(e.target.value)} />
        <div>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Type</div>
          <div className="actions" style={{ gap: 'var(--space-5)' }}>
            {(['collector', 'deployment'] as const).map((t) => (
              <Radio key={t} name="type" value={t} label={t === 'collector' ? 'Collector' : 'Deployment'} checked={type === t}
                onChange={() => { setType(t); setScopes(SCOPES_BY_TYPE[t]); }} />
            ))}
          </div>
        </div>
        {type && (
          <div>
            <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Scopes</div>
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              {SCOPES_BY_TYPE[type].map((s) => (
                <Checkbox key={s} label={<span className="mono">{s}</span>} checked={scopes.includes(s)} onChange={(on) => setScopes(toggle(scopes, s, on))} />
              ))}
            </div>
          </div>
        )}
        <div>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Projects</div>
          {projects.length === 0 ? <p className="muted small">Create a project first.</p> : (
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              {projects.map((p) => (
                <Checkbox key={p.id} label={p.name} checked={tenants.includes(p.id)} onChange={(on) => setTenants(toggle(tenants, p.id, on))} />
              ))}
            </div>
          )}
        </div>
        {run.error && <Note tone="error">{run.error}</Note>}
      </div>
    </Dialog>
  );
}

function RevealDialog({ r, onClose }: { r: RevealedApiKey; onClose: () => void }) {
  const toast = useToast();
  const copy = () =>
    navigator.clipboard.writeText(r.plaintext).then(
      () => toast({ status: 'passed', title: 'Copied to clipboard' }),
      () => toast({ status: 'blocked', title: 'Copy failed', message: 'Select the key and copy it manually.' }),
    );
  return (
    <Dialog open width={560} title="Copy your key now" onClose={onClose}
      description="Tessera stores only a hash. Once you close this dialog the secret cannot be shown again."
      actions={<Button onClick={onClose}>I have stored it</Button>}>
      <div className="stack">
        <Ticket numeral="I" label="key" title={r.apiKey.name} meta={`${r.apiKey.type} · ${r.apiKey.displayPrefix}…`} status="passed" />
        <div className="secret">
          <span style={{ flex: 1 }}>{r.plaintext}</span>
          <span className="theme-ink"><IconButton icon="copy" label="Copy" size="sm" onClick={() => void copy()} /></span>
        </div>
      </div>
    </Dialog>
  );
}
