import { useState } from 'react';
import { POLICY_V2_LIMITS, type FieldPolicyV2, type ToolChoice } from '../../api';
import { Icon } from '../../components';
import { fieldKey, scopeOf, targetId, type Change } from '../../policy/draft';
import { useEditor } from './context';
import { JevContextEditor, PlainLanguageEditor } from './PlainLanguageEditor';
import { ToolPicker } from './ToolPicker';

/** One field: a readable summary row that expands into its editors. */
export function FieldRow({ endpoint, field, choices, changes }: { endpoint: string; field: FieldPolicyV2; choices: ToolChoice[]; changes: Change[] }) {
  const { tool, draft, warnings } = useEditor();
  const target = { endpoint, field: fieldKey(field) };
  const id = targetId(target);
  const needsAttention = draft.uncompiled.includes(id) || draft.staleText.includes(id);
  const [open, setOpen] = useState(needsAttention);
  const warned = warnings(target).length > 0;
  const changed = changes.length > 0;

  return (
    <div className="pe-field" id={`target-${id}`}>
      <button type="button" className="pe-field-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="spread" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
            <code className="mono" style={{ color: 'var(--text-strong)' }}>{field.name}</code>
            <span className="faint small">{field.type} · {field.required ? 'required' : 'optional'}</span>
            {changed && <span className="pe-dot" title="Changed in this draft" />}
            {needsAttention && <span className="pe-dot warn" title="Needs your attention before saving" />}
            {warned && <Icon name="shield-alert" size={14} style={{ color: 'var(--ochre-600)' }} />}
          </span>
          {!open && (
            <span className="small muted pe-ellipsis" style={{ display: 'block' }}>
              {field.tools.length === 0 ? 'No checks' : field.tools.map((t) => tool(t.toolId)?.label ?? t.toolId).join(' · ')}
              {field.humanReadablePolicy && ` — ${field.humanReadablePolicy}`}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="pe-field-body">
          {warnings(target).filter((w) => w.kind === 'analysis').map((w, i) => <div key={i} className="note">{w.message}</div>)}
          <div>
            <div className="eyebrow pe-label">What this field enforces</div>
            <PlainLanguageEditor target={target} max={POLICY_V2_LIMITS.fieldText} placeholder="e.g. Usernames are checked for length and script injection." />
          </div>
          <div>
            <div className="eyebrow pe-label">Checks</div>
            <ToolPicker target={target} selected={field.tools.map((t) => t.toolId)} scope={scopeOf(field)} choices={choices} />
          </div>
          <div>
            <div className="eyebrow pe-label">JEV context</div>
            <JevContextEditor target={target} value={field.jevContext} max={POLICY_V2_LIMITS.fieldJev} />
          </div>
        </div>
      )}
    </div>
  );
}
