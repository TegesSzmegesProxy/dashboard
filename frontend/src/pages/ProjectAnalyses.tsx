import { useState } from 'react';
import { usePaged, useResource, type Analysis, type AnalysisUpload, type AnalysisSummary, type Severity } from '../api';
import { Badge, Button, Dialog } from '../components';
import { useOrg } from '../Layout';
import { GenerateDialog } from './ProjectGenerations';
import { AnalysisBadge, LoadMore, Loading, Note, Section, short, when } from '../ui';

const SEV: Record<Severity, 'blocked' | 'review' | 'neutral'> = {
  critical: 'blocked', high: 'blocked', medium: 'review', low: 'neutral', unknown: 'neutral',
};

export function ProjectAnalyses({ path }: { path: string }) {
  const analyses = usePaged<AnalysisSummary>(`${path}/analyses`);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Section title="Analyses" desc="A collector upload starts one analysis of the bound repository at that commit. Results are immutable.">
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

function AnalysisDialog({ path, projectPath, onClose }: { path: string; projectPath: string; onClose: () => void }) {
  const { canEdit } = useOrg();
  const { data: a, error } = useResource<Analysis>(path);
  const [generating, setGenerating] = useState(false);
  return (
    <Dialog open width={880} title={a ? `Analysis ${short(a.commitSha)}` : 'Analysis'} onClose={onClose}
      description={a ? `${a.repository?.fullName ?? ''} · ${a.provenance.aiModel ?? 'no AI model'} · ${when(a.createdAt)}` : undefined}>
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
              {canEdit && (a.status === 'completed' || a.status === 'partial') && (
                <Button size="sm" iconLeft="zap" onClick={() => setGenerating(true)}>Generate policy</Button>
              )}
            </div>
            <UploadManifest projectPath={projectPath} uploadId={a.uploadId} />

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

            {a.manifest && (
              <div>
                <div className="eyebrow">Source manifest</div>
                <p className="mono small">
                  {a.manifest.totals.includedFiles} files kept of {a.manifest.totals.entriesScanned} scanned · {a.manifest.totals.includedBytes} bytes · {a.manifest.totals.redactions} values redacted
                  {a.manifest.truncated && ' · truncated'}
                </p>
                <p className="mono faint small">
                  excluded: {Object.entries(a.manifest.excludedCounts).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}
                </p>
              </div>
            )}

            {a.results && (
              <>
                <div>
                  <div className="eyebrow">Vulnerabilities · {a.results.vulnerabilities.length}</div>
                  {a.results.vulnerabilities.length > 0 && (
                    <table className="table">
                      <thead><tr><th>ID</th><th>Package</th><th>Installed</th><th>Fixed</th><th>Severity</th></tr></thead>
                      <tbody>
                        {a.results.vulnerabilities.map((v) => (
                          <tr key={`${v.id}-${v.packageName}`}>
                            <td className="mono">{v.id}</td><td className="mono">{v.packageName}</td>
                            <td className="mono">{v.installedVersion}</td><td className="mono">{v.fixedVersion ?? '—'}</td>
                            <td><Badge status={SEV[v.severity]}>{v.severity}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div>
                  <div className="eyebrow">API surface · {a.results.apiSurface.length}</div>
                  <ul className="list">
                    {a.results.apiSurface.map((e) => (
                      <li key={`${e.method} ${e.path}`} style={{ justifyContent: 'flex-start' }}>
                        <span className="method">{e.method}</span><code className="mono">{e.path}</code>
                        <span className="muted small">{e.description}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <div className="eyebrow">Findings · {a.results.findings.length}</div>
                  <ul className="list">
                    {a.results.findings.map((f, i) => (
                      <li key={i} style={{ alignItems: 'flex-start' }}>
                        <span>
                          <span className="title">{f.title}</span>
                          <span className="muted small" style={{ display: 'block' }}>{f.description}</span>
                          <span className="mono faint">{f.category} · {f.basis}</span>
                        </span>
                        <Badge status={f.severity === 'high' || f.severity === 'critical' ? 'blocked' : f.severity === 'medium' ? 'review' : 'neutral'}>{f.severity}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>

                <p className="mono faint">{a.results.dependencies.length} dependencies · tools: {a.results.environmentTools.map((t) => `${t.name} ${t.version} ${t.status}`).join(', ') || 'none'}</p>
              </>
            )}
          </>
        )}
      </div>
      {generating && <GenerateDialog path={projectPath} analysisId={a?.id} onClose={() => setGenerating(false)} onDone={() => { setGenerating(false); onClose(); }} />}
    </Dialog>
  );
}
