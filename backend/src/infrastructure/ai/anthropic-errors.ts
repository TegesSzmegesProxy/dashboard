import Anthropic from '@anthropic-ai/sdk';
import { AiProviderError } from './ai-provider-error.js';

/** Maps SDK failures to safe, storable provider errors. */
export function mapAnthropicError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (error instanceof Anthropic.AuthenticationError) {
    return new AiProviderError(
      'AI_CREDENTIAL_INVALID',
      'AI provider rejected the API key',
    );
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new AiProviderError(
      'AI_CREDENTIAL_INVALID',
      'AI provider denied access for this API key',
    );
  }
  if (
    error instanceof Anthropic.BadRequestError &&
    /credit|billing|balance/i.test(error.message)
  ) {
    return new AiProviderError(
      'AI_QUOTA_EXCEEDED',
      'The AI provider account has insufficient credit',
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiProviderError(
      'PROVIDER_UNAVAILABLE',
      'AI provider rate limited the request',
      true,
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiProviderError(
      'PROVIDER_UNAVAILABLE',
      'AI provider could not be reached',
      true,
    );
  }
  if (error instanceof Anthropic.APIError) {
    const status: number = typeof error.status === 'number' ? error.status : 0;
    return new AiProviderError(
      status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
      `AI provider returned HTTP ${status}`,
      status >= 500,
    );
  }
  return new AiProviderError('PROVIDER_ERROR', 'AI provider request failed');
}
