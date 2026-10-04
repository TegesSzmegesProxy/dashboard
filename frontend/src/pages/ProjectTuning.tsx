import { useState, type ReactNode } from 'react';
import { useApi, useProposed, type EndpointOverride, type EndpointOverridesView, type FieldRule, type HttpMethod, type ModelSettings, type ModelSettingsView, type PolicyAction, type PolicyDefaultsView } from '../api';
import { Badge, Button, IconButton, Input, Select } from '../components';
import { useOrg } from '../Layout';
import { Loading, Note, ProposedNote, Section, Slider, useAction } from '../ui';

// Saving here changes no policy version or bundle (ADR-0011).
// Nothing is pre-filled: unset values stay unset until the operator chooses them.

const ACTIONS: { value: PolicyAction; label: string }[] = [
  { value: 'allow', label: 'Allow' }, { value: 'review', label: 'Flag for review' }, { value: 'block', label: 'Block' },
];
const RULES: { value: FieldRule; label: string }[] = [
  { value: 'allow', label: 'Allow' }, { value: 'require', label: 'Require' }, { value: 'mask', label: 'Mask' },
  { value: 'review', label: 'Flag for review' }, { value: 'block', label: 'Block' },
];
const METHODS: HttpMethod[] = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'];
const area = { className: 'textarea sans', style: { minHeight: 56 } } as const;

/** Loads a proposed resource and hands the editor `null` when it is unset or missing. */
function Proposed<T>({ path, title, desc, children }: { path: string; title: string; desc: string; children: (data: T | null, reload: () => void) => ReactNode }) {
  const r = useProposed<T>(path);
  const { canEdit } = useOrg();
  return (
    <Section title={title} desc={desc} aside={r.status === 'missing' ? <Badge status="review">Endpoint pending</Badge> : undefined}>
      <div className="stack">
        {r.status === 'missing' && <ProposedNote routes={[`GET ${path}`, `PUT ${path}`]} />}
        {r.status === 'error' && <Note tone="error">{r.error}</Note>}
        {r.status === 'loading' ? <Loading what={title.toLowerCase()} /> : (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={!canEdit}>{children(r.data, r.reload)}</fieldset>
        )}
      </div>
    </Section>
  );
}

function SaveBar({ onSave, pending, valid }: { onSave: () => void; pending: boolean; valid: boolean }) {
  const { canEdit } = useOrg();
  if (!canEdit) return null;
  return <div className="actions" style={{ justifyContent: 'flex-end' }}><Button disabled={!valid || pending} onClick={onSave}>Save</Button></div>;
}

export function ProjectTuning({ path }: { path: string }) {
  return (
    <div className="stack" style={{ gap: 'var(--space-5)' }}>
      <ModelEditor path={`${path}/model-settings`} />
      <DefaultsEditor path={`${path}/policy-defaults`} />
      <OverridesEditor path={`${path}/endpoint-overrides`} />
    </div>
  );
}

function ModelEditor({ path }: { path: string }) {
  return (
    <Proposed<ModelSettingsView> path={path} title="Model context and sampling" desc="How much request history is given to the model as context, and how its output is generated.">
      {(d, reload) => <ModelForm path={path} d={d} reload={reload} />}
    </Proposed>
  );
}

function ModelForm({ path, d, reload }: { path: string; d: ModelSettingsView | null; reload: () => void }) {
  const api = useApi();
  const run = useAction();
  const [ctx, setCtx] = useState<number | null>(d?.contextLength ?? null);
  const [temp, setTemp] = useState<number | null>(d?.temperature ?? null);
  const [topP, setTopP] = useState<number | null>(d?.topP ?? null);
  const [max, setMax] = useState(d?.maxTokens != null ? String(d.maxTokens) : '');
  const maxN = Number(max);
  const maxOk = Number.isInteger(maxN) && maxN >= 1;
  const valid = ctx !== null && temp !== null && topP !== null && maxOk;
  return (
    <div className="stack">
      <Slider label="Context length (last x requests)" min={1} max={100} step={1} value={ctx} onChange={setCtx} />
      <div className="grid-3">
        <Slider label="Temperature" hint="0 – 2" min={0} max={2} step={0.1} digits={1} value={temp} onChange={setTemp} />
        <Slider label="Top-P" hint="0 – 1" min={0} max={1} step={0.05} digits={2} value={topP} onChange={setTopP} />
        <Input label="Max tokens" type="number" mono placeholder="≥ 1" value={max} error={max !== '' && !maxOk ? 'Whole number ≥ 1' : undefined} hint="Per response" onChange={(e) => setMax(e.target.value)} />
      </div>
      <SaveBar valid={valid} pending={run.pending}
        onSave={() => valid && void run.go(() => api(path, { method: 'PUT', body: { contextLength: ctx, temperature: temp, topP, maxTokens: maxN } satisfies ModelSettings }), 'Model settings saved').then((ok) => ok && reload())} />
    </div>
  );
}

function DefaultsEditor({ path }: { path: string }) {
  return (
    <Proposed<PolicyDefaultsView> path={path} title="Global policies and thresholds" desc="Defaults applied to every endpoint unless overridden below.">
      {(d, reload) => <DefaultsForm path={path} d={d} reload={reload} />}
    </Proposed>
  );
}

