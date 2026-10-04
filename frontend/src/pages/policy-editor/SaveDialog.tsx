import { useState } from 'react';
import { ApiError, errorText, useApi, type EndpointPolicyVersion, type EndpointStructuredPolicy } from '../../api';
import { Button, Dialog } from '../../components';
import type { Change } from '../../policy/draft';
import { Note } from '../../ui';
import { useEditor } from './context';

const WHAT = { text: 'Description changed', jev: 'JEV context changed' } as const;

/** Groups the draft's changes per endpoint and saves them as one new pending version. */
export function SaveDialog({ path, parent, policy, changes, onClose, onSaved }: {
  path: string; parent: EndpointPolicyVersion; policy: EndpointStructuredPolicy; changes: Change[];
  onClose: () => void; onSaved: (version: string) => void;
}) {
  const api = useApi();
  const { tool } = useEditor();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; issues: string[] } | null>(null);
  const label = (id: string) => tool(id)?.label ?? id;
  const byEndpoint = [...new Set(changes.map((c) => c.endpoint))];
  const textChanged = changes.some((c) => c.what === 'text');

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const route = parent.schemaVersion === 'tessera.policy/v3' ? 'v3' : 'v2';
      const v = await api<EndpointPolicyVersion>(`${path}/policies/${route}`, { method: 'POST', body: { parentVersion: parent.version, structuredPolicy: policy } });
      onSaved(v.version);
    } catch (e) {
      setError({ message: errorText(e), issues: e instanceof ApiError ? e.issues : [] });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open width={720} title="Save as a new version" onClose={onClose}
      description={`Creates a pending version from ${parent.version.slice(0, 12)}…. It changes nothing until it is approved and activated.`}
      actions={<>
        <Button variant="ghost" onClick={onClose}>Keep editing</Button>
        <Button disabled={pending} onClick={() => void save()}>{pending ? 'Saving…' : 'Save version'}</Button>
      </>}>
      <div className="stack" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
        {byEndpoint.map((ep) => (
          <div key={ep}>
            <code className="mono" style={{ color: 'var(--text-strong)' }}>{ep}</code>
            <ul className="small" style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-5)' }}>
              {changes.filter((c) => c.endpoint === ep).map((c, i) => (
                <li key={i}>
                  <span className="muted">{c.field ? <span className="mono">{c.field.split(':').slice(1).join(':')}</span> : 'Endpoint'}: </span>
                  {c.what === 'checks'
                    ? <>{c.added.map((t) => <span key={t} style={{ color: 'var(--verdigris-600)', marginRight: 'var(--space-2)' }}>+ {label(t)}</span>)}
                      {c.removed.map((t) => <span key={t} style={{ color: 'var(--clay-600)', marginRight: 'var(--space-2)' }}>− {label(t)}</span>)}</>
                    : WHAT[c.what]}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {(textChanged || parent.precisionWarning) && <Note tone="info">{parent.precisionWarning ?? 'Plain-language text is imprecise; the checks, not the text, are what gets enforced.'}</Note>}
        {error && (
          <Note tone="error">
            {error.message}
            {error.issues.length > 0 && <ul className="mono small" style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-5)' }}>{error.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
          </Note>
        )}
      </div>
    </Dialog>
  );
}
