import Anthropic from '@anthropic-ai/sdk';
import { AiProviderError } from '../ai-provider-error.js';
import { mapAnthropicError } from '../anthropic-errors.js';
import type {
  LlmChatRequest,
  LlmChatResponse,
  LlmClient,
  LlmJsonRequest,
  LlmJsonResponse,
  LlmMessage,
  LlmStopReason,
  LlmUserPart,
} from './llm.types.js';

const BETAS: Anthropic.Beta.AnthropicBeta[] = [
  'server-side-fallback-2026-07-01',
  'context-management-2025-06-27',
  'task-budgets-2026-03-13',
];

/** Anthropic Messages API, or a self-hosted server that speaks it. */
export class AnthropicLlmClient implements LlmClient {
  readonly provider = 'anthropic' as const;

  constructor(private readonly client: Anthropic) {}

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages
        .stream({
          model: request.model,
          max_tokens: request.maxOutputTokens,
          betas: BETAS,
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: {
            effort: request.effort,
            task_budget: { type: 'tokens', total: request.taskBudgetTokens },
          },
          context_management: {
            edits: [{ type: 'clear_tool_uses_20250919' }],
          },
          system: [
            {
              type: 'text',
              text: request.system,
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            strict: true,
            input_schema:
              tool.inputSchema as Anthropic.Beta.BetaTool['input_schema'],
          })),
          messages: request.messages.map(toAnthropicMessage),
        })
        .finalMessage();
    } catch (error) {
      throw mapAnthropicError(error);
    }
    return {
      text: response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(''),
      toolCalls: response.content
        .filter((block) => block.type === 'tool_use')
        .map((block) => ({
          id: block.id,
          name: block.name,
          input: block.input,
        })),
      stopReason: toStopReason(response.stop_reason),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
      model: response.model,
      // Replayed as-is so thinking blocks stay in the history.
      providerState: response.content,
    };
  }

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.client.beta.messages
        .stream({
          model: request.model,
          max_tokens: request.maxOutputTokens,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: {
            effort: request.effort,
            format: { type: 'json_schema', schema: request.schema },
          },
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
        })
        .finalMessage();
    } catch (error) {
      throw mapAnthropicError(error);
    }
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
      return { output: JSON.parse(text) as unknown, model: message.model };
    } catch {
      throw new AiProviderError('INVALID_OUTPUT', 'AI output was not JSON');
    }
  }

  async ping(model: string): Promise<boolean> {
    try {
      const message = await this.client.messages.create({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the word OK.' }],
      });
      return message.content.some(
        (block) => block.type === 'text' && block.text.trim().length > 0,
      );
    } catch (error) {
      throw mapAnthropicError(error);
    }
  }
}

function toStopReason(reason: string | null): LlmStopReason {
  if (reason === 'refusal') return 'refusal';
  if (reason === 'max_tokens') return 'max_tokens';
  if (reason === 'tool_use') return 'tool_use';
  return 'end';
}

function toAnthropicMessage(
  message: LlmMessage,
): Anthropic.Beta.BetaMessageParam {
  if (message.role === 'assistant') {
    if (Array.isArray(message.providerState)) {
      return {
        role: 'assistant',
        content: message.providerState as Anthropic.Beta.BetaContentBlock[],
      };
    }
    return {
      role: 'assistant',
      content: [
        ...(message.text
          ? [{ type: 'text' as const, text: message.text }]
          : []),
        ...message.toolCalls.map((call) => ({
          type: 'tool_use' as const,
          id: call.id,
          name: call.name,
          input: call.input,
        })),
      ],
    };
  }
  return { role: 'user', content: message.content.map(toAnthropicPart) };
}

function toAnthropicPart(
  part: LlmUserPart,
): Anthropic.Beta.BetaContentBlockParam {
  if (part.type === 'tool_result') {
    return {
      type: 'tool_result',
      tool_use_id: part.toolUseId,
      content: part.content,
      ...(part.isError ? { is_error: true } : {}),
    };
  }
  return {
    type: 'text',
    text: part.text,
    ...(part.cacheBreakpoint
      ? { cache_control: { type: 'ephemeral' as const } }
      : {}),
  };
}
