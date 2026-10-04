import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useApi, useResource, type Analysis, type CompiledEndpoint, type EndpointPolicyVersion, type ToolRegistry } from '../../api';
import { Button, Card, Dialog, Tooltip } from '../../components';
import { useOrg } from '../../Layout';
import {
  diffPolicy, draftReducer, endpointKey, findTarget, initDraft, loadDraft, parseTargetId, storeDraft, targetId, validateDraft, type Target,
} from '../../policy/draft';
import { Loading, newIdempotencyKey, Note, PolicyBadge, Section, short, useAction, when } from '../../ui';
import { ApproveDialog } from './ApproveDialog';
import { EditorContext, type EditorCtx } from './context';
import { EndpointList } from './EndpointList';
import { EndpointPanel } from './EndpointPanel';
import { SaveDialog } from './SaveDialog';
import { ScopePolicies } from './ScopePolicies';

/**
 * Review and edit a `tessera.policy/v2` or `v3` version. View mode is the default;
 * editing works on a local draft that is saved as one new pending version, so
 * the version shown here never changes.
 */
export function PolicyEditor({ p, path, tenantId, reload, onOpenVersion, endpoint, onEndpoint }: {
  p: EndpointPolicyVersion; path: string; tenantId: string; reload: () => void;
  onOpenVersion: (version: string) => void;
  endpoint: string | null; onEndpoint: (key: string) => void;
}) {
  const { canEdit } = useOrg();
  const api = useApi();
  const run = useAction();
  const registry = useResource<ToolRegistry>(`/tool-registries/${p.toolRegistryVersion}`);
  const analysisId = p.origin.analysisId;
  const analysis = useResource<Analysis>(analysisId ? `${path}/analyses/${analysisId}` : null);

  const [editing, setEditing] = useState(false);
  const [draft, dispatch] = useReducer(draftReducer, p.structuredPolicy, initDraft);
  const [dialog, setDialog] = useState<'save' | 'approve' | 'reject' | 'activate' | 'discard' | null>(null);
  // One key per lifecycle action on this version: a retry reuses it.
  const [idem] = useState(() => ({ approve: newIdempotencyKey(), reject: newIdempotencyKey(), activate: newIdempotencyKey() }));
  const [storedDraft] = useState(() => (canEdit ? loadDraft(tenantId, p.version, p.structuredPolicy) : null));

  useEffect(() => { if (editing) storeDraft(tenantId, p.version, draft); }, [editing, draft, tenantId, p.version]);

  const tools = registry.data?.tools ?? [];
  const toolMap = useMemo(() => new Map(tools.map((t) => [t.id, t])), [tools]);
  const facts = useMemo(() => new Map((analysis.data?.results?.endpoints ?? []).map((e) => [endpointKey(e), e])), [analysis.data]);
  const policy = editing ? draft.policy : p.structuredPolicy;
  const changes = useMemo(() => (editing ? diffPolicy(draft.base, draft.policy) : []), [editing, draft]);
  const problems = useMemo(() => (editing && tools.length ? validateDraft(draft.policy, tools) : []), [editing, draft, tools]);
  const selected = policy.endpoints.find((e) => endpointKey(e) === endpoint) ?? policy.endpoints[0];

  const compile = useCallback(async (t: Target): Promise<CompiledEndpoint | null> => {
    const found = findTarget(draft.policy, t);
    if (!found) return null;
    // The plain-language compiler only takes v2 endpoints and is still a
    // placeholder that returns the checks unchanged; v3 gets the same result locally.
    if (p.schemaVersion === 'tessera.policy/v3') {
      return {
        endpoint: found.endpoint,
        limitations: ['The plain-language compiler is not available yet, so the checks were not regenerated from your text. Adjust the checks yourself so they match it.'],
        mock: true,
      };
    }
    let result: CompiledEndpoint | null = null;
    await run.go(async () => {
      result = await api<CompiledEndpoint>(`${path}/policies/v2/compile`, {
        method: 'POST',
        body: {
          parentVersion: p.version,
          endpoint: found.endpoint,
          target: found.field ? { kind: 'field', location: found.field.location, name: found.field.name } : { kind: 'endpoint' },
        },
      });
    });
    return result;
  }, [api, draft.policy, p.schemaVersion, p.version, path, run]);

  const ctx: EditorCtx = {
    tools, tool: (id) => toolMap.get(id), editing, dispatch, facts, compile,
    draft: editing ? draft : { base: p.structuredPolicy, policy: p.structuredPolicy, uncompiled: [], staleText: [] },
    warnings: (t) => p.reviewWarnings.filter((w) => w.endpoint === t.endpoint && w.field === t.field),
  };

  const startEditing = (resume: boolean) => {
    dispatch(resume && storedDraft ? { type: 'restore', state: storedDraft } : { type: 'reset', base: p.structuredPolicy });
    setEditing(true);
  };
  const stopEditing = () => { storeDraft(tenantId, p.version, null); dispatch({ type: 'reset', base: p.structuredPolicy }); setEditing(false); setDialog(null); };

  const jumpTo = (id: string) => {
    onEndpoint(parseTargetId(id).endpoint);
    setTimeout(() => document.getElementById(`target-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  const lifecycle = (action: 'approve' | 'reject' | 'activate', body?: unknown) =>
    run.go(() => api(`${path}/policies/${encodeURIComponent(p.version)}/${action}`, { method: 'POST', idempotencyKey: idem[action], body }),
      { approve: 'Policy approved', reject: 'Policy rejected', activate: 'Policy activated' }[action])
      .then((ok) => { if (ok) { setDialog(null); reload(); } });

  const upgrade = async () => {
    let upgraded: { version: string } | undefined;
    const ok = await run.go(async () => { upgraded = await api<{ version: string }>(`${path}/policies/${encodeURIComponent(p.version)}/upgrade-v3`, { method: 'POST' }); },
      'Draft created. Review and approve it, then activate.');
    if (ok && upgraded) onOpenVersion(upgraded.version);
  };

  const parentVersion = p.origin.kind === 'draft' ? p.origin.parentVersion : null;
  const attention = [...new Set([...draft.uncompiled, ...draft.staleText])];
  const uncompiled = editing ? draft.uncompiled.length : 0;
  const canSave = changes.length > 0 && uncompiled === 0 && problems.length === 0;
  const endpointsChanged = new Set(changes.map((c) => c.endpoint)).size;

  return (
    <EditorContext.Provider value={ctx}>
      <div className="stack" style={{ gap: 'var(--space-5)' }}>
        <Section title={`Version ${p.version.slice(0, 12)}…`} aside={<PolicyBadge state={p.state} />}
          desc={<>
            {p.origin.kind === 'analysis'
              ? <>Proposed by an analysis{p.origin.aiModel && ` with ${p.origin.aiModel}`}</>
              : <>Edited from <button type="button" className="linklike mono" onClick={() => parentVersion && onOpenVersion(parentVersion)}>{parentVersion?.slice(0, 12)}…</button> · {p.origin.changedEndpoints.length} endpoint{p.origin.changedEndpoints.length === 1 ? '' : 's'} changed</>}
            {' '}· {when(p.createdAt)} by <span className="mono">{p.createdBy}</span> · {p.structuredPolicy.endpoints.length} endpoints
          </>}>
          <div className="stack">
            {p.compilationStatus === 'failed' && (
              <Note tone="error">
                This version did not compile and cannot be approved.
                <ul className="mono small" style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-5)' }}>{p.compilationIssues.map((i) => <li key={i}>{i}</li>)}</ul>
              </Note>
            )}
            {p.rejectionReason && <Note>Rejected: {p.rejectionReason}</Note>}
            {p.approvalSource === 'auto_apply' && <Note tone="info">Approved automatically: “apply automatically” was chosen before the analysis ran, and nothing in this version needed review.</Note>}
            {p.precisionWarning && !editing && <p className="faint small" style={{ margin: 0 }}>{p.precisionWarning}</p>}
            {editing && (
              <Note tone="info">
                {p.state === 'PENDING_APPROVAL'
                  ? 'You are editing a draft. Saving creates a new pending version; this one stays as it is.'
                  : `You are drafting a new version from this one. ${p.state === 'ACTIVE' ? 'The active version keeps running until the new one is approved and activated.' : 'This version stays as it is.'}`}
              </Note>
            )}
            {!editing && storedDraft && canEdit && (
              <Note tone="info">
                You have unsaved changes to this version from an earlier session.{' '}
                <Button size="sm" variant="outline" onClick={() => startEditing(true)}>Continue editing</Button>
              </Note>
            )}
            {registry.error && <Note tone="error">Tool registry unavailable: {registry.error}. Checks are shown by id.</Note>}

            {canEdit && !editing && (
              <div className="actions" style={{ justifyContent: 'flex-end' }}>
                {p.compilationStatus === 'compiled' && <Button variant="outline" iconLeft="sliders-horizontal" onClick={() => startEditing(false)}>Edit policy</Button>}
                {p.state === 'PENDING_APPROVAL' && <>
                  <Button variant="outline" onClick={() => setDialog('reject')}>Reject</Button>
                  <Button onClick={() => setDialog('approve')}>Review and approve</Button>
                </>}
                {p.state === 'APPROVED' && (p.activatable
                  ? <Button iconRight="arrow-right" onClick={() => setDialog('activate')}>Activate</Button>
                  : <Tooltip label="tessera.policy/v2 cannot be distributed. Upgrading drafts a tessera.policy/v3 version for review; tools that need a configuration v2 does not carry are dropped and listed.">
                    <span><Button iconLeft="layers" disabled={run.pending} onClick={() => void upgrade()}>Upgrade to v3</Button></span>
                  </Tooltip>)}
              </div>
            )}
          </div>
        </Section>

        {p.schemaVersion === 'tessera.policy/v3' && <ScopePolicies policy={p.structuredPolicy} warnings={p.reviewWarnings} />}

        <Card aria-label="Endpoint policies">
          {!registry.data && !registry.error ? <Loading what="tool registry" /> : (
            <div className="pe-layout">
              <EndpointList policy={policy} changes={changes} selected={selected ? endpointKey(selected) : ''} onSelect={onEndpoint} />
              {selected
                ? <EndpointPanel key={`${endpointKey(selected)}:${editing}`} endpoint={selected} changes={changes.filter((c) => c.endpoint === endpointKey(selected))} />
                : <p className="muted small">This version has no endpoints.</p>}
            </div>
          )}
        </Card>

        {editing && (
          <div className="pe-bar" role="region" aria-label="Draft">
            <span className="small">
              {changes.length === 0 ? 'No changes yet.' : <><strong>{changes.length}</strong> change{changes.length === 1 ? '' : 's'} in {endpointsChanged} endpoint{endpointsChanged === 1 ? '' : 's'}</>}
              {attention[0] && <> · <button type="button" className="linklike" onClick={() => jumpTo(attention[0]!)}>{attention.length} need{attention.length === 1 ? 's' : ''} attention</button></>}
              {problems[0] && <> · <button type="button" className="linklike" style={{ color: 'var(--clay-600)' }} onClick={() => jumpTo(targetId(problems[0]!.target))}>{problems[0].message}{problems.length > 1 && ` (+${problems.length - 1})`}</button></>}
            </span>
            <span className="actions">
              <Button variant="ghost" onClick={() => (changes.length ? setDialog('discard') : stopEditing())}>{changes.length ? 'Discard draft' : 'Cancel'}</Button>
              <Tooltip label={uncompiled ? 'Update the checks from your edited text first.' : problems.length ? 'Fix the problems first.' : changes.length ? 'Review the changes and save them as a new version.' : 'Make a change first.'}>
                <span><Button disabled={!canSave} onClick={() => setDialog('save')}>Review and save</Button></span>
              </Tooltip>
            </span>
          </div>
        )}
      </div>

      {dialog === 'save' && (
        <SaveDialog path={path} parent={p} policy={draft.policy} changes={changes} onClose={() => setDialog(null)}
          onSaved={(v) => { stopEditing(); reload(); onOpenVersion(v); }} />
      )}
      {(dialog === 'approve' || dialog === 'reject') && (
        <ApproveDialog p={p} mode={dialog} pending={run.pending} onClose={() => setDialog(null)}
          onConfirm={(reason) => void lifecycle(dialog, dialog === 'reject' ? { reason } : undefined)} />
      )}
      <Dialog open={dialog === 'activate'} title={`Activate ${p.version.slice(0, 12)}…?`} onClose={() => setDialog(null)}
        description="Tessera builds one signed bundle from this policy and the current runtime configuration, and selects it for distribution. Proxies apply it when an operator runs `tessera fetch`."
        actions={<>
          <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
          <Button disabled={run.pending} onClick={() => void lifecycle('activate')}>Activate</Button>
        </>} />
      <Dialog open={dialog === 'discard'} title="Discard this draft?" onClose={() => setDialog(null)}
        description={`${changes.length} unsaved change${changes.length === 1 ? '' : 's'} will be lost.`}
        actions={<>
          <Button variant="ghost" onClick={() => setDialog(null)}>Keep editing</Button>
          <Button variant="danger" onClick={stopEditing}>Discard</Button>
        </>} />
      {analysis.error && analysisId && <span className="faint small">Analysis facts unavailable ({short(analysisId)}): {analysis.error}</span>}
    </EditorContext.Provider>
  );
}
