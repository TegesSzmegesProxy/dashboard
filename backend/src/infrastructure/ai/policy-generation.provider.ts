import type { StructuredPolicyV1Dto } from '../../contracts/policy/v1/policy.contract.js';

export interface PolicyGenerationEndpoint {
  method: string;
  path: string;
  description: string;
  fields: {
    name: string;
    location: string;
    type: string;
    required: boolean;
    constraints: string[];
  }[];
}

export interface PolicyGenerationAnalysisContext {
  endpoints: PolicyGenerationEndpoint[];
  configuration: { name: string; summary: string }[];
  findings: {
    category: string;
    severity: string;
    title: string;
    description: string;
    basis: string;
  }[];
}

export type PolicyGenerationInput =
  | { mode: 'generate'; analysis: PolicyGenerationAnalysisContext }
  | {
      mode: 'edit';
      analysis: PolicyGenerationAnalysisContext | null;
      basePolicy: {
        humanReadableIntent: string;
        structuredPolicy: StructuredPolicyV1Dto;
      };
      instruction: string;
    };

export interface PolicyGenerationResponse {
  /** Untrusted structured output; callers must validate it. */
  output: unknown;
  provider: string;
  /** Model that actually produced the output (fallbacks may differ). */
  model: string;
}

/** Provider-independent policy generation and natural-language editing. */
export abstract class PolicyGenerationProvider {
  abstract readonly isConfigured: boolean;
  abstract generate(
    input: PolicyGenerationInput,
  ): Promise<PolicyGenerationResponse>;
}
