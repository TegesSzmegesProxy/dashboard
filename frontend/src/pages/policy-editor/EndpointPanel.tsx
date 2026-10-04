import { useState } from 'react';
import { POLICY_V2_LIMITS, type EndpointPolicyV2, type FieldLocation } from '../../api';
import { Badge, Button, Tabs } from '../../components';
import { endpointKey, fieldKey, type Change } from '../../policy/draft';
import { Note } from '../../ui';
import { useEditor } from './context';
import { FieldRow } from './FieldRow';
import { JevContextEditor, PlainLanguageEditor } from './PlainLanguageEditor';
import { ToolPicker } from './ToolPicker';

const LOCATION: Record<FieldLocation, string> = { body: 'Body', query: 'Query', path: 'Path', header: 'Headers', cookie: 'Cookies', file: 'Files' };
const CONFIDENCE = { high: 'passed', medium: 'review', low: 'neutral' } as const;

export function EndpointPanel({ endpoint, changes }: { endpoint: EndpointPolicyV2; changes: Change[] }) {
  const { editing, dispatch, facts, warnings } = useEditor();
  const key = endpointKey(endpoint);
  const fact = facts.get(key);
  const target = { endpoint: key, field: null };
  const locations = [...new Set(endpoint.fields.map((f) => f.location))];
  const [location, setLocation] = useState<string>('all');
  const shown = endpoint.fields.filter((f) => location === 'all' || f.location === location);
  const endpointWarnings = warnings(target).filter((w) => w.kind === 'analysis');
  const notEnforced = [...(fact?.observedLimits.map((l) => `${l.subject}: ${l.limit} (observed, not enforced yet)`) ?? []), ...(fact?.limitations ?? [])];

  return (
    <article className="stack" aria-label={`Endpoint policy ${key}`}>
      <header className="spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div><span className="method">{endpoint.method}</span><code className="mono" style={{ fontSize: 'var(--fs-body)', color: 'var(--text-strong)' }}>{endpoint.path}</code></div>
          {fact && (
            <span className="faint small">
              Authentication {fact.auth.required === 'yes' ? `required (${fact.auth.mechanism || 'mechanism unknown'})` : fact.auth.required === 'no' ? 'not required' : 'unknown'}
            </span>
          )}
        </div>
        <span className="actions">
          {fact && <Badge status={CONFIDENCE[fact.confidence]}>{fact.confidence} confidence</Badge>}
          {editing && changes.length > 0 && <Button size="sm" variant="ghost" iconLeft="refresh-cw" onClick={() => dispatch({ type: 'revertEndpoint', endpoint: key })}>Revert endpoint</Button>}
        </span>
      </header>

      {endpointWarnings.length > 0 && (
        <Note>
          <strong>Review before approving</strong>
          <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-5)' }}>{endpointWarnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        </Note>
      )}

      <section className="pe-block">
        <div className="eyebrow pe-label">What this endpoint enforces</div>
        <PlainLanguageEditor target={target} max={POLICY_V2_LIMITS.endpointText} placeholder="e.g. Login attempts are rate limited; the body must match the login form." />
      </section>

      <section className="pe-block">
        <div className="eyebrow pe-label">Request checks</div>
        <ToolPicker target={target} selected={endpoint.requestTools.map((t) => t.toolId)} scope="full" choices={fact?.requestTools ?? []} />
      </section>

      {notEnforced.length > 0 && (
        <section className="pe-block">
          <div className="eyebrow pe-label">Not enforced yet</div>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>{notEnforced.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </section>
      )}

      <section className="pe-block">
        <div className="eyebrow pe-label">JEV context</div>
        <JevContextEditor target={target} value={endpoint.jevContext} max={POLICY_V2_LIMITS.endpointJev} />
      </section>

      <section className="pe-block stack" style={{ gap: 'var(--space-3)' }}>
        <div className="spread">
          <span className="eyebrow">Fields · {endpoint.fields.length}</span>
          {locations.length > 1 && (
            <Tabs variant="pill" value={location} onChange={setLocation}
              tabs={[{ id: 'all', label: 'All' }, ...locations.map((l) => ({ id: l, label: LOCATION[l], count: endpoint.fields.filter((f) => f.location === l).length }))]} />
          )}
        </div>
        {endpoint.fields.length === 0 && <p className="faint small" style={{ margin: 0 }}>The analysis found no input fields.</p>}
        {shown.map((f) => (
          <FieldRow key={fieldKey(f)} endpoint={key} field={f}
            choices={fact?.fields.find((x) => x.name === f.name && x.location === f.location)?.tools ?? []}
            changes={changes.filter((c) => c.field === fieldKey(f))} />
        ))}
      </section>
    </article>
  );
}
