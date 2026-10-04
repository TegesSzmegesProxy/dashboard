import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from '../../config/environment.js';
import { mapAnthropicError } from './anthropic-errors.js';

/** What the dashboard may know about the deployment's analysis model. */
export interface AnalysisAiStatus {
  configured: boolean;
  model: string;
  /** `local` is a self-hosted Anthropic-compatible server (no key sent). */
  mode: 'anthropic' | 'local' | null;
}

/** Outcome of a live model check; the message is safe to show (no key, no URL). */
export interface AiModelCheckResult {
  ok: boolean;
  model: string;
  mode: 'anthropic' | 'local' | null;
  latencyMs: number | null;
  error: { code: string; message: string } | null;
}

/**
 * The one AI model for analyses and policy edits, chosen by the deployment in
 * `.env` (ADR-0019): `AI_MODEL`, and either `ANTHROPIC_API_KEY` or
 * `AI_BASE_URL` for a local model. Nothing here is stored, shown or editable
 * in the dashboard, and the key never leaves this service.
 */
@Injectable()
export class AnalysisAiService {
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string | undefined;

  constructor(config: ConfigService<Environment, true>) {
    this.model = config.get('AI_MODEL', { infer: true });
    this.apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.baseUrl = config.get('AI_BASE_URL', { infer: true });
  }

  get status(): AnalysisAiStatus {
    return {
      configured: this.baseUrl !== undefined || this.apiKey !== undefined,
      model: this.model,
      mode: this.baseUrl ? 'local' : this.apiKey ? 'anthropic' : null,
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
      const message = await client.messages.create({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the word OK.' }],
      });
      const answered = message.content.some(
        (block) => block.type === 'text' && block.text.trim().length > 0,
      );
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
      const mapped = mapAnthropicError(error);
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
  createClient(timeout = 15 * 60_000, maxRetries = 2): Anthropic | null {
    const common = { maxRetries, timeout };
    if (this.baseUrl) {
      return new Anthropic({
        ...common,
        baseURL: this.baseUrl,
        // A local model gets no key: explicit nulls keep the SDK from reading
        // ANTHROPIC_API_KEY from the environment and sending it to that host.
        apiKey: null,
        authToken: null,
        defaultHeaders: { 'x-api-key': null },
        fetchOptions: { redirect: 'error' as const },
      });
    }
    return this.apiKey
      ? new Anthropic({ ...common, apiKey: this.apiKey })
      : null;
  }
}
