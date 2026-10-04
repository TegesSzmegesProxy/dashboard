import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from '../../config/environment.js';
import { AiProviderError } from './ai-provider-error.js';
import { selectAi } from './ai-selection.js';
import { mapAnthropicError } from './anthropic-errors.js';
import { AnthropicLlmClient } from './llm/anthropic.client.js';
import { GeminiLlmClient } from './llm/gemini.client.js';
import type { LlmClient, LlmMode } from './llm/llm.types.js';

/** What the dashboard may know about the deployment's analysis model. */
export interface AnalysisAiStatus {
  configured: boolean;
  model: string;
  /** `local` is a self-hosted Anthropic-compatible server (no key sent). */
  mode: LlmMode | null;
}

/** Outcome of a live model check; the message is safe to show (no key, no URL). */
export interface AiModelCheckResult {
  ok: boolean;
  model: string;
  mode: LlmMode | null;
  latencyMs: number | null;
  error: { code: string; message: string } | null;
}

/**
 * The one AI model for analyses and policy edits, chosen by the deployment in
 * `.env` (ADR-0019, ADR-0020): `AI_MODEL`, and one of `ANTHROPIC_API_KEY`,
 * `GEMINI_API_KEY` or `AI_BASE_URL` for a local model. Nothing here is stored,
 * shown or editable in the dashboard, and the key never leaves this service.
 */
@Injectable()
export class AnalysisAiService {
  private readonly model: string;
  private readonly mode: LlmMode | null;
  private readonly apiKey: string | undefined;
  private readonly geminiKey: string | undefined;
  private readonly baseUrl: string | undefined;

  constructor(config: ConfigService<Environment, true>) {
    this.apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.geminiKey = config.get('GEMINI_API_KEY', { infer: true });
    this.baseUrl = config.get('AI_BASE_URL', { infer: true });
    const selection = selectAi({
      AI_PROVIDER: config.get('AI_PROVIDER', { infer: true }),
      AI_MODEL: config.get('AI_MODEL', { infer: true }),
      ANTHROPIC_API_KEY: this.apiKey,
      GEMINI_API_KEY: this.geminiKey,
      AI_BASE_URL: this.baseUrl,
    });
    // Startup validation already refused an ambiguous setup.
    if (!selection.ok) throw new Error(`AI model: ${selection.problem}`);
    this.model = selection.model;
    this.mode = selection.mode;
  }

  get status(): AnalysisAiStatus {
    return {
      configured: this.mode !== null,
      model: this.model,
      mode: this.mode,
    };
  }

  /**
   * Sends one minimal request to the configured model, to show the operator
   * whether it answers. Nothing from the project is sent, only a fixed prompt.
   */
  async check(): Promise<AiModelCheckResult> {
    const { model, mode } = this.status;
    const client = this.createClient(30_000, 0);
    if (!client) {
      return {
        ok: false,
        model,
        mode,
        latencyMs: null,
        error: {
          code: 'AI_NOT_CONFIGURED',
          message: 'No AI model is configured for this control plane',
        },
      };
    }
    const started = Date.now();
    try {
      const answered = await client.ping(model);
      return {
        ok: answered,
        model,
        mode,
        latencyMs: Date.now() - started,
        error: answered
          ? null
          : {
              code: 'EMPTY_RESPONSE',
              message: 'The model answered without any text',
            },
      };
    } catch (error) {
      const mapped =
        error instanceof AiProviderError ? error : mapAnthropicError(error);
      return {
        ok: false,
        model,
        mode,
        latencyMs: Date.now() - started,
        error: { code: mapped.code, message: mapped.message },
      };
    }
  }

  /** A client for one AI job, or null when `.env` configures no model. */
  createClient(timeout = 15 * 60_000, maxRetries = 2): LlmClient | null {
    if (this.mode === 'gemini' && this.geminiKey) {
      return GeminiLlmClient.create(this.geminiKey, timeout, maxRetries);
    }
    const common = { maxRetries, timeout };
    if (this.mode === 'local' && this.baseUrl) {
      return new AnthropicLlmClient(
        new Anthropic({
          ...common,
          baseURL: this.baseUrl,
          // A local model gets no key: explicit nulls keep the SDK from
          // reading ANTHROPIC_API_KEY from the environment and sending it
          // to that host.
          apiKey: null,
          authToken: null,
          defaultHeaders: { 'x-api-key': null },
          fetchOptions: { redirect: 'error' as const },
        }),
      );
    }
    return this.mode === 'anthropic' && this.apiKey
      ? new AnthropicLlmClient(
          new Anthropic({ ...common, apiKey: this.apiKey }),
        )
      : null;
  }
}
