import { useEffect, useState } from 'react';
import { useApi, usePaged, useResource, type Analysis, type AnalysisUpload, type AnalysisSummary } from '../api';
import { Badge, Button, Dialog, Input } from '../components';
import { useOrg } from '../Layout';
import { AnalysisBadge, LoadMore, Loading, newIdempotencyKey, Note, Section, short, useAction, when } from '../ui';

export function ProjectAnalyses({ path }: { path: string }) {
  const analyses = usePaged<AnalysisSummary>(`${path}/analyses`);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Section title="Analyses" desc="A collector upload starts one analysis of the bound repository at that commit. It waits for a budget you approve before any AI cost is incurred. Results are immutable.">
      {analyses.error && <Note tone="error">{analyses.error}</Note>}
      {analyses.loading && !analyses.items.length ? <Loading what="analyses" /> : analyses.items.length === 0 ? (
        <p className="muted small">No analyses yet. Run the collector in CI with a collector key for this project.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Commit</th><th>Repository</th><th>Status</th><th>Version</th><th>Started</th></tr></thead>
            <tbody>
              {analyses.items.map((a) => (
                <tr key={a.id} className="link" onClick={() => setOpen(a.id)}>
                  <td className="mono">{short(a.commitSha)}</td>
                  <td className="mono">{a.repository?.fullName ?? '—'}</td>
                  <td><AnalysisBadge status={a.status} /></td>
                  <td className="mono muted">{a.version ?? '—'}</td>
                  <td className="mono muted">{when(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore hasMore={analyses.hasMore} loadMore={analyses.loadMore} />
      {open && <AnalysisDialog path={`${path}/analyses/${open}`} projectPath={path} onClose={() => setOpen(null)} />}
    </Section>
  );
}

function UploadManifest({ projectPath, uploadId }: { projectPath: string; uploadId: string }) {
  const { data: u, error } = useResource<AnalysisUpload>(`${projectPath}/analysis-uploads/${uploadId}`);
  if (error) return <Note tone="error">{error}</Note>;
  if (!u) return <Loading what="upload manifest" />;
  return (
    <div>
      <div className="eyebrow">Collector upload</div>
      <p className="mono small" style={{ margin: 'var(--space-2) 0' }}>
        {u.collector.name} {u.collector.version} · received {when(u.receivedAt)} · {u.environmentSummary.dependencyCount} dependencies · {u.environmentSummary.vulnerabilityCount} vulnerabilities
      </p>
      <p className="mono faint small" style={{ margin: 0 }}>
        redacted by {u.redaction.tool} ({u.redaction.rules.join(', ') || 'no rules'}) · {u.redaction.redactedValueCount} values · tools: {u.environmentSummary.tools.map((t) => `${t.name} ${t.version} ${t.status}`).join(', ') || 'none'}
      </p>
    </div>
  );
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Shows the cost estimate and lets an owner or admin approve the spending ceiling (ADR-0015). */
function BudgetApproval({ path, a, onDone }: { path: string; a: Analysis; onDone: () => void }) {
  const api = useApi();
  const run = useAction();
  const [idem] = useState(newIdempotencyKey);
  const e = a.estimate;
  const [ceiling, setCeiling] = useState(e ? String(e.suggestedCeilingUsd) : '');
  const value = Number(ceiling);
  const valid = Number.isFinite(value) && value > 0 && value <= 10000;
  if (!e) return null;
  return (
    <div className="stack">
      <div className="eyebrow">Estimate · before any AI cost</div>
      <p className="mono small" style={{ margin: 0 }}>
        {e.workItems.expected} endpoints to analyze ({e.workItems.low}–{e.workItems.high}) · about {usd(e.usd.expected)} ({usd(e.usd.low)}–{usd(e.usd.high)}) with {e.model}
      </p>
      <ul className="faint small" style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>
        {e.assumptions.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
      {!e.aiCredentialConfigured && <Note tone="error">Connect an Anthropic API key for this organization under Integrations before approving a budget.</Note>}
      <div className="actions">
        <Input label="Spending ceiling (USD)" type="number" mono value={ceiling} onChange={(ev) => setCeiling(ev.target.value)} />
        <Button disabled={!valid || !e.aiCredentialConfigured || run.pending}
          onClick={() => void run.go(() => api(`${path}/budget-approval`, { method: 'POST', idempotencyKey: idem, body: { ceilingUsd: value } }), 'Budget approved').then((ok) => ok && onDone())}>
          Approve and start
        </Button>
      </div>
      <p className="faint small" style={{ margin: 0 }}>The analysis stops when the ceiling is reached; work left over stays visible as unresolved.</p>
      {run.error && <Note tone="error">{run.error}</Note>}
    </div>
  );
}

function AnalysisDialog({ path, projectPath, onClose }: { path: string; projectPath: string; onClose: () => void }) {
  const { canEdit } = useOrg();
  const api = useApi();
  const resume = useAction();
  const { data: a, error, reload } = useResource<Analysis>(path);
  const running = a?.status === 'queued' || a?.status === 'running';
  // The worker runs in the background; poll while it works.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(reload, 4000);
    return () => clearInterval(id);
  }, [running, reload]);

  return (
    <Dialog open width={880} title={a ? `Analysis ${short(a.commitSha)}` : 'Analysis'} onClose={onClose}
      description={a ? `${a.repository?.fullName ?? ''} · ${a.usage.models[0] ?? a.estimate?.model ?? 'no AI model yet'} · ${when(a.createdAt)}` : undefined}>
      <div className="stack" style={{ maxHeight: '70vh', overflowY: 'auto', paddingBottom: 'var(--space-6)' }}>
        {error && <Note tone="error">{error}</Note>}
        {!a && !error && <Loading what="analysis" />}
        {a && (
          <>
            <div className="spread">
              <span className="actions">
                <AnalysisBadge status={a.status} />
                {a.errorCode && <Badge status="blocked" dot={false}>{a.errorCode}</Badge>}
              </span>
              <span className="mono muted small">
                spent {usd(a.usage.usd)}{a.budget ? ` of ${usd(a.budget.ceilingUsd)}` : ''}
              </span>
            </div>
            <UploadManifest projectPath={projectPath} uploadId={a.uploadId} />

            {a.environment?.notice && <Note>{a.environment.notice}</Note>}
            {a.environment?.snapshotId && <p className="mono faint small" style={{ margin: 0 }}>environment snapshot {short(a.environment.snapshotId)} · {a.environment.ageHours} hours old</p>}

            {a.status === 'awaiting_budget' && canEdit && <BudgetApproval path={path} a={a} onDone={reload} />}
            {a.status === 'awaiting_budget' && !canEdit && <Note>Waiting for an owner or admin to approve a budget.</Note>}
            {a.status === 'paused' && (
              <Note>
                Paused: the AI provider account has no credit left ({a.errorCode}). Top it up, then resume.
                {canEdit && <> <Button size="sm" disabled={resume.pending} onClick={() => void resume.go(() => api(`${path}/resume`, { method: 'POST' }), 'Analysis resumed').then((ok) => ok && reload())}>Resume</Button></>}
              </Note>
            )}

            <div>
              <div className="eyebrow">Steps</div>
              <ul className="list">
                {a.steps.map((s) => (
                  <li key={s.name}>
                    <span className="mono">{s.name}</span>
                    <span className="actions">
                      {s.message && <span className="faint small">{s.message}</span>}
                      <Badge status={s.status === 'succeeded' ? 'passed' : s.status === 'failed' ? 'blocked' : 'neutral'}>{s.status}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {a.index && (
              <div>
                <div className="eyebrow">Repository index</div>
                <p className="mono small">
                  {a.index.files} files · {Object.entries(a.index.languages).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(' · ')}
                  {a.index.frameworkGuesses.length > 0 && ` · ${a.index.frameworkGuesses.join(', ')}`}
                </p>
                <p className="mono faint small">{a.index.strongCandidates} confirmed route candidates · {a.index.heuristicCandidates} heuristic{a.readManifest && ` · ${a.readManifest.totalLinesSent} lines read by the AI`}</p>
              </div>
            )}

            {a.results && (
              <>
                <div>
                  <div className="eyebrow">Coverage</div>
                  <p className="mono small">
                    {a.results.coverage.workItems} candidates · {a.results.coverage.endpoints} endpoints · {a.results.coverage.notAnEndpoint} not endpoints · {a.results.coverage.duplicate} duplicates · {a.results.coverage.unresolved} unresolved
                  </p>
                  {a.results.coverage.unresolved > 0 && <Note>Some candidates stayed unresolved (budget, limits or invalid output). They are listed under work items; nothing was dropped silently.</Note>}
                </div>

                <div>
                  <div className="eyebrow">Endpoints · {a.results.endpoints.length}</div>
                  <ul className="list">
                    {a.results.endpoints.map((e) => (
                      <li key={`${e.method} ${e.path}`} style={{ alignItems: 'flex-start' }}>
                        <span className="stack" style={{ gap: 'var(--space-2)', minWidth: 0 }}>
                          <span><span className="method">{e.method}</span> <code className="mono">{e.path}</code></span>
                          <span className="muted small">{e.humanReadablePolicy}</span>
                          <span className="mono faint small">
                            auth {e.auth.required}{e.requestTools.length > 0 && ` · request: ${e.requestTools.map((t) => t.toolId).join(', ')}`}
                            {e.fields.filter((f) => f.tools.length > 0).map((f) => ` · ${f.name}: ${f.tools.map((t) => t.toolId).join(', ')}`).join('')}
                          </span>
                          {[...e.warnings, ...e.limitations].map((w, i) => <span key={i} className="faint small">⚠ {w}</span>)}
                        </span>
                        <Badge status={e.confidence === 'high' ? 'passed' : e.confidence === 'medium' ? 'review' : 'neutral'}>{e.confidence}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
