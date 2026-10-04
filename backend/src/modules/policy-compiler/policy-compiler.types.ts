import type {
  PolicyHttpMethod,
  StructuredPolicyV1Dto,
} from '../../contracts/policy/v1/policy.contract.js';

export interface CompiledStringLengthConfig {
  minLength?: number;
  maxLength?: number;
}

export interface CompiledToolStep {
  toolId: 'string_length';
  contextType: 'field';
  target: string;
  config: CompiledStringLengthConfig;
}

export interface CompiledEndpointPolicy {
  method: PolicyHttpMethod;
  path: string;
  steps: CompiledToolStep[];
}

export interface CompiledPolicyV1 {
  schemaVersion: 'tessera.policy/v1';
  toolRegistryVersion: 'tessera.tools/v1';
  endpoints: CompiledEndpointPolicy[];
}

export type CompilationResult =
  | { ok: true; compiledPolicy: CompiledPolicyV1 }
  | {
      ok: false;
      error: { code: 'INVALID_TOOL_CONFIG' | 'UNKNOWN_TOOL'; message: string };
    };

export type PolicyInput = StructuredPolicyV1Dto;

/** One proxy step of `tessera.policy/v3`, exactly as the bundle carries it. */
export interface CompiledStepV3 {
  toolId: string;
  contextType: 'field' | 'file' | 'full';
  /** `body.x` / `query.x` (or `body.*`, `query.*` in scopes) for field tools, the upload field for file tools. */
  target?: string;
  config: Record<string, unknown>;
}

export interface CompiledScopeV3 {
  steps: CompiledStepV3[];
  jevContext: string | null;
}

export interface CompiledEndpointPolicyV3 {
  method: PolicyHttpMethod;
  path: string;
  steps: CompiledStepV3[];
  jevContext: string | null;
  /** JEV context of body and query fields, keyed by step target. */
  fieldContexts: { target: string; jevContext: string }[];
}

/** The compiled form the proxy runs; it never carries human-readable policy. */
export interface CompiledPolicyV3 {
  schemaVersion: 'tessera.policy/v3';
  toolRegistryVersion: 'tessera.tools/v3';
  global: CompiledScopeV3;
  environment: CompiledScopeV3 & { environmentSnapshotId: string | null };
  endpoints: CompiledEndpointPolicyV3[];
}

export type CompilationResultV3 =
  | {
      ok: true;
      compiledPolicy: CompiledPolicyV3;
      /** Steps a more specific scope replaces; for reviewers, not errors. */
      overrides: { endpoint: string | null; message: string }[];
    }
  | { ok: false; issues: string[] };
