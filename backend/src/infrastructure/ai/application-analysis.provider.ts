export interface AnalysisSourceFile {
  path: string;
  content: string;
}

export interface ApplicationAnalysisInput {
  files: AnalysisSourceFile[];
  dependencies: { name: string; version: string; ecosystem: string }[];
  vulnerabilities: { id: string; packageName: string; severity: string }[];
}

export interface ApplicationAnalysisResponse {
  /** Untrusted structured output; callers must validate it. */
  output: unknown;
  provider: string;
  /** Model that actually produced the output (fallbacks may differ). */
  model: string;
}

export type AiProviderErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'REFUSED'
  | 'OUTPUT_TRUNCATED'
  | 'INVALID_OUTPUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_ERROR';

/** Error whose message is safe to store; it never includes source content. */
export class AiProviderError extends Error {
  constructor(
    readonly code: AiProviderErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

/** Provider-independent application analysis model. */
export abstract class ApplicationAnalysisProvider {
  abstract readonly isConfigured: boolean;
  abstract analyze(
    input: ApplicationAnalysisInput,
  ): Promise<ApplicationAnalysisResponse>;
}
