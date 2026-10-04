import { createHash } from 'node:crypto';
import { AiProviderError } from '../ai-provider-error.js';
import { mapAnthropicError } from '../anthropic-errors.js';
import type {
  LlmChatResponse,
  LlmClient,
  LlmEffort,
  LlmMessage,
  LlmTool,
  LlmToolResult,
} from '../llm/llm.types.js';
import { addUsage, EMPTY_USAGE, TokenUsage } from '../pricing.js';
import { BudgetGuard } from './budget-guard.js';

export type AgentEffort = LlmEffort;

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
  client: LlmClient;
  model: string;
  effort: AgentEffort;
  /** Fixed instructions only; never repository or environment text. */
  system: string;
  tools: LlmTool[];
  /** Untrusted data blocks (dossier, environment), cached as a prefix. */
  dataBlocks: string[];
  task: string;
  submitTools: readonly string[];
  execute: (name: string, input: unknown) => Promise<ToolExecution>;
  /**
   * Returns a description of what is wrong with a submission, or null when it
   * is acceptable. A rejected submission goes back to the model as a tool
   * error so it can correct it (bounded by MAX_REPAIRS).
   */
  checkSubmission?: (tool: string, input: unknown) => Promise<string | null>;
  limits: AgentLimits;
  budget: BudgetGuard;
}

const MAX_NUDGES = 2;
const MAX_REPAIRS = 2;

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
 * Manual tool-use loop for one bounded task (ADR-0013). The history is
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
  let repairs = 0;
  let repeatTurns = 0;
  let toolLimitTurn = 0;

  const messages: LlmMessage[] = [
    {
      role: 'user',
      content: [
        // The cached prefix ends after the shared data blocks.
        ...options.dataBlocks.map((text, index) => ({
          type: 'text' as const,
          text,
          cacheBreakpoint: index === options.dataBlocks.length - 1,
        })),
        { type: 'text' as const, text: options.task },
      ],
    },
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
    let response: LlmChatResponse;
    try {
      response = await options.client.chat({
        model: options.model,
        effort: options.effort,
        system: options.system,
        messages,
        tools: options.tools,
        maxOutputTokens: limits.maxOutputTokensPerTurn,
        taskBudgetTokens: limits.taskBudgetTokens,
      });
    } catch (error) {
      throw error instanceof AiProviderError ? error : mapAnthropicError(error);
    }
    models.add(response.model);
    usage = addUsage(usage, response.usage);
    cost += budget.record(response.usage, options.model, response.model);

    if (response.stopReason === 'refusal') {
      return result({ kind: 'stopped', code: 'REFUSED' }, turn);
    }
    if (response.stopReason === 'max_tokens') {
      return result({ kind: 'stopped', code: 'OUTPUT_TRUNCATED' }, turn);
    }
    messages.push({
      role: 'assistant',
      text: response.text,
      toolCalls: response.toolCalls,
      providerState: response.providerState,
    });

    const calls = response.toolCalls;
    const submission = calls.find((call) =>
      options.submitTools.includes(call.name),
    );
    if (submission) {
      const problem =
        options.checkSubmission && repairs < MAX_REPAIRS
          ? await options.checkSubmission(submission.name, submission.input)
          : null;
      if (problem) {
        repairs++;
        messages.push({
          role: 'user',
          content: calls.map((call) => ({
            type: 'tool_result' as const,
            toolUseId: call.id,
            name: call.name,
            content:
              call === submission
                ? `Submission rejected: ${problem}. Call ${submission.name} again with arguments that match the schema exactly (correct types, no extra properties).`
                : 'Not executed; fix the submission first.',
            isError: true,
          })),
        });
        continue;
      }
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
        content: [
          {
            type: 'text',
            text: `Finish by calling ${options.submitTools.join(' or ')}.`,
          },
        ],
      });
      continue;
    }

    let allRepeats = true;
    const results: ({ type: 'tool_result' } & LlmToolResult)[] = [];
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
        toolUseId: call.id,
        name: call.name,
        content: execution.content,
        isError: execution.isError === true,
      });
    }
    messages.push({ role: 'user', content: results });

    repeatTurns = allRepeats ? repeatTurns + 1 : 0;
    if (repeatTurns >= LOOP_TURNS)
      return result({ kind: 'stopped', code: 'LOOP_DETECTED' }, turn);
  }
  return result({ kind: 'stopped', code: 'TURN_LIMIT' }, limits.maxTurns);
}
