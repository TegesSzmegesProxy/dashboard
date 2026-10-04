import type { TokenUsage } from '../pricing.js';

/**
 * Provider-neutral model interface (ADR-0020). The agent loop, the analysis
 * pipeline and policy generation depend on this and never on a vendor SDK.
 */

export type LlmEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type LlmProviderName = 'anthropic' | 'gemini';
/** `local` is a self-hosted Anthropic-compatible server (no key sent). */
export type LlmMode = 'anthropic' | 'local' | 'gemini';

export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments; an object with all properties required. */
  inputSchema: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface LlmToolResult {
  toolUseId: string;
  /** Needed by providers that match results to calls by name. */
  name: string;
  content: string;
  isError: boolean;
}

export type LlmUserPart =
  | { type: 'text'; text: string; cacheBreakpoint?: boolean }
  | ({ type: 'tool_result' } & LlmToolResult);

export type LlmMessage =
  | { role: 'user'; content: LlmUserPart[] }
  | {
      role: 'assistant';
      text: string;
      toolCalls: LlmToolCall[];
      /**
       * The provider's own record of this turn, replayed verbatim on the next
       * request (e.g. Gemini thought signatures). Opaque to callers.
       */
      providerState?: unknown;
    };

export interface LlmChatRequest {
  model: string;
  effort: LlmEffort;
  /** Fixed instructions only; never repository or environment text. */
  system: string;
  messages: LlmMessage[];
  tools: LlmTool[];
  maxOutputTokens: number;
  /** Advisory pacing; providers without such a control ignore it. */
  taskBudgetTokens: number;
}

export type LlmStopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal';

export interface LlmChatResponse {
  text: string;
  toolCalls: LlmToolCall[];
  stopReason: LlmStopReason;
  usage: TokenUsage;
  /** The model that actually answered (fallbacks may differ). */
  model: string;
  providerState?: unknown;
}

export interface LlmJsonRequest {
  model: string;
  effort: LlmEffort;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface LlmJsonResponse {
  /** Untrusted; callers must validate it. */
  output: unknown;
  model: string;
}

export interface LlmClient {
  readonly provider: LlmProviderName;
  /** One turn of a tool-using conversation. Throws `AiProviderError`. */
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
  /** One schema-constrained JSON answer. Throws `AiProviderError`. */
  generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse>;
  /** A minimal request to show the operator whether the model answers. */
  ping(model: string): Promise<boolean>;
}
