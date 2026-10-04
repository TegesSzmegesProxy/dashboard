import { useState } from 'react';
import type { EndpointStructuredPolicy } from '../../api';
import { Icon, Input, Tabs } from '../../components';
import { endpointKey, fieldKey, parseTargetId, type Change } from '../../policy/draft';
import { useEditor } from './context';

/** Left rail: every endpoint with its change and review markers. */
export function EndpointList({ policy, changes, selected, onSelect }: { policy: EndpointStructuredPolicy; changes: Change[]; selected: string; onSelect: (key: string) => void }) {
  const { draft, warnings, editing } = useEditor();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  const rows = policy.endpoints.map((e) => {
    const key = endpointKey(e);
    const attention = [...draft.uncompiled, ...draft.staleText].filter((id) => parseTargetId(id).endpoint === key).length;
    const warned = warnings({ endpoint: key, field: null }).length > 0 || e.fields.some((f) => warnings({ endpoint: key, field: fieldKey(f) }).length > 0);
    const checks = e.requestTools.length + e.fields.reduce((n, f) => n + f.tools.length, 0);
    return { e, key, changed: changes.filter((c) => c.endpoint === key).length, attention, warned, checks };
  });
  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) =>
    (!q || r.key.toLowerCase().includes(q)) &&
    (filter === 'all' || (filter === 'changed' && (r.changed || r.attention)) || (filter === 'review' && r.warned)));

  const tabs = [
    { id: 'all', label: 'All', count: rows.length },
    ...(editing ? [{ id: 'changed', label: 'Changed', count: rows.filter((r) => r.changed || r.attention).length }] : []),
    { id: 'review', label: 'Review', count: rows.filter((r) => r.warned).length },
  ];

  return (
    <nav className="pe-rail stack" style={{ gap: 'var(--space-3)' }} aria-label="Endpoints">
      <Input icon="search" placeholder="Filter by method or path" aria-label="Filter endpoints" value={query} onChange={(e) => setQuery(e.target.value)} />
      <Tabs variant="pill" value={filter} onChange={setFilter} tabs={tabs} />
      {visible.length === 0 && <p className="faint small">No endpoints match.</p>}
      <ul className="list">
        {visible.map((r) => (
          <li key={r.key} className={`link ${r.key === selected ? 'on' : ''}`} aria-current={r.key === selected ? 'true' : undefined}
            tabIndex={0} onClick={() => onSelect(r.key)} onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onSelect(r.key))}>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="pe-ellipsis" style={{ display: 'block' }}><span className="method">{r.e.method}</span><code className="mono">{r.e.path}</code></span>
              <span className="faint small">{r.checks} checks · {r.e.fields.length} fields{r.changed > 0 && ` · ${r.changed} changes`}</span>
            </span>
            <span className="actions" style={{ flexWrap: 'nowrap' }}>
              {r.changed > 0 && <span className="pe-dot" title="Changed in this draft" />}
              {r.attention > 0 && <span className="pe-dot warn" title="Text not compiled or description out of date" />}
              {r.warned && <Icon name="shield-alert" size={14} style={{ color: 'var(--ochre-600)' }} />}
            </span>
          </li>
        ))}
      </ul>
    </nav>
  );
}
