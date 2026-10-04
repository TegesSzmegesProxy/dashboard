// Policy editor draft: a local copy of a tessera.policy/v2 version that the
// user edits before saving it as one new pending version. Pure state only.
import { POLICY_V2_LIMITS, type EndpointPolicyV2, type FieldPolicyV2, type StructuredPolicyV2, type ToolDefinition, type ToolScope } from '../api';

export const endpointKey = (e: { method: string; path: string }) => `${e.method} ${e.path}`;
export const fieldKey = (f: { location: string; name: string }) => `${f.location}:${f.name}`;

/** The endpoint itself, or one of its fields. */
export type Target = { endpoint: string; field: string | null };
export const targetId = (t: Target) => (t.field ? `${t.endpoint}#${t.field}` : t.endpoint);
export const parseTargetId = (id: string): Target => {
  const i = id.indexOf('#');
  return i < 0 ? { endpoint: id, field: null } : { endpoint: id.slice(0, i), field: id.slice(i + 1) };
};

/** Field tools go on fields, file tools on file fields, full tools on the endpoint (ADR-0014). */
export const scopeOf = (field: FieldPolicyV2 | null): ToolScope => (!field ? 'full' : field.location === 'file' ? 'file' : 'field');

export interface DraftState {
  base: StructuredPolicyV2;
  policy: StructuredPolicyV2;
  /** Targets whose plain-language text changed and was not compiled yet. */
  uncompiled: string[];
  /** Targets whose checks changed by hand after their text was written. */
  staleText: string[];
}

export type DraftAction =
  | { type: 'text'; target: Target; text: string }
  | { type: 'tool'; target: Target; toolId: string; on: boolean }
  | { type: 'jev'; target: Target; text: string }
  /** Accept a compiler result for a target: the endpoint as compiled. */
  | { type: 'compiled'; target: Target; endpoint: EndpointPolicyV2 }
  /** Replace a target's text with a description generated from its checks. */
  | { type: 'describe'; target: Target; text: string }
  | { type: 'keepText'; target: Target }
  | { type: 'revertEndpoint'; endpoint: string }
  | { type: 'reset'; base: StructuredPolicyV2 }
  /** Resume a draft stored locally (see `loadDraft`). */
  | { type: 'restore'; state: DraftState };

export const initDraft = (base: StructuredPolicyV2): DraftState => ({ base, policy: base, uncompiled: [], staleText: [] });

const add = (list: string[], id: string) => (list.includes(id) ? list : [...list, id]);
const drop = (list: string[], id: string) => list.filter((x) => x !== id);
const dropEndpoint = (list: string[], endpoint: string) => list.filter((x) => parseTargetId(x).endpoint !== endpoint);

function mapTarget(
  policy: StructuredPolicyV2,
  t: Target,
  onEndpoint: (e: EndpointPolicyV2) => EndpointPolicyV2,
  onField: (f: FieldPolicyV2) => FieldPolicyV2,
): StructuredPolicyV2 {
  return {
    ...policy,
    endpoints: policy.endpoints.map((e) => {
      if (endpointKey(e) !== t.endpoint) return e;
      if (!t.field) return onEndpoint(e);
      return { ...e, fields: e.fields.map((f) => (fieldKey(f) === t.field ? onField(f) : f)) };
    }),
  };
}

const toggle = (tools: { toolId: string }[], toolId: string, on: boolean) =>
  on ? (tools.some((t) => t.toolId === toolId) ? tools : [...tools, { toolId }]) : tools.filter((t) => t.toolId !== toolId);

