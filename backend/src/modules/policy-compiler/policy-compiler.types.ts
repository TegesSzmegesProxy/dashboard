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
