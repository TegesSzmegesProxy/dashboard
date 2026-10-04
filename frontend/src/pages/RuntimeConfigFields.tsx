import type { Behavior, Project, RuntimeConfiguration } from '../api';
import { Input, Radio } from '../components';

/** String-typed form state; nothing is pre-filled (ADR-0002: no invented defaults). */
export interface RuntimeDraft {
  upstreamUrl: string;
  failureBehavior: Behavior | '';
  unknownEndpointBehavior: Behavior | '';
  pathPrefix: string;
  requestTimeoutMs: string;
  maxRequestBodyBytes: string;
  samplingRate: string;
  minN: string;
  maxN: string;
  attackProbabilityThreshold: string;
  attackProbabilityFloor: string;
  jevLocked: 'locked' | 'adaptive' | '';
  onStaticAnalysisError: Behavior | '';
  onSuspiciousJevUnavailable: Behavior | '';
  onSampledJevUnavailable: Behavior | '';
}

export const emptyRuntime: RuntimeDraft = {
  upstreamUrl: '', failureBehavior: '', unknownEndpointBehavior: '', pathPrefix: '',
  requestTimeoutMs: '', maxRequestBodyBytes: '', samplingRate: '',
  minN: '', maxN: '', attackProbabilityThreshold: '', attackProbabilityFloor: '', jevLocked: '',
  onStaticAnalysisError: '', onSuspiciousJevUnavailable: '', onSampledJevUnavailable: '',
};

/** Projects created before ADR-0012 lack decision settings; those fields start empty. */
export const toDraft = (c: Project['runtimeConfiguration']): RuntimeDraft => ({
  upstreamUrl: c.upstreamUrl,
  failureBehavior: c.failureBehavior,
  unknownEndpointBehavior: c.unknownEndpointBehavior,
  pathPrefix: c.routing.pathPrefix,
  requestTimeoutMs: String(c.thresholds.requestTimeoutMs),
  maxRequestBodyBytes: String(c.thresholds.maxRequestBodyBytes),
  samplingRate: String(c.samplingRate),
  minN: c.decision ? String(c.decision.sampling.minN) : '',
  maxN: c.decision ? String(c.decision.sampling.maxN) : '',
  attackProbabilityThreshold: c.decision ? String(c.decision.jev.attackProbabilityThreshold) : '',
  attackProbabilityFloor: c.decision ? String(c.decision.jev.attackProbabilityFloor) : '',
  jevLocked: c.decision ? (c.decision.jev.locked ? 'locked' : 'adaptive') : '',
  onStaticAnalysisError: c.decision?.onStaticAnalysisError ?? '',
  onSuspiciousJevUnavailable: c.decision?.onSuspiciousJevUnavailable ?? '',
  onSampledJevUnavailable: c.decision?.onSampledJevUnavailable ?? '',
});

