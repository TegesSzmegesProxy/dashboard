import { useNavigate } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, useApi, useResource, type AnalysisReadiness, type AnalysisSummary, type EnvironmentStatus, type GitHubInstallation, type RepositoryBinding } from '../api';
import { Badge, Button, Icon } from '../components';
import { useOrg } from '../Layout';
import { AnalysisBadge, Loading, newIdempotencyKey, Note, Section, useAction } from '../ui';
import { ConnectGitHubButton, Repository } from './GitHubSource';

type Tone = 'passed' | 'review' | 'blocked' | 'neutral';

/** One prerequisite: its state, what it means, and the action that fixes it. */
function Step({ n, title, tone, state, children }: { n: number; title: string; tone: Tone; state: string; children?: ReactNode }) {
  return (
    <li style={{ alignItems: 'flex-start' }}>
      <span className="stack" style={{ gap: 'var(--space-2)', minWidth: 0, flex: 1 }}>
        <span className="spread" style={{ justifyContent: 'flex-start' }}>
          <span className="mono faint">{n}</span>
          <span className="title">{title}</span>
          <Badge status={tone}>{state}</Badge>
        </span>
        {children}
      </span>
    </li>
  );
}

/**
 * Starts a policy generation from the project's own GitHub repository: connect
 * GitHub, bind the repository, check what the analysis will use, and run it.
 * The result is an analysis that waits for a budget, then proposes a policy.
 */
export function GeneratePolicyCard({ path, tenantId }: { path: string; tenantId: string }) {
  const { org, base, canEdit } = useOrg();
  const api = useApi();
  const run = useAction();
  const navigate = useNavigate();
  const installs = useResource<GitHubInstallation[]>(`/organizations/${org.id}/github-installations`);
  const repo = useResource<RepositoryBinding>(`${path}/repository`, true);
  const env = useResource<EnvironmentStatus>(`${path}/environment`);
  const ready = useResource<AnalysisReadiness>(`${path}/analysis-readiness`);
  // One key per click-through: retrying after a failed request reuses it.
  const [idem, setIdem] = useState(newIdempotencyKey);

  const linked = installs.data?.length ?? 0;
  const bound = repo.data !== null && repo.data !== undefined;
  const r = ready.data;
  const active = r?.activeAnalysis ?? null;
  // Loading only gates the first paint; later reloads must not unmount the bind form.
  const busy = installs.loading || repo.loading || env.loading || ready.loading;
  const [settled, setSettled] = useState(false);
  useEffect(() => { if (!busy) setSettled(true); }, [busy]);
  const loading = !settled;
  const blockers = [
    !linked && 'Connect GitHub',
    !bound && 'Bind a repository',
    r && !r.ai.configured && 'Configure an AI model',
    r && !r.sandboxConfigured && 'Configure the analysis sandbox',
  ].filter(Boolean) as string[];
  const canRun = canEdit && !loading && blockers.length === 0 && !active && !run.pending;

  const openAnalysis = (id: string) => navigate(`${base}/projects/${tenantId}/analyses?analysis=${id}`);
  const start = () =>
    run.go(async () => {
      try {
        const a = await api<AnalysisSummary>(`${path}/analyses`, { method: 'POST', idempotencyKey: idem });
        setIdem(newIdempotencyKey());
        openAnalysis(a.id);
      } catch (e) {
        // Someone else started one in the meantime: show it instead of failing.
        if (e instanceof ApiError && e.status === 409) ready.reload();
        throw e;
      }
    });

  const e = env.data;
  return (
    <Section title="Generate a policy"
      desc="Tessera reads your code from GitHub, adds what the environment scan found, and proposes an endpoint policy for you to review and edit."
      aside={loading ? undefined : <Badge status={blockers.length === 0 ? 'passed' : 'review'}>{blockers.length === 0 ? 'Ready' : 'Setup needed'}</Badge>}>
      {loading && <Loading what="setup" />}
      {[installs.error, repo.error, ready.error].map((m, i) => m && <Note key={i} tone="error">{m}</Note>)}
      {!loading && (
        <div className="stack">
          <ul className="list">
            <Step n={1} title="GitHub" tone={linked ? 'passed' : 'review'} state={linked ? `Connected · ${installs.data!.map((i) => i.accountLogin).join(', ')}` : 'Not connected'}>
              {!linked && (
                <span className="actions">
                  <ConnectGitHubButton tenantId={tenantId} />
                  <span className="faint small">Installs the read-only GitHub App on your account or organization.</span>
                </span>
              )}
              {linked > 0 && canEdit && <span><ConnectGitHubButton tenantId={tenantId} variant="outline" /></span>}
            </Step>

            <Step n={2} title="Repository" tone={bound ? 'passed' : 'review'} state={bound ? 'Bound' : 'Not bound'}>
              {linked > 0 || bound
                ? <Repository path={path} bare onChange={repo.reload} />
                : <span className="faint small">Connect GitHub first, then choose the repository this project protects.</span>}
            </Step>

            <Step n={3} title="Environment snapshot" tone={e?.available ? 'passed' : 'neutral'}
              state={e?.available ? `Collected ${e.ageHours === 0 ? 'less than an hour' : `${e.ageHours} h`} ago` : 'Not collected'}>
              {e?.available && e.latest ? (
                <span className="small muted">
                  Used by the analysis: {e.latest.counts.openPorts} open ports, {e.latest.counts.vulnerabilities} vulnerable packages, {e.latest.counts.nucleiFindings} scanner findings.
                  {Object.values(e.latest.toolStatus).some((s) => s !== 'ok') && ` Some tools did not complete (${Object.entries(e.latest.toolStatus).filter(([, s]) => s !== 'ok').map(([t]) => t).join(', ')}).`}
                </span>
              ) : (
                <span className="small muted">
                  Optional, but without it the policy is based on code alone. {e?.notice ?? 'Run `tessera -get-environment` where the application runs.'}
                </span>
              )}
            </Step>

            <Step n={4} title="AI model" tone={r?.ai.configured ? 'passed' : 'blocked'}
              state={r?.ai.configured ? `${r.ai.model}${r.ai.mode === 'local' ? ' · local' : ''}` : 'Not configured'}>
              {r && !r.ai.configured && <span className="small muted">The model is set in the control plane&apos;s environment (<span className="mono">ANTHROPIC_API_KEY</span> or <span className="mono">ANALYSIS_AI_BASE_URL</span>), not in the dashboard.</span>}
              {r && r.ai.configured && !r.sandboxConfigured && <span className="small muted">The analysis sandbox is not configured (<span className="mono">ANALYSIS_SANDBOX</span>), so source cannot be read.</span>}
            </Step>
          </ul>

          {active ? (
            <div className="spread">
              <span className="small">An analysis is in progress <AnalysisBadge status={active.status} /></span>
              <Button iconRight="arrow-right" onClick={() => openAnalysis(active.id)}>
                {active.status === 'awaiting_budget' ? 'Approve budget' : 'Open analysis'}
              </Button>
            </div>
          ) : (
            <div className="spread">
              <span className="faint small">
                {blockers.length > 0 ? `Before you can start: ${blockers.join(', ').toLowerCase()}.` : <><Icon name="info" size={12} /> Reads the latest commit of the default branch. You approve the AI budget before anything is spent.</>}
              </span>
              {canEdit && <Button iconLeft="zap" disabled={!canRun} onClick={() => void start()}>{run.pending ? 'Starting…' : 'Generate policy'}</Button>}
            </div>
          )}
          {run.error && <Note tone="error">{run.error}</Note>}
        </div>
      )}
    </Section>
  );
}
