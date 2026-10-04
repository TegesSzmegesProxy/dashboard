import { useState } from 'react';
import type { ToolCategory, ToolChoice, ToolScope } from '../../api';
import { Button, Tag, Tooltip } from '../../components';
import type { Target } from '../../policy/draft';
import { useEditor } from './context';

const CATEGORY: Record<ToolCategory, string> = {
  schema: 'Shape and type',
  injection: 'Injection',
  url: 'URLs',
  resource: 'Size and rate',
  anomaly: 'Abuse patterns',
};

/**
 * Selected checks as readable chips. In edit mode, offers only the tools whose
 * scope fits the target, so a check can never be placed where it cannot run.
 */
export function ToolPicker({ target, selected, scope, choices }: { target: Target; selected: string[]; scope: ToolScope; choices: ToolChoice[] }) {
  const { tool, tools, editing, dispatch } = useEditor();
  const [open, setOpen] = useState(false);
  const available = tools.filter((t) => t.scope === scope && !selected.includes(t.id));
  const set = (toolId: string, on: boolean) => dispatch({ type: 'tool', target, toolId, on });

  return (
    <div className="stack" style={{ gap: 'var(--space-2)' }}>
      <div className="pe-chips">
        {selected.length === 0 && <span className="faint small">No checks.</span>}
        {selected.map((id) => {
          const def = tool(id);
          const why = choices.find((c) => c.toolId === id);
          const tip = [def?.summary ?? id, why && `Why: ${why.rationale}`].filter(Boolean).join(' ');
          return (
            <Tooltip key={id} label={tip}>
              <Tag mono={false} onRemove={editing ? () => set(id, false) : undefined}>
                {def?.label ?? id}
                {(def?.stateful || why?.basis === 'inferred') && <span className="pe-flag" title="Chosen from the endpoint's purpose rather than code; confirm it">inferred</span>}
              </Tag>
            </Tooltip>
          );
        })}
        {editing && available.length > 0 && (
          <Button size="sm" variant="ghost" iconLeft={open ? 'minus' : 'plus'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? 'Done' : 'Add check'}
          </Button>
        )}
      </div>

      {editing && open && (
        <div className="pe-catalog" role="group" aria-label="Available checks">
          {(Object.keys(CATEGORY) as ToolCategory[]).map((cat) => {
            const list = available.filter((t) => t.category === cat);
            if (list.length === 0) return null;
            return (
              <div key={cat}>
                <div className="eyebrow" style={{ margin: 'var(--space-2) 0 var(--space-1)' }}>{CATEGORY[cat]}</div>
                {list.map((t) => (
                  <button key={t.id} type="button" className="pe-tool" onClick={() => set(t.id, true)}>
                    <span className="spread">
                      <span style={{ color: 'var(--text-strong)', fontWeight: 500 }}>{t.label}</span>
                      <span className="mono faint">{t.id}</span>
                    </span>
                    <span className="muted small" style={{ display: 'block' }}>{t.summary}</span>
                    {t.stateful && <span className="faint small" style={{ display: 'block' }}>Needs request history; the analysis cannot confirm it from code.</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
