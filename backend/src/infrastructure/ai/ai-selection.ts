import type { LlmMode, LlmProviderName } from './llm/llm.types.js';

/** The `.env` settings that choose the deployment's AI model (ADR-0020). */
export interface AiSelectionInput {
  AI_PROVIDER?: LlmProviderName;
  AI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  AI_BASE_URL?: string;
}

export type AiSelection =
  | { ok: true; provider: LlmProviderName; mode: LlmMode; model: string }
  | { ok: true; provider: null; mode: null; model: string }
  | { ok: false; problem: string };

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

/**
 * Decides which provider the deployment uses. Which vendor receives redacted
 * source is a data-handling choice, so an ambiguous setup is refused instead
 * of resolved by a default.
 */
export function selectAi(input: AiSelectionInput): AiSelection {
  const { AI_PROVIDER, ANTHROPIC_API_KEY, GEMINI_API_KEY, AI_BASE_URL } = input;
  const model = input.AI_MODEL ?? DEFAULT_ANTHROPIC_MODEL;

  if (AI_PROVIDER === 'gemini' && AI_BASE_URL) {
    return {
      ok: false,
      problem: 'AI_BASE_URL applies to Anthropic-compatible servers only',
    };
  }
  if (!AI_PROVIDER) {
    const choices = [ANTHROPIC_API_KEY, GEMINI_API_KEY, AI_BASE_URL].filter(
      (value) => value !== undefined,
    );
    if (choices.length > 1) {
      return {
        ok: false,
        problem:
          'more than one of ANTHROPIC_API_KEY, GEMINI_API_KEY and AI_BASE_URL is set; set AI_PROVIDER',
      };
    }
  }

  const provider: LlmProviderName | null =
    AI_PROVIDER ??
    (GEMINI_API_KEY
      ? 'gemini'
      : AI_BASE_URL || ANTHROPIC_API_KEY
        ? 'anthropic'
        : null);

  if (provider === 'gemini') {
    if (!GEMINI_API_KEY) return { ok: true, provider: null, mode: null, model };
    if (!input.AI_MODEL) {
      return { ok: false, problem: 'AI_MODEL is required for Gemini' };
    }
    return { ok: true, provider, mode: 'gemini', model };
  }
  if (provider === 'anthropic') {
    if (AI_BASE_URL) return { ok: true, provider, mode: 'local', model };
    if (ANTHROPIC_API_KEY)
      return { ok: true, provider, mode: 'anthropic', model };
  }
  return { ok: true, provider: null, mode: null, model };
}