/** Mirrors backend DTO bounds so mistakes show inline; the backend re-validates. */
export function validateRuntime(d: RuntimeDraft): { errors: Partial<Record<keyof RuntimeDraft, string>>; value?: RuntimeConfiguration } {
  const e: Partial<Record<keyof RuntimeDraft, string>> = {};
  const int = (k: keyof RuntimeDraft, min: number, max: number) => {
    const n = Number(d[k]);
    if (d[k] === '' || !Number.isInteger(n) || n < min || n > max) e[k] = `Whole number ${min}–${max}`;
    return n;
  };
  if (!/^https?:\/\/\S+$/.test(d.upstreamUrl)) e.upstreamUrl = 'http(s) URL required';
  if (!d.failureBehavior) e.failureBehavior = 'Choose explicitly';
  if (!d.unknownEndpointBehavior) e.unknownEndpointBehavior = 'Choose explicitly';
  if (!/^\/[^?#]*$/.test(d.pathPrefix)) e.pathPrefix = 'Starts with /, no query or fragment';
  const requestTimeoutMs = int('requestTimeoutMs', 100, 120000);
  const maxRequestBodyBytes = int('maxRequestBodyBytes', 0, 104857600);
  const probability = (k: keyof RuntimeDraft) => {
    const n = Number(d[k]);
    if (d[k] === '' || !(n >= 0 && n <= 1)) e[k] = '0–1';
    return n;
  };
  const samplingRate = probability('samplingRate');
  const minN = probability('minN');
  const maxN = probability('maxN');
  const attackProbabilityThreshold = probability('attackProbabilityThreshold');
  const attackProbabilityFloor = probability('attackProbabilityFloor');
  // Cross-field rules match the backend and the proxy's bundle v2 schema.
  if (!e.samplingRate && !e.minN && !e.maxN) {
    if (minN > samplingRate || samplingRate > maxN) e.samplingRate = 'Must lie within min–max N';
    else if (minN === 0 && (samplingRate !== 0 || maxN !== 0)) e.minN = 'Min N 0 requires rate and max N 0';
  }
  if (!e.attackProbabilityThreshold && !e.attackProbabilityFloor && attackProbabilityFloor > attackProbabilityThreshold) {
    e.attackProbabilityFloor = 'May not exceed threshold';
  }
  if (!d.jevLocked) e.jevLocked = 'Choose explicitly';
  if (!d.onStaticAnalysisError) e.onStaticAnalysisError = 'Choose explicitly';
  if (!d.onSuspiciousJevUnavailable) e.onSuspiciousJevUnavailable = 'Choose explicitly';
  if (!d.onSampledJevUnavailable) e.onSampledJevUnavailable = 'Choose explicitly';
  if (
    Object.keys(e).length || !d.failureBehavior || !d.unknownEndpointBehavior ||
    !d.onStaticAnalysisError || !d.onSuspiciousJevUnavailable || !d.onSampledJevUnavailable
  ) return { errors: e };
  return {
    errors: e,
    value: {
      upstreamUrl: d.upstreamUrl,
      failureBehavior: d.failureBehavior,
      unknownEndpointBehavior: d.unknownEndpointBehavior,
      routing: { pathPrefix: d.pathPrefix },
      thresholds: { requestTimeoutMs, maxRequestBodyBytes },
      samplingRate,
      decision: {
        sampling: { minN, maxN },
        jev: { attackProbabilityThreshold, attackProbabilityFloor, locked: d.jevLocked === 'locked' },
        onStaticAnalysisError: d.onStaticAnalysisError,
        onSuspiciousJevUnavailable: d.onSuspiciousJevUnavailable,
        onSampledJevUnavailable: d.onSampledJevUnavailable,
      },
    },
  };
}

function BehaviorChoice(props: { name: string; label: string; hint: string; value: Behavior | ''; error?: string; disabled?: boolean; onChange: (v: Behavior) => void }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={props.disabled}>
      <legend style={{ fontSize: 'var(--fs-small)', fontWeight: 500, color: 'var(--text-strong)', marginBottom: 'var(--space-2)' }}>{props.label}</legend>
      <div className="actions" style={{ gap: 'var(--space-5)' }}>
        <Radio name={props.name} value="allow" label="Allow" checked={props.value === 'allow'} onChange={() => props.onChange('allow')} />
        <Radio name={props.name} value="block" label="Block" checked={props.value === 'block'} onChange={() => props.onChange('block')} />
      </div>
      <p className="small" style={{ margin: 'var(--space-1) 0 0', color: props.error ? 'var(--clay-600)' : 'var(--text-muted)' }}>{props.error ?? props.hint}</p>
    </fieldset>
  );
}

export function RuntimeConfigFields({ draft, set, errors, disabled }: {
  draft: RuntimeDraft;
  set: (d: RuntimeDraft) => void;
  errors: Partial<Record<keyof RuntimeDraft, string>>;
  disabled?: boolean;
}) {
  const f = (k: keyof RuntimeDraft) => ({
    value: draft[k],
    error: errors[k],
    disabled,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ ...draft, [k]: e.target.value }),
  });
  return (
    <div className="stack">
      <div className="grid-2">
        <Input label="Upstream URL" mono placeholder="https://app.internal.example" {...f('upstreamUrl')} hint="Where the proxy forwards admitted requests." />
        <Input label="Path prefix" mono placeholder="/" {...f('pathPrefix')} />
      </div>
      <div className="grid-2">
        <BehaviorChoice name="failureBehavior" label="Failure behavior" value={draft.failureBehavior} error={errors.failureBehavior} disabled={disabled}
          hint="When the proxy has neither a valid bundle nor a last known good one."
          onChange={(v) => set({ ...draft, failureBehavior: v })} />
        <BehaviorChoice name="unknownEndpointBehavior" label="Unknown endpoints" value={draft.unknownEndpointBehavior} error={errors.unknownEndpointBehavior} disabled={disabled}
          hint="Requests to routes the active policy does not describe."
          onChange={(v) => set({ ...draft, unknownEndpointBehavior: v })} />
      </div>
      <div className="grid-3">
        <Input label="Request timeout" type="number" suffix="ms" mono placeholder="100–120000" {...f('requestTimeoutMs')} />
        <Input label="Max request body" type="number" suffix="bytes" mono placeholder="0–104857600" {...f('maxRequestBodyBytes')} />
        <Input label="Sampling rate" type="number" step="0.01" mono placeholder="0–1" {...f('samplingRate')} hint="Initial share of safe requests sent to JEV." />
      </div>
      <div className="grid-2">
        <Input label="Min sampling N" type="number" step="0.01" mono placeholder="0–1" {...f('minN')} hint="Lower bound for adaptive sampling." />
        <Input label="Max sampling N" type="number" step="0.01" mono placeholder="0–1" {...f('maxN')} hint="Upper bound for adaptive sampling." />
      </div>
      <div className="grid-3">
        <Input label="JEV attack threshold" type="number" step="0.01" mono placeholder="0–1" {...f('attackProbabilityThreshold')} hint="Attack probability above this blocks." />
        <Input label="JEV threshold floor" type="number" step="0.01" mono placeholder="0–1" {...f('attackProbabilityFloor')} hint="Lowest the threshold may tighten to." />
        <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={disabled}>
          <legend style={{ fontSize: 'var(--fs-small)', fontWeight: 500, color: 'var(--text-strong)', marginBottom: 'var(--space-2)' }}>JEV threshold</legend>
          <div className="actions" style={{ gap: 'var(--space-5)' }}>
            <Radio name="jevLocked" value="adaptive" label="Adaptive" checked={draft.jevLocked === 'adaptive'} onChange={() => set({ ...draft, jevLocked: 'adaptive' })} />
            <Radio name="jevLocked" value="locked" label="Locked" checked={draft.jevLocked === 'locked'} onChange={() => set({ ...draft, jevLocked: 'locked' })} />
          </div>
          <p className="small" style={{ margin: 'var(--space-1) 0 0', color: errors.jevLocked ? 'var(--clay-600)' : 'var(--text-muted)' }}>{errors.jevLocked ?? 'Locked keeps the threshold fixed under attack.'}</p>
        </fieldset>
      </div>
      <div className="grid-3">
        <BehaviorChoice name="onStaticAnalysisError" label="Static analysis error" value={draft.onStaticAnalysisError} error={errors.onStaticAnalysisError} disabled={disabled}
          hint="When static analysis of a request fails."
          onChange={(v) => set({ ...draft, onStaticAnalysisError: v })} />
        <BehaviorChoice name="onSuspiciousJevUnavailable" label="Suspicious, JEV unavailable" value={draft.onSuspiciousJevUnavailable} error={errors.onSuspiciousJevUnavailable} disabled={disabled}
          hint="Suspicious requests when JEV cannot answer."
          onChange={(v) => set({ ...draft, onSuspiciousJevUnavailable: v })} />
        <BehaviorChoice name="onSampledJevUnavailable" label="Sampled, JEV unavailable" value={draft.onSampledJevUnavailable} error={errors.onSampledJevUnavailable} disabled={disabled}
          hint="Sampled safe requests when JEV cannot answer."
          onChange={(v) => set({ ...draft, onSampledJevUnavailable: v })} />
      </div>
    </div>
  );
}
