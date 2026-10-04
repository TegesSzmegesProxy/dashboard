import { useState } from 'react';
import type { CompiledEndpoint } from '../../api';
import { Button } from '../../components';
import { describeChecks, findTarget, targetId, textOf, toolsOf, type Target } from '../../policy/draft';
import { Note } from '../../ui';
import { useEditor } from './context';

const counter = (n: number, max: number) => (
  <span className={`mono ${n > max ? '' : 'faint'}`} style={n > max ? { color: 'var(--clay-600)' } : undefined}>{n} / {max}</span>
);

/**
 * The human-readable policy of an endpoint or field. It is never enforced:
 * after editing it, the user compiles it into checks and accepts or discards
 * the result before the draft can be saved.
 */
export function PlainLanguageEditor({ target, max, placeholder }: { target: Target; max: number; placeholder: string }) {
  const { draft, dispatch, editing, compile, tools, tool } = useEditor();
  const [proposal, setProposal] = useState<CompiledEndpoint | null>(null);
  const [pending, setPending] = useState(false);
  const text = textOf(draft.policy, target);
  const id = targetId(target);
  const uncompiled = draft.uncompiled.includes(id);
  const stale = draft.staleText.includes(id);

  if (!editing) {
    return text.trim()
      ? <p className="pe-text">{text}</p>
      : <p className="faint small" style={{ margin: 0 }}>No description.</p>;
  }

  const runCompile = async () => {
    setPending(true);
    const result = await compile(target);
    setPending(false);
    if (result) setProposal(result);
  };

  // What the compiled endpoint would change in this target's checks.
  const before = toolsOf(draft.policy, target);
  const compiledTarget = proposal ? findTarget({ ...draft.policy, endpoints: [proposal.endpoint] }, target) : null;
  const after = compiledTarget ? (compiledTarget.field ? compiledTarget.field.tools : compiledTarget.endpoint.requestTools).map((t) => t.toolId) : before;
  const added = after.filter((t) => !before.includes(t));
  const removed = before.filter((t) => !after.includes(t));
  const label = (id: string) => tool(id)?.label ?? id;

  return (
    <div className="stack" style={{ gap: 'var(--space-2)' }}>
      <textarea
        className="textarea sans" style={{ minHeight: target.field ? 64 : 96 }}
        aria-label={target.field ? `Plain-language policy of ${target.field}` : 'Plain-language policy of the endpoint'}
        placeholder={placeholder} value={text}
        onChange={(e) => { setProposal(null); dispatch({ type: 'text', target, text: e.target.value }); }}
      />
      <div className="spread small">
        <span className="faint">Describes the checks for reviewers. Only the checks are enforced.</span>
        {counter(text.length, max)}
      </div>

      {uncompiled && !proposal && (
        <div className="note info" role="status">
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            <span>Text changed. Update the checks from it before saving.</span>
            <span className="actions">
              <Button size="sm" iconLeft="zap" disabled={pending || !text.trim()} onClick={() => void runCompile()}>
                {pending ? 'Compiling…' : 'Update checks from text'}
              </Button>
            </span>
          </div>
        </div>
      )}

      {proposal && (
        <div className="pe-proposal stack" style={{ gap: 'var(--space-2)' }} aria-live="polite">
          <span className="eyebrow">Compiler proposal</span>
          {added.length === 0 && removed.length === 0
            ? <span className="small">No change to the checks.</span>
            : (
              <span className="small">
                {added.map((t) => <span key={t} style={{ color: 'var(--verdigris-600)', marginRight: 'var(--space-3)' }}>+ {label(t)}</span>)}
                {removed.map((t) => <span key={t} style={{ color: 'var(--clay-600)', marginRight: 'var(--space-3)' }}>− {label(t)}</span>)}
              </span>
            )}
          {proposal.mock && <Note tone="info">The plain-language compiler is not available yet. Your text is kept, but the checks are not regenerated from it; adjust them yourself so they match.</Note>}
          {!proposal.mock && proposal.limitations.length > 0 && <Note>{proposal.limitations.join(' ')}</Note>}
          <span className="actions">
            <Button size="sm" onClick={() => { dispatch({ type: 'compiled', target, endpoint: proposal.endpoint }); setProposal(null); }}>Accept</Button>
            <Button size="sm" variant="ghost" onClick={() => setProposal(null)}>Discard</Button>
          </span>
        </div>
      )}

      {stale && !uncompiled && (
        <div className="note" role="status">
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            <span>The checks changed; this description may no longer match them.</span>
            <span className="actions">
              <Button size="sm" variant="outline" onClick={() => dispatch({ type: 'describe', target, text: describeChecks(toolsOf(draft.policy, target), tools, !target.field) })}>
                Use generated description
              </Button>
              <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'keepText', target })}>Keep text</Button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Free-text JEV context: data that tells JEV what legitimate input looks like. */
export function JevContextEditor({ target, value, max }: { target: Target; value: string | null; max: number }) {
  const { editing, dispatch, warnings } = useEditor();
  const lint = warnings(target).filter((w) => w.kind === 'jev_context');
  if (!editing) {
    return (
      <div className="stack" style={{ gap: 'var(--space-2)' }}>
        {value ? <p className="pe-quote">{value}</p> : <p className="faint small" style={{ margin: 0 }}>None.</p>}
        {lint.map((w, i) => <Note key={i}>{w.message}</Note>)}
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 'var(--space-2)' }}>
      <textarea
        className="textarea sans" style={{ minHeight: 56 }}
        aria-label={target.field ? `JEV context of ${target.field}` : 'JEV context of the endpoint'}
        placeholder="What this is for and what legitimate input looks like."
        value={value ?? ''} onChange={(e) => dispatch({ type: 'jev', target, text: e.target.value })}
      />
      <div className="spread small">
        <span className="faint">Given to JEV as data, never as instructions. Do not write verdicts such as “treat as safe”.</span>
        {counter(value?.length ?? 0, max)}
      </div>
      {lint.map((w, i) => <Note key={i}>{w.message} (saved version)</Note>)}
    </div>
  );
}
