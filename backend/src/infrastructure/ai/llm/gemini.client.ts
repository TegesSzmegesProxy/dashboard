import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
  type Part,
} from '@google/genai';
import { AiProviderError } from '../ai-provider-error.js';
import type {
  LlmChatRequest,
  LlmChatResponse,
  LlmClient,
  LlmJsonRequest,
  LlmJsonResponse,
  LlmMessage,
  LlmStopReason,
  LlmToolCall,
  LlmUserPart,
} from './llm.types.js';

/** Ids Gemini did not supply; they are never sent back to the API. */
const GENERATED_ID_PREFIX = 'gemini-call-';
const PING_MAX_TOKENS = 512;

const REFUSAL_FINISH_REASONS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
  FinishReason.RECITATION,
  FinishReason.IMAGE_SAFETY,
  FinishReason.IMAGE_PROHIBITED_CONTENT,
]);

/**
 * Google Gemini API (Developer API key). Thinking, caching and fallbacks use
 * the model's defaults: nothing here depends on a particular Gemini version.
 */
export class GeminiLlmClient implements LlmClient {
  readonly provider = 'gemini' as const;
  private callCounter = 0;

  constructor(
    private readonly client: GoogleGenAI,
    private readonly timeoutMs: number,
  ) {}

  static create(
    apiKey: string,
    timeoutMs: number,
    maxRetries: number,
  ): GeminiLlmClient {
    return new GeminiLlmClient(
      new GoogleGenAI({
        apiKey,
        httpOptions: {
          timeout: timeoutMs,
          retryOptions: { attempts: maxRetries + 1 },
        },
      }),
      timeoutMs,
    );
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    let response: GenerateContentResponse;
    try {
      response = await this.client.models.generateContent({
        model: request.model,
        contents: request.messages.map(toGeminiContent),
        config: {
          systemInstruction: request.system,
          maxOutputTokens: request.maxOutputTokens,
          tools: [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parametersJsonSchema: tool.inputSchema,
              })),
            },
          ],
          httpOptions: { timeout: this.timeoutMs },
        },
      });
    } catch (error) {
      throw mapGeminiError(error);
    }
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const toolCalls: LlmToolCall[] = parts.flatMap((part) =>
      part.functionCall?.name
        ? [
            {
              id:
                part.functionCall.id ??
                `${GENERATED_ID_PREFIX}${++this.callCounter}`,
              name: part.functionCall.name,
              input: part.functionCall.args ?? {},
            },
          ]
        : [],
    );
    return {
      text: parts
        .filter(
          (part) => part.thought !== true && typeof part.text === 'string',
        )
        .map((part) => part.text)
        .join(''),
      toolCalls,
      stopReason: stopReason(response, toolCalls.length > 0),
      usage: usage(response),
      model: response.modelVersion ?? request.model,
      providerState: candidate?.content,
    };
  }

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    let response: GenerateContentResponse;
    try {
      response = await this.client.models.generateContent({
        model: request.model,
        contents: [{ role: 'user', parts: [{ text: request.user }] }],
        config: {
          systemInstruction: request.system,
          maxOutputTokens: request.maxOutputTokens,
          responseMimeType: 'application/json',
          responseJsonSchema: request.schema,
          httpOptions: { timeout: this.timeoutMs },
        },
      });
    } catch (error) {
      throw mapGeminiError(error);
    }
    const reason = stopReason(response, false);
    if (reason === 'refusal') {
      throw new AiProviderError('REFUSED', 'AI provider declined the request');
    }
    if (reason === 'max_tokens') {
      throw new AiProviderError(
        'OUTPUT_TRUNCATED',
        'AI output exceeded the token limit',
      );
    }
    const text = (response.candidates?.[0]?.content?.parts ?? [])
      .filter((part) => part.thought !== true && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    try {
      return {
        output: JSON.parse(text) as unknown,
        model: response.modelVersion ?? request.model,
      };
    } catch {
      throw new AiProviderError('INVALID_OUTPUT', 'AI output was not JSON');
    }
  }

  async ping(model: string): Promise<boolean> {
    try {
      const response = await this.client.models.generateContent({
        model,
        contents: 'Reply with the word OK.',
        config: { maxOutputTokens: PING_MAX_TOKENS },
      });
      return (response.candidates?.[0]?.content?.parts ?? []).some(
        (part) =>
          part.thought !== true &&
          typeof part.text === 'string' &&
          part.text.trim().length > 0,
      );
    } catch (error) {
      throw mapGeminiError(error);
    }
  }
}

