import { useState } from 'react';
import { useApi, usePaged, type PolicyVersion, type StructuredPolicy } from '../api';
import { Button, Dialog, Input } from '../components';
import { useOrg } from '../Layout';
import { LoadMore, Loading, newIdempotencyKey, Note, PolicyBadge, Section, useAction, when } from '../ui';

export function ProjectPolicies({ path }: { path: string }) {
  const { canEdit } = useOrg();
  const policies = usePaged<PolicyVersion>(`${path}/policies`);
  const [selected, setSelected] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const current = policies.items.find((p) => p.version === selected) ?? policies.items[0];

  return (
    <div className="grid-main" style={{ gridTemplateColumns: '1fr 1.6fr' }}>
      <Section title="Versions" desc="Each version is immutable. Editing means importing a new one."
        aside={canEdit ? <Button size="sm" iconLeft="plus" onClick={() => setImporting(true)}>Import</Button> : undefined}>
        {policies.error && <Note tone="error">{policies.error}</Note>}
        {policies.loading && !policies.items.length ? <Loading what="policies" /> : policies.items.length === 0 ? (
          <p className="muted small">No policy versions yet.</p>
        ) : (
          <ul className="list">
            {policies.items.map((p) => (
              <li key={p.id} className="link" onClick={() => setSelected(p.version)}
                style={p.version === current?.version ? { background: 'var(--surface-sunken)' } : undefined}>
                <span>
                  <span className="mono title">{p.version}</span>
                  <span className="faint small" style={{ display: 'block' }}>{p.structuredPolicy.endpoints.length} endpoints · {when(p.createdAt)}</span>
                </span>
                <PolicyBadge state={p.state} />
              </li>
            ))}
          </ul>
        )}
        <LoadMore hasMore={policies.hasMore} loadMore={policies.loadMore} />
      </Section>

      {current ? <PolicyDetail key={current.id} p={current} path={path} reload={policies.reload} /> : <span />}
      {importing && <ImportDialog path={path} onClose={() => setImporting(false)} onDone={(v) => { setImporting(false); setSelected(v); policies.reload(); }} />}
    </div>
  );
}

