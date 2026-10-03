import type { Behavior, RuntimeConfiguration } from '../api';
import { Input, Radio } from '../ds';

/** String-typed form state; nothing is pre-filled (ADR-0002: no invented defaults). */
export interface RuntimeDraft {
  upstreamUrl: string;
  failureBehavior: Behavior | '';
  unknownEndpointBehavior: Behavior | '';
  pathPrefix: string;
  requestTimeoutMs: string;
  maxRequestBodyBytes: string;
  samplingRate: string;
}

export const emptyRuntime: RuntimeDraft = {
  upstreamUrl: '', failureBehavior: '', unknownEndpointBehavior: '', pathPrefix: '',
  requestTimeoutMs: '', maxRequestBodyBytes: '', samplingRate: '',
};

export const toDraft = (c: RuntimeConfiguration): RuntimeDraft => ({
  upstreamUrl: c.upstreamUrl,
  failureBehavior: c.failureBehavior,
  unknownEndpointBehavior: c.unknownEndpointBehavior,
  pathPrefix: c.routing.pathPrefix,
  requestTimeoutMs: String(c.thresholds.requestTimeoutMs),
  maxRequestBodyBytes: String(c.thresholds.maxRequestBodyBytes),
  samplingRate: String(c.samplingRate),
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
  const samplingRate = Number(d.samplingRate);
  if (d.samplingRate === '' || !(samplingRate >= 0 && samplingRate <= 1)) e.samplingRate = '0–1';
  if (Object.keys(e).length || !d.failureBehavior || !d.unknownEndpointBehavior) return { errors: e };
  return {
    errors: e,
    value: {
      upstreamUrl: d.upstreamUrl,
      failureBehavior: d.failureBehavior,
      unknownEndpointBehavior: d.unknownEndpointBehavior,
      routing: { pathPrefix: d.pathPrefix },
      thresholds: { requestTimeoutMs, maxRequestBodyBytes },
      samplingRate,
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
        <Input label="Sampling rate" type="number" step="0.01" mono placeholder="0–1" {...f('samplingRate')} hint="Share of decisions sampled for telemetry." />
      </div>
    </div>
  );
}
