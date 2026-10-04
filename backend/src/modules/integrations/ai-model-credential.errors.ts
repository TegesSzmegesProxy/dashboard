export type AiCredentialErrorCode =
  | 'AI_CREDENTIAL_MISSING'
  | 'AI_CREDENTIAL_UNAVAILABLE'
  | 'AI_ENDPOINT_NOT_ALLOWED'
  | 'AI_ENDPOINT_UNRESOLVED';

/** Error whose message is safe to store; it never contains the key. */
export class AiCredentialError extends Error {
  constructor(
    readonly code: AiCredentialErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
