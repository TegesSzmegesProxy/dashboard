import Anthropic from '@anthropic-ai/sdk';
import { AiProviderError } from './application-analysis.provider.js';

/** Maps SDK failures to safe, storable provider errors. */
export function mapAnthropicError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
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

/** Reads JSON text output after checking stop reasons that void it. */
export function parseStructuredMessage(
  message: Anthropic.Beta.BetaMessage,
): unknown {
  if (message.stop_reason === 'refusal') {
    throw new AiProviderError('REFUSED', 'AI provider declined the request');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new AiProviderError(
      'OUTPUT_TRUNCATED',
      'AI output exceeded the token limit',
    );
  }
  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new AiProviderError('INVALID_OUTPUT', 'AI output was not JSON');
  }
}
