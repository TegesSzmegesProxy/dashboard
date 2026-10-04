import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { mapAnthropicError } from '../anthropic-errors.js';
import { addUsage, EMPTY_USAGE, TokenUsage } from '../pricing.js';
import { BudgetGuard } from './budget-guard.js';

export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AgentLimits {
  maxTurns: number;
  maxToolCalls: number;
  /** Advisory pacing for the model (`task_budget`); the guard enforces spend. */
  taskBudgetTokens: number;
  maxOutputTokensPerTurn: number;
  wallTimeMs: number;
  /** Identical calls answered from memory before they are refused. */
  maxRepeatedCalls: number;
}

export interface ToolExecution {
  content: string;
  isError?: boolean;
}

export type AgentStopCode =
  | 'BUDGET_EXHAUSTED'
  | 'TURN_LIMIT'
  | 'TOOL_CALL_LIMIT'
  | 'TIME_LIMIT'
  | 'REFUSED'
  | 'OUTPUT_TRUNCATED'
  | 'NO_SUBMISSION'
  | 'LOOP_DETECTED';

export interface AgentRunResult {
  outcome:
    | { kind: 'submitted'; tool: string; input: unknown }
    | { kind: 'stopped'; code: AgentStopCode };
  usage: TokenUsage;
  costUsd: number;
  turns: number;
  toolCalls: number;
  models: string[];
}

export interface AgentRunOptions {
  client: Anthropic;
  model: string;
  effort: AgentEffort;
  /** Fixed instructions only; never repository or environment text. */
  system: string;
  tools: Anthropic.Beta.BetaTool[];
  /** Untrusted data blocks (dossier, environment), cached as a prefix. */
  dataBlocks: string[];
  task: string;
  submitTools: readonly string[];
  execute: (name: string, input: unknown) => Promise<ToolExecution>;
  limits: AgentLimits;
  budget: BudgetGuard;
}

const BETAS: Anthropic.Beta.AnthropicBeta[] = [
  'server-side-fallback-2026-07-01',
  'context-management-2025-06-27',
  'task-budgets-2026-03-13',
];
const MAX_NUDGES = 2;

/** Infrastructure failures (e.g. a crashed sandbox) end the run. */
function isFatal(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'fatal' in error &&
    error.fatal === true
  );
}
const LOOP_TURNS = 3;

/**
 * Manual tool-use loop for one bounded task (ADR-0009). The history is
 * append-only, the task ends only through a strict `submit_*` tool, and
 * every limit is enforced here, outside the model.
 */
export async function runAgent(
  options: AgentRunOptions,
): Promise<AgentRunResult> {
  const started = Date.now();
  const { limits, budget } = options;
  const memo = new Map<string, { result: ToolExecution; count: number }>();
  const models = new Set<string>();
  let usage = EMPTY_USAGE;
  let cost = 0;
  let toolCalls = 0;
  let nudges = 0;
  let repeatTurns = 0;
  let toolLimitTurn = 0;

  const firstContent: Anthropic.Beta.BetaContentBlockParam[] =
    options.dataBlocks.map((text) => ({ type: 'text', text }));
  if (firstContent.length > 0) {
    // The cached prefix ends after the shared data blocks.
    (
      firstContent[firstContent.length - 1] as Anthropic.Beta.BetaTextBlockParam
    ).cache_control = { type: 'ephemeral' };
  }
  firstContent.push({ type: 'text', text: options.task });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: firstContent },
  ];
  const result = (
    outcome: AgentRunResult['outcome'],
    turns: number,
  ): AgentRunResult => ({
    outcome,
    usage,
    costUsd: cost,
    turns,
    toolCalls,
    models: [...models],
  });

  for (let turn = 1; turn <= limits.maxTurns; turn++) {
    if (budget.exhausted)
      return result({ kind: 'stopped', code: 'BUDGET_EXHAUSTED' }, turn - 1);
    if (Date.now() - started > limits.wallTimeMs) {
      return result({ kind: 'stopped', code: 'TIME_LIMIT' }, turn - 1);
    }
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await options.client.beta.messages
        .stream({
          model: options.model,
          max_tokens: limits.maxOutputTokensPerTurn,
          betas: BETAS,
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: {
            effort: options.effort,
            task_budget: { type: 'tokens', total: limits.taskBudgetTokens },
          },
          context_management: {
            edits: [{ type: 'clear_tool_uses_20250919' }],
          },
          system: [
            {
              type: 'text',
              text: options.system,
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools: options.tools,
          messages,
        })
        .finalMessage();
    } catch (error) {
      throw mapAnthropicError(error);
    }
    models.add(response.model);
    const turnUsage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    };
    usage = addUsage(usage, turnUsage);
    cost += budget.record(turnUsage, options.model, response.model);

    if (response.stop_reason === 'refusal') {
      return result({ kind: 'stopped', code: 'REFUSED' }, turn);
    }
    if (response.stop_reason === 'max_tokens') {
      return result({ kind: 'stopped', code: 'OUTPUT_TRUNCATED' }, turn);
    }
    messages.push({ role: 'assistant', content: response.content });

    const calls = response.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock =>
        block.type === 'tool_use',
    );
    const submission = calls.find((call) =>
      options.submitTools.includes(call.name),
    );
    if (submission) {
      return result(
        { kind: 'submitted', tool: submission.name, input: submission.input },
        turn,
      );
    }
    if (calls.length === 0) {
      if (++nudges > MAX_NUDGES)
        return result({ kind: 'stopped', code: 'NO_SUBMISSION' }, turn);
      messages.push({
        role: 'user',
        content: `Finish by calling ${options.submitTools.join(' or ')}.`,
      });
      continue;
    }

    let allRepeats = true;
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const key = createHash('sha256')
        .update(`${call.name}\u0000${JSON.stringify(call.input)}`)
        .digest('hex');
      const previous = memo.get(key);
      let execution: ToolExecution;
      if (previous) {
        previous.count++;
        execution =
          previous.count > limits.maxRepeatedCalls
            ? {
                content:
                  'Repeated call refused. Use what you already have, or submit.',
                isError: true,
              }
            : previous.result;
      } else if (toolCalls >= limits.maxToolCalls) {
        execution = {
          content: 'Tool budget exhausted. Submit your result now.',
          isError: true,
        };
        if (toolLimitTurn > 0 && toolLimitTurn < turn) {
          return result({ kind: 'stopped', code: 'TOOL_CALL_LIMIT' }, turn);
        }
        toolLimitTurn ||= turn;
      } else {
        allRepeats = false;
        toolCalls++;
        try {
          execution = await options.execute(call.name, call.input);
        } catch (error) {
          if (isFatal(error)) throw error;
          execution = { content: 'Tool failed.', isError: true };
        }
        memo.set(key, { result: execution, count: 1 });
      }
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: execution.content,
        ...(execution.isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: 'user', content: results });

    repeatTurns = allRepeats ? repeatTurns + 1 : 0;
    if (repeatTurns >= LOOP_TURNS)
      return result({ kind: 'stopped', code: 'LOOP_DETECTED' }, turn);
  }
  return result({ kind: 'stopped', code: 'TURN_LIMIT' }, limits.maxTurns);
}
