import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from '../../config/environment.js';

/** What the dashboard may know about the deployment's analysis model. */
export interface AnalysisAiStatus {
  configured: boolean;
  model: string;
  /** `local` is a self-hosted Anthropic-compatible server (no key sent). */
  mode: 'anthropic' | 'local' | null;
}

/**
 * The AI model that analyses use, chosen by the deployment in `.env`
 * (ADR-0019): `ANTHROPIC_ANALYSIS_MODEL`, and either `ANTHROPIC_API_KEY` or
 * `ANALYSIS_AI_BASE_URL` for a local model. Nothing here is stored, shown or
 * editable in the dashboard, and the key never leaves this service.
 */
@Injectable()
export class AnalysisAiService {
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string | undefined;

  constructor(config: ConfigService<Environment, true>) {
    this.model = config.get('ANTHROPIC_ANALYSIS_MODEL', { infer: true });
    this.apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.baseUrl = config.get('ANALYSIS_AI_BASE_URL', { infer: true });
  }

  get status(): AnalysisAiStatus {
    return {
      configured: this.baseUrl !== undefined || this.apiKey !== undefined,
      model: this.model,
      mode: this.baseUrl ? 'local' : this.apiKey ? 'anthropic' : null,
    };
  }

  /** A client for one analysis job, or null when `.env` configures no model. */
  createClient(): Anthropic | null {
    const common = { maxRetries: 2, timeout: 15 * 60_000 };
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