function DefaultsForm({ path, d, reload }: { path: string; d: PolicyDefaultsView | null; reload: () => void }) {
  const api = useApi();
  const run = useAction();
  const [action, setAction] = useState<PolicyAction | ''>(d?.defaultAction ?? '');
  const [constraints, setConstraints] = useState(d?.customConstraints ?? '');
  const [threshold, setThreshold] = useState<number | null>(d?.threshold ?? null);
  const valid = action !== '' && threshold !== null;
  return (
    <div className="stack">
      <div className="grid-2">
        <div className="stack">
          <Select label="Default policy" value={action} onChange={(e) => setAction(e.target.value as PolicyAction)}
            options={[{ value: '', label: 'Choose explicitly' }, ...ACTIONS]} />
          <label className="stack" style={{ gap: 'var(--space-2)' }}>
            <span className="small" style={{ fontWeight: 500, color: 'var(--text-strong)' }}>Custom constraints</span>
            <textarea {...area} maxLength={2000} placeholder="e.g. Never expose payment card numbers." value={constraints} onChange={(e) => setConstraints(e.target.value)} />
          </label>
        </div>
        <Slider label="Global threshold" hint="Score at which a policy is triggered." min={0} max={1} step={0.01} digits={2} value={threshold} onChange={setThreshold} />
      </div>
      <SaveBar valid={valid} pending={run.pending}
        onSave={() => valid && void run.go(() => api(path, { method: 'PUT', body: { defaultAction: action, customConstraints: constraints, threshold } }), 'Defaults saved').then((ok) => ok && reload())} />
    </div>
  );
}

function OverridesEditor({ path }: { path: string }) {
  return (
    <Proposed<EndpointOverridesView> path={path} title="Endpoint-specific management" desc="Override the policy and threshold per endpoint, per request and per field.">
      {(d, reload) => <OverridesForm path={path} initial={d?.endpoints ?? []} reload={reload} />}
    </Proposed>
  );
}

const blankEndpoint = (): EndpointOverride => ({ method: 'GET', path: '', requestPolicy: null, threshold: null, fields: [] });

function OverridesForm({ path, initial, reload }: { path: string; initial: EndpointOverride[]; reload: () => void }) {
  const api = useApi();
  const run = useAction();
  const [eps, setEps] = useState(initial);
  const patch = (i: number, p: Partial<EndpointOverride>) => setEps((l) => l.map((e, j) => (j === i ? { ...e, ...p } : e)));
  const valid = eps.every((e) => /^\/\S*$/.test(e.path) && e.fields.every((f) => f.name.trim()));

  return (
    <div className="stack">
      {eps.length === 0 && <p className="muted small">No endpoint overrides. Every endpoint uses the global defaults.</p>}
      {eps.map((e, i) => (
        <article key={i} className="endpoint" style={{ marginBottom: 0 }}>
          <header>
            <span className="actions">
              <select aria-label="Method" className="mono" value={e.method} onChange={(ev) => patch(i, { method: ev.target.value as HttpMethod })}>
                {METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
              <Input aria-label="Path" mono placeholder="/v1/checkout" value={e.path} error={e.path && !/^\/\S*$/.test(e.path) ? 'Starts with /' : undefined} onChange={(ev) => patch(i, { path: ev.target.value })} />
            </span>
            <span className="actions">
              <Badge status={e.requestPolicy || e.threshold !== null || e.fields.length ? 'jev' : 'neutral'}>{e.requestPolicy || e.threshold !== null || e.fields.length ? 'Overrides active' : 'Uses global'}</Badge>
              <IconButton icon="x" label="Remove endpoint" onClick={() => setEps((l) => l.filter((_, j) => j !== i))} />
            </span>
          </header>
          <div className="stack" style={{ padding: 'var(--space-3)' }}>
            <div className="grid-2">
              <Select label="Request-level policy" value={e.requestPolicy ?? ''} onChange={(ev) => patch(i, { requestPolicy: (ev.target.value || null) as PolicyAction | null })}
                options={[{ value: '', label: 'Use global default' }, ...ACTIONS]} />
              <div className="stack" style={{ gap: 'var(--space-1)' }}>
                <Slider label="Endpoint threshold" min={0} max={1} step={0.01} digits={2} value={e.threshold} onChange={(n) => patch(i, { threshold: n })} />
                {e.threshold !== null && <Button variant="ghost" size="sm" onClick={() => patch(i, { threshold: null })}>Use global threshold</Button>}
              </div>
            </div>
            {e.fields.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Field</th><th>Policy rule</th><th>Custom constraints</th><th /></tr></thead>
                  <tbody>
                    {e.fields.map((f, k) => {
                      const setF = (p: Partial<typeof f>) => patch(i, { fields: e.fields.map((x, j) => (j === k ? { ...x, ...p } : x)) });
                      return (
                        <tr key={k}>
                          <td><Input aria-label="Field name" mono placeholder="card_number" value={f.name} onChange={(ev) => setF({ name: ev.target.value })} /></td>
                          <td><Select aria-label={`Rule for ${f.name || 'field'}`} value={f.rule} onChange={(ev) => setF({ rule: ev.target.value as FieldRule })} options={RULES} /></td>
                          <td><textarea {...area} aria-label={`Constraints for ${f.name || 'field'}`} maxLength={2000} placeholder="Optional constraints" value={f.constraints} onChange={(ev) => setF({ constraints: ev.target.value })} /></td>
                          <td><IconButton icon="minus" label="Remove field" onClick={() => patch(i, { fields: e.fields.filter((_, j) => j !== k) })} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div><Button variant="outline" size="sm" iconLeft="plus" onClick={() => patch(i, { fields: [...e.fields, { name: '', rule: 'allow', constraints: '' }] })}>Add field</Button></div>
          </div>
        </article>
      ))}
      <div className="spread">
        <Button variant="outline" size="sm" iconLeft="plus" onClick={() => setEps((l) => [...l, blankEndpoint()])}>Add endpoint</Button>
        <SaveBar valid={valid} pending={run.pending}
          onSave={() => valid && void run.go(() => api(path, { method: 'PUT', body: { endpoints: eps } }), 'Endpoint overrides saved').then((ok) => ok && reload())} />
      </div>
    </div>
  );
}
