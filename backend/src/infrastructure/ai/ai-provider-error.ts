export type AiProviderErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'REFUSED'
  | 'OUTPUT_TRUNCATED'
  | 'INVALID_OUTPUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'AI_CREDENTIAL_INVALID'
  | 'AI_QUOTA_EXCEEDED';

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