function PolicyDetail({ p, path, reload }: { p: PolicyVersion; path: string; reload: () => void }) {
  const { canEdit } = useOrg();
  const api = useApi();
  const run = useAction();
  // One key per action on this version: a retry after a failed request reuses it.
  const [idem] = useState(() => ({ approve: newIdempotencyKey(), reject: newIdempotencyKey(), activate: newIdempotencyKey() }));
  const [dialog, setDialog] = useState<'reject' | 'activate' | null>(null);
  const [reason, setReason] = useState('');
  const vpath = `${path}/policies/${encodeURIComponent(p.version)}`;

  const act = (action: 'approve' | 'reject' | 'activate', body?: unknown) =>
    run.go(() => api(`${vpath}/${action}`, { method: 'POST', idempotencyKey: idem[action], body }),
      { approve: 'Policy approved', reject: 'Policy rejected', activate: 'Policy activated' }[action])
      .then((ok) => { if (ok) { setDialog(null); reload(); } });

  return (
    <Section title={`Version ${p.version}`} aside={<PolicyBadge state={p.state} />}
      desc={<>Created {when(p.createdAt)} by <span className="mono">{p.createdBy}</span> · {p.schemaVersion} · {p.toolRegistryVersion}</>}>
      <div className="stack">
        {p.compilationError && <Note tone="error"><strong>{p.compilationError.code}</strong> — {p.compilationError.message}</Note>}
        {p.rejectionReason && <Note>Rejected: {p.rejectionReason}</Note>}

        <div>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Intent</div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{p.humanReadableIntent}</p>
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Endpoints</div>
          {p.structuredPolicy.endpoints.map((e) => (
            <article key={`${e.method} ${e.path}`} className="endpoint">
              <header><span><span className="method">{e.method}</span><code className="mono">{e.path}</code></span><span className="faint small">{e.tools.length} tools</span></header>
              {e.tools.length > 0 && (
                <table className="table">
                  <thead><tr><th>Target</th><th>Tool</th><th>Config</th></tr></thead>
                  <tbody>
                    {e.tools.map((t, i) => (
                      <tr key={i}>
                        <td className="mono">{t.target}</td>
                        <td className="mono">{t.toolId}</td>
                        <td className="mono muted">{Object.entries(t.config).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </article>
          ))}
        </div>

        {canEdit && p.state === 'PENDING_APPROVAL' && (
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <Button variant="outline" onClick={() => setDialog('reject')}>Reject</Button>
            <Button disabled={run.pending} onClick={() => void act('approve')}>Approve</Button>
          </div>
        )}
        {canEdit && p.state === 'APPROVED' && (
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <span className="muted small">Approved, not yet distributed.</span>
            <Button iconRight="arrow-right" onClick={() => setDialog('activate')}>Activate</Button>
          </div>
        )}
      </div>

      <Dialog open={dialog === 'reject'} title={`Reject ${p.version}?`} onClose={() => setDialog(null)}
        description="The reason is kept on the version for the audit trail."
        actions={<>
          <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="danger" disabled={!reason.trim() || run.pending} onClick={() => void act('reject', { reason: reason.trim() })}>Reject</Button>
        </>}>
        <Input label="Reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Dialog>

      <Dialog open={dialog === 'activate'} title={`Activate ${p.version}?`} onClose={() => setDialog(null)}
        description="Tessera builds one signed bundle from this policy and the current runtime configuration, and selects it for distribution. Running proxies show restart required until they restart."
        actions={<>
          <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
          <Button disabled={run.pending} onClick={() => void act('activate')}>Activate</Button>
        </>} />
    </Section>
  );
}

const EXAMPLE: StructuredPolicy = {
  schemaVersion: 'tessera.policy/v1',
  endpoints: [{ method: 'POST', path: '/users/:id', tools: [{ toolId: 'string_length', target: 'body.username', config: { minLength: 3, maxLength: 32 } }] }],
};

function ImportDialog({ path, onClose, onDone }: { path: string; onClose: () => void; onDone: (version: string) => void }) {
  const api = useApi();
  const run = useAction();
  const [intent, setIntent] = useState('');
  const [json, setJson] = useState(JSON.stringify(EXAMPLE, null, 2));

  let parsed: StructuredPolicy | null = null;
  let parseError: string | null = null;
  try {
    const v = JSON.parse(json) as Partial<StructuredPolicy>;
    if (v.schemaVersion !== 'tessera.policy/v1' || !Array.isArray(v.endpoints)) parseError = 'Needs schemaVersion "tessera.policy/v1" and an endpoints array';
    else parsed = v as StructuredPolicy;
  } catch (e) {
    parseError = e instanceof Error ? e.message : 'Invalid JSON';
  }

  return (
    <Dialog open width={720} title="Import policy version" onClose={onClose}
      description="Creates a new version and compiles it against the tool registry. It still needs approval and activation."
      actions={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!parsed || !intent.trim() || run.pending}
          onClick={() => void run.go(async () => {
            const v = await api<PolicyVersion>(`${path}/policies/import`, { method: 'POST', body: { humanReadableIntent: intent.trim(), structuredPolicy: parsed } });
            onDone(v.version);
          }, 'Policy imported')}>Import</Button>
      </>}>
      <div className="stack">
        <label className="stack" style={{ gap: 'var(--space-2)' }}>
          <span className="small" style={{ fontWeight: 500, color: 'var(--text-strong)' }}>Intent</span>
          <textarea className="textarea sans" maxLength={10000} placeholder="Usernames are 3–32 characters." value={intent} onChange={(e) => setIntent(e.target.value)} />
        </label>
        <label className="stack" style={{ gap: 'var(--space-2)' }}>
          <span className="small" style={{ fontWeight: 500, color: 'var(--text-strong)' }}>Structured policy <span className="mono faint">tessera.policy/v1</span></span>
          <textarea className="textarea" style={{ minHeight: 240 }} spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} />
        </label>
        {parseError && <Note tone="error">{parseError}</Note>}
        {run.error && <Note tone="error">{run.error}</Note>}
      </div>
    </Dialog>
  );
}