export function draftReducer(s: DraftState, a: DraftAction): DraftState {
  switch (a.type) {
    case 'text': {
      const id = targetId(a.target);
      const policy = mapTarget(s.policy, a.target, (e) => ({ ...e, humanReadablePolicy: a.text }), (f) => ({ ...f, humanReadablePolicy: a.text }));
      // Back to the saved text: nothing to compile.
      const original = textOf(s.base, a.target);
      return { ...s, policy, uncompiled: original === a.text ? drop(s.uncompiled, id) : add(s.uncompiled, id), staleText: drop(s.staleText, id) };
    }
    case 'tool': {
      const policy = mapTarget(
        s.policy, a.target,
        (e) => ({ ...e, requestTools: toggle(e.requestTools, a.toolId, a.on) }),
        (f) => ({ ...f, tools: toggle(f.tools, a.toolId, a.on) }),
      );
      return { ...s, policy, staleText: add(s.staleText, targetId(a.target)) };
    }
    case 'jev': {
      const value = a.text.trim() === '' ? null : a.text;
      return { ...s, policy: mapTarget(s.policy, a.target, (e) => ({ ...e, jevContext: value }), (f) => ({ ...f, jevContext: value })) };
    }
    case 'compiled': {
      const id = targetId(a.target);
      const policy = { ...s.policy, endpoints: s.policy.endpoints.map((e) => (endpointKey(e) === a.target.endpoint ? a.endpoint : e)) };
      return { ...s, policy, uncompiled: drop(s.uncompiled, id), staleText: drop(s.staleText, id) };
    }
    case 'describe': {
      const id = targetId(a.target);
      const policy = mapTarget(s.policy, a.target, (e) => ({ ...e, humanReadablePolicy: a.text }), (f) => ({ ...f, humanReadablePolicy: a.text }));
      // Generated from the checks themselves, so text and checks agree.
      return { ...s, policy, uncompiled: drop(s.uncompiled, id), staleText: drop(s.staleText, id) };
    }
    case 'keepText':
      return { ...s, staleText: drop(s.staleText, targetId(a.target)) };
    case 'revertEndpoint': {
      const original = s.base.endpoints.find((e) => endpointKey(e) === a.endpoint);
      if (!original) return s;
      return {
        ...s,
        policy: { ...s.policy, endpoints: s.policy.endpoints.map((e) => (endpointKey(e) === a.endpoint ? original : e)) },
        uncompiled: dropEndpoint(s.uncompiled, a.endpoint),
        staleText: dropEndpoint(s.staleText, a.endpoint),
      };
    }
    case 'reset':
      return initDraft(a.base);
    case 'restore':
      return a.state;
  }
}

export function findTarget(policy: StructuredPolicyV2, t: Target): { endpoint: EndpointPolicyV2; field: FieldPolicyV2 | null } | null {
  const endpoint = policy.endpoints.find((e) => endpointKey(e) === t.endpoint);
  if (!endpoint) return null;
  if (!t.field) return { endpoint, field: null };
  const field = endpoint.fields.find((f) => fieldKey(f) === t.field);
  return field ? { endpoint, field } : null;
}

export function textOf(policy: StructuredPolicyV2, t: Target): string {
  const found = findTarget(policy, t);
  return found ? (found.field ? found.field.humanReadablePolicy : found.endpoint.humanReadablePolicy) : '';
}

export function toolsOf(policy: StructuredPolicyV2, t: Target): string[] {
  const found = findTarget(policy, t);
  return found ? (found.field ? found.field.tools : found.endpoint.requestTools).map((x) => x.toolId) : [];
}

// ---------- Diff ----------

export interface Change {
  endpoint: string;
  field: string | null;
  what: 'text' | 'checks' | 'jev';
  added: string[];
  removed: string[];
}

function diffElement(endpoint: string, field: string | null, before: { text: string; tools: string[]; jev: string | null }, after: typeof before): Change[] {
  const out: Change[] = [];
  const added = after.tools.filter((t) => !before.tools.includes(t));
  const removed = before.tools.filter((t) => !after.tools.includes(t));
  if (added.length || removed.length) out.push({ endpoint, field, what: 'checks', added, removed });
  if (before.text !== after.text) out.push({ endpoint, field, what: 'text', added: [], removed: [] });
  if ((before.jev ?? '') !== (after.jev ?? '')) out.push({ endpoint, field, what: 'jev', added: [], removed: [] });
  return out;
}

/** Changes from `base` to `draft`. Endpoints and fields are fixed, so they only change in place. */
export function diffPolicy(base: StructuredPolicyV2, draft: StructuredPolicyV2): Change[] {
  return draft.endpoints.flatMap((e) => {
    const b = base.endpoints.find((x) => endpointKey(x) === endpointKey(e));
    if (!b) return [];
    const key = endpointKey(e);
    return [
      ...diffElement(key, null,
        { text: b.humanReadablePolicy, tools: b.requestTools.map((t) => t.toolId), jev: b.jevContext },
        { text: e.humanReadablePolicy, tools: e.requestTools.map((t) => t.toolId), jev: e.jevContext }),
      ...e.fields.flatMap((f) => {
        const bf = b.fields.find((x) => fieldKey(x) === fieldKey(f));
        return bf
          ? diffElement(key, fieldKey(f),
            { text: bf.humanReadablePolicy, tools: bf.tools.map((t) => t.toolId), jev: bf.jevContext },
            { text: f.humanReadablePolicy, tools: f.tools.map((t) => t.toolId), jev: f.jevContext })
          : [];
      }),
    ];
  });
}

