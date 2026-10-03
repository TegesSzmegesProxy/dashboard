import { useEffect, useState } from 'react';
import { useApi, usePaged, useResource, type AnalysisSummary, type Page, type PolicyDiff, type PolicyGeneration } from '../api';
import { Badge, Button, Dialog, Select } from '../components';
import { useOrg } from '../Layout';
import { LoadMore, Loading, newIdempotencyKey, Note, Section, short, useAction, when } from '../ui';

const STATUS = { queued: 'neutral', running: 'jev', succeeded: 'passed', failed: 'blocked' } as const;
const range = (b: { minLength?: number; maxLength?: number }) => `${b.minLength ?? '—'}…${b.maxLength ?? '—'}`;

function Diff({ d }: { d: PolicyDiff }) {
  const lines = [
    ...d.addedEndpoints.map((e) => `+ endpoint ${e}`),
    ...d.removedEndpoints.map((e) => `− endpoint ${e}`),
    ...d.changedEndpoints.flatMap((c) => [
      ...c.addedTargets.map((t) => `+ ${c.endpoint} ${t}`),
      ...c.removedTargets.map((t) => `− ${c.endpoint} ${t}`),
      ...c.changedTargets.map((t) => `~ ${c.endpoint} ${t.target}: ${range(t.before)} → ${range(t.after)}`),
    ]),
    ...(d.humanReadableIntentChanged ? ['~ intent text changed'] : []),
  ];
  return <pre className="mono small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{lines.join('\n') || 'No structural change.'}</pre>;
}

export function Generations({ path, onOpenVersion }: { path: string; onOpenVersion: (v: string) => void }) {
  const { canEdit } = useOrg();
  const gens = usePaged<PolicyGeneration>(`${path}/policy-generations`);
  const [generating, setGenerating] = useState(false);
  const active = gens.items.some((g) => g.status === 'queued' || g.status === 'running');
  // Attempts run in a background worker; poll until none is in flight.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(gens.reload, 4000);
    return () => clearInterval(id);
  }, [active, gens.reload]);

  return (
    <Section title="AI generation" desc="Attempts to generate a policy from an analysis, or to edit one with an instruction. A result is a new version that still needs review, approval and activation; a failed attempt creates nothing."
      aside={canEdit ? <Button size="sm" iconLeft="zap" onClick={() => setGenerating(true)}>Generate from analysis</Button> : undefined}>
      {gens.error && <Note tone="error">{gens.error}</Note>}
      {gens.loading && !gens.items.length ? <Loading what="attempts" /> : gens.items.length === 0 ? (
        <p className="muted small">No attempts yet.</p>
      ) : (
        <ul className="list">
          {gens.items.map((g) => (
            <li key={g.id} style={{ alignItems: 'flex-start' }}>
              <div className="stack" style={{ gap: 'var(--space-2)', minWidth: 0 }}>
                <span>
                  <span className="title">{g.kind === 'generate' ? 'Generated from analysis' : 'Edited with instruction'}</span>
                  <span className="mono faint" style={{ display: 'block' }}>
                    {g.kind === 'generate' ? `commit ${g.analysisVersion ? short(g.analysisVersion) : '—'}` : `base ${g.baseVersion}`} · {g.trigger === 'analysis_completed' ? 'automatic' : g.requestedBy} · {when(g.createdAt)}
                    {g.provenance.aiModel && ` · ${g.provenance.aiModel}`}
                  </span>
                </span>
                {g.instruction && <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>“{g.instruction}”</p>}
                {g.errorCode && <Note tone="error"><strong>{g.errorCode}</strong>{g.errorMessage && ` — ${g.errorMessage}`}{g.validationIssues.length > 0 && <span className="mono small" style={{ display: 'block' }}>{g.validationIssues.join(', ')}</span>}</Note>}
                {g.limitations.length > 0 && <Note>{g.limitations.join(' ')}</Note>}
                {g.diff && <Diff d={g.diff} />}
                {g.status === 'succeeded' && <span className="faint small">{g.precisionWarning}</span>}
              </div>
              <span className="actions">
                <Badge status={STATUS[g.status]}>{g.status}</Badge>
                {g.policyVersion && <Button size="sm" variant="outline" onClick={() => onOpenVersion(g.policyVersion!)}>{g.policyVersion}{g.reusedExistingVersion ? ' (existing)' : ''}</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <LoadMore hasMore={gens.hasMore} loadMore={gens.loadMore} />
      {generating && <GenerateDialog path={path} onClose={() => setGenerating(false)} onDone={() => { setGenerating(false); gens.reload(); }} />}
    </Section>
  );
}

function GenerateDialog({ path, onClose, onDone, analysisId }: { path: string; onClose: () => void; onDone: () => void; analysisId?: string }) {
  const api = useApi();
  const run = useAction();
  const [idem] = useState(newIdempotencyKey);
  const analyses = useResource<Page<AnalysisSummary>>(analysisId ? null : `${path}/analyses?limit=100`);
  const usable = (analyses.data?.items ?? []).filter((a) => a.status === 'completed' || a.status === 'partial');
  const [picked, setPicked] = useState('');
  const chosen = analysisId ?? (picked || usable[0]?.id || '');

  return (
    <Dialog open title="Generate policy from analysis" onClose={onClose}
      description="Queues an AI attempt on a completed or partial analysis. It runs in the background and needs an AI model credential."
      actions={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!chosen || run.pending}
          onClick={() => void run.go(() => api(`${path}/policy-generations`, { method: 'POST', idempotencyKey: idem, body: { analysisId: chosen } }), 'Generation queued').then((ok) => ok && onDone())}>
          Generate
        </Button>
      </>}>
      <div className="stack">
        {!analysisId && (!analyses.data ? <Loading what="analyses" /> : usable.length === 0 ? <Note tone="info">No completed analysis yet.</Note> : (
          <Select label="Analysis" value={chosen} onChange={(e) => setPicked(e.target.value)} mono
            options={usable.map((a) => ({ value: a.id, label: `${short(a.commitSha)} · ${a.status} · ${when(a.createdAt)}` }))} />
        ))}
        {run.error && <Note tone="error">{run.error}</Note>}
      </div>
    </Dialog>
  );
}
export { GenerateDialog };

export function EditPolicyDialog({ path, version, onClose, onDone }: { path: string; version: string; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const run = useAction();
  const [idem] = useState(newIdempotencyKey);
  const [instruction, setInstruction] = useState('');
  return (
    <Dialog open title={`Edit ${version} with an instruction`} onClose={onClose}
      description="Describe the change in plain language. The result is a new version for review; it never changes this one."
      actions={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!instruction.trim() || run.pending}
          onClick={() => void run.go(() => api(`${path}/policies/${encodeURIComponent(version)}/edits`, { method: 'POST', idempotencyKey: idem, body: { instruction: instruction.trim() } }), 'Edit queued').then((ok) => ok && onDone())}>
          Queue edit
        </Button>
      </>}>
      <div className="stack">
        <label className="stack" style={{ gap: 'var(--space-2)' }}>
          <span className="small" style={{ fontWeight: 500, color: 'var(--text-strong)' }}>Instruction</span>
          <textarea className="textarea sans" maxLength={2000} placeholder="Allow usernames up to 64 characters on POST /users." value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        </label>
        {run.error && <Note tone="error">{run.error}</Note>}
      </div>
    </Dialog>
  );
}