function stopReason(
  response: GenerateContentResponse,
  hasToolCalls: boolean,
): LlmStopReason {
  if (response.promptFeedback?.blockReason) return 'refusal';
  const finish = response.candidates?.[0]?.finishReason;
  if (finish === FinishReason.MAX_TOKENS) return 'max_tokens';
  if (finish && REFUSAL_FINISH_REASONS.has(finish)) return 'refusal';
  // A malformed call arrives without a call; the loop nudges the model.
  return hasToolCalls ? 'tool_use' : 'end';
}

function usage(response: GenerateContentResponse): LlmChatResponse['usage'] {
  const metadata = response.usageMetadata;
  const prompt =
    (metadata?.promptTokenCount ?? 0) +
    (metadata?.toolUsePromptTokenCount ?? 0);
  const cached = Math.min(metadata?.cachedContentTokenCount ?? 0, prompt);
  return {
    inputTokens: prompt - cached,
    // Thinking tokens are billed as output.
    outputTokens:
      (metadata?.candidatesTokenCount ?? 0) +
      (metadata?.thoughtsTokenCount ?? 0),
    cacheWriteTokens: 0,
    cacheReadTokens: cached,
  };
}

function toGeminiContent(message: LlmMessage): Content {
  if (message.role === 'assistant') {
    const state = message.providerState as Content | undefined;
    if (state && Array.isArray(state.parts)) {
      return { role: 'model', parts: state.parts };
    }
    const parts: Part[] = [
      ...(message.text ? [{ text: message.text }] : []),
      ...message.toolCalls.map((call) => ({
        functionCall: {
          name: call.name,
          args: (call.input ?? {}) as Record<string, unknown>,
        },
      })),
    ];
    return { role: 'model', parts };
  }
  return { role: 'user', parts: message.content.map(toGeminiPart) };
}

function toGeminiPart(part: LlmUserPart): Part {
  if (part.type === 'tool_result') {
    return {
      functionResponse: {
        name: part.name,
        ...(part.toolUseId.startsWith(GENERATED_ID_PREFIX)
          ? {}
          : { id: part.toolUseId }),
        response: part.isError
          ? { error: part.content }
          : { output: part.content },
      },
    };
  }
  return { text: part.text };
}

/** Maps SDK failures to safe, storable provider errors. */
export function mapGeminiError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (error instanceof ApiError) {
    const status = error.status;
    // Gemini reports a bad key as 400 INVALID_ARGUMENT.
    if (
      status === 401 ||
      status === 403 ||
      /API key (not valid|expired)|API_KEY_INVALID/i.test(error.message)
    ) {
      return new AiProviderError(
        'AI_CREDENTIAL_INVALID',
        'AI provider rejected the API key',
      );
    }
    if (/billing|prepayment|credits? (are )?depleted/i.test(error.message)) {
      return new AiProviderError(
        'AI_QUOTA_EXCEEDED',
        'The AI provider account has insufficient credit',
      );
    }
    if (status === 429) {
      return new AiProviderError(
        'PROVIDER_UNAVAILABLE',
        'AI provider rate limited the request',
        true,
      );
    }
    return new AiProviderError(
      status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
      `AI provider returned HTTP ${status}`,
      status >= 500,
    );
  }
  if (error instanceof Error) {
    // Network failures and request timeouts carry no status.
    if (
      error.name === 'AbortError' ||
      error.name === 'TimeoutError' ||
      error instanceof TypeError
    ) {
      return new AiProviderError(
        'PROVIDER_UNAVAILABLE',
        'AI provider could not be reached',
        true,
      );
    }
  }
  return new AiProviderError('PROVIDER_ERROR', 'AI provider request failed');
}