// ---------- Validation (mirrors the backend contract) ----------

export interface DraftProblem { target: Target; message: string }

export function validateDraft(policy: StructuredPolicyV2, registry: ToolDefinition[]): DraftProblem[] {
  const scope = new Map(registry.map((t) => [t.id, t.scope]));
  const out: DraftProblem[] = [];
  for (const e of policy.endpoints) {
    const endpoint = endpointKey(e);
    const at = (field: string | null, message: string) => out.push({ target: { endpoint, field }, message });
    if (e.humanReadablePolicy.length > POLICY_V2_LIMITS.endpointText) at(null, `Description is longer than ${POLICY_V2_LIMITS.endpointText} characters.`);
    if ((e.jevContext?.length ?? 0) > POLICY_V2_LIMITS.endpointJev) at(null, `JEV context is longer than ${POLICY_V2_LIMITS.endpointJev} characters.`);
    e.requestTools.forEach((t) => scope.get(t.toolId) !== 'full' && at(null, `${t.toolId} cannot be a request check.`));
    for (const f of e.fields) {
      const k = fieldKey(f);
      if (f.humanReadablePolicy.length > POLICY_V2_LIMITS.fieldText) at(k, `Description is longer than ${POLICY_V2_LIMITS.fieldText} characters.`);
      if ((f.jevContext?.length ?? 0) > POLICY_V2_LIMITS.fieldJev) at(k, `JEV context is longer than ${POLICY_V2_LIMITS.fieldJev} characters.`);
      f.tools.forEach((t) => scope.get(t.toolId) !== scopeOf(f) && at(k, `${t.toolId} does not apply to this field.`));
    }
  }
  return out;
}

// ---------- Generated descriptions ----------

const joinWords = (words: string[]) =>
  words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/**
 * A plain description built only from the selected checks, so it always
 * matches them. Used when the user changed checks by hand.
 */
export function describeChecks(toolIds: string[], registry: ToolDefinition[], isEndpoint: boolean): string {
  if (toolIds.length === 0) return isEndpoint ? 'No request-level checks.' : 'No checks on this field.';
  const labels = toolIds.map((id) => registry.find((t) => t.id === id)?.label.toLowerCase() ?? id);
  return `${isEndpoint ? 'The proxy checks the whole request for' : 'The proxy checks this field for'} ${joinWords(labels)}.`;
}

// ---------- Local autosave (per viewer, best effort) ----------

const storageKey = (tenantId: string, version: string) => `tessera.policyDraft.${tenantId}.${version}`;

export function loadDraft(tenantId: string, version: string, base: StructuredPolicyV2): DraftState | null {
  try {
    const raw = localStorage.getItem(storageKey(tenantId, version));
    if (!raw) return null;
    const saved = JSON.parse(raw) as Omit<DraftState, 'base'>;
    // A stored draft only applies to the same endpoints and fields.
    const shape = (p: StructuredPolicyV2) => p.endpoints.map((e) => `${endpointKey(e)}|${e.fields.map(fieldKey).join(',')}`).join(';');
    if (shape(saved.policy) !== shape(base)) return null;
    return { base, policy: saved.policy, uncompiled: saved.uncompiled ?? [], staleText: saved.staleText ?? [] };
  } catch {
    return null;
  }
}

export function storeDraft(tenantId: string, version: string, s: DraftState | null) {
  try {
    if (!s || diffPolicy(s.base, s.policy).length === 0) localStorage.removeItem(storageKey(tenantId, version));
    else localStorage.setItem(storageKey(tenantId, version), JSON.stringify({ policy: s.policy, uncompiled: s.uncompiled, staleText: s.staleText }));
  } catch {
    // Storage is a convenience; the editor works without it.
  }
}
