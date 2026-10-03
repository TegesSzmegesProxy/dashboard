import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { detectSecrets } from '../../common/secret-detection.js';
import {
  AiPolicyOutputDto,
  normalizeAiPolicyOutput,
} from '../../contracts/policy-generation/v1/ai-policy.contract.js';
import type { StructuredPolicyV1Dto } from '../../contracts/policy/v1/policy.contract.js';
import { AiProviderError } from '../../infrastructure/ai/application-analysis.provider.js';
import {
  PolicyGenerationAnalysisContext,
  PolicyGenerationInput,
  PolicyGenerationProvider,
} from '../../infrastructure/ai/policy-generation.provider.js';
import {
  AnalysesService,
  AnalysisPolicyContext,
} from '../analyses/analyses.service.js';
import {
  PolicyContent,
  PoliciesService,
} from '../policies/policies.service.js';
import { PolicyCompilerService } from '../policy-compiler/policy-compiler.service.js';
import type { CompiledPolicyV1 } from '../policy-compiler/policy-compiler.types.js';
import type {
  PolicyDiff,
  PolicyGenerationDocument,
  PolicyGenerationErrorCode,
  StringLengthBounds,
} from './policy-generation.types.js';

const MAX_VALIDATION_ISSUES = 20;

export interface GeneratedPolicy {
  humanReadableIntent: string;
  structuredPolicy: StructuredPolicyV1Dto;
  compiledPolicy: CompiledPolicyV1;
  limitations: string[];
  diff: PolicyDiff | null;
}

export type GenerationOutcome =
  | {
      kind: 'succeeded';
      policy: GeneratedPolicy;
      provenance: { aiProvider: string; aiModel: string };
    }
  | {
      kind: 'failed';
      errorCode: PolicyGenerationErrorCode;
      errorMessage: string;
      validationIssues: string[];
      provenance: PolicyGenerationDocument['provenance'];
    }
  | { kind: 'retry'; errorCode: PolicyGenerationErrorCode };

/**
 * Turns one attempt into a validated, compiled policy or a failure. AI output
 * is untrusted: it must match the contract, contain no detectable
 * credentials, compile against the tool registry and, when an analysis is
 * linked, reference only endpoints and fields known to it.
 */
@Injectable()
export class PolicyGenerationPipeline {
  constructor(
    private readonly provider: PolicyGenerationProvider,
    private readonly analyses: AnalysesService,
    private readonly policies: PoliciesService,
    private readonly compiler: PolicyCompilerService,
  ) {}

  async run(
    attempt: PolicyGenerationDocument,
    finalAttempt: boolean,
  ): Promise<GenerationOutcome> {
    const noProvenance = { aiProvider: null, aiModel: null };
    const fail = (
      errorCode: PolicyGenerationErrorCode,
      errorMessage: string,
      provenance: PolicyGenerationDocument['provenance'] = noProvenance,
      validationIssues: string[] = [],
    ): GenerationOutcome => ({
      kind: 'failed',
      errorCode,
      errorMessage,
      validationIssues,
      provenance,
    });

    let analysis: AnalysisPolicyContext | null = null;
    if (attempt.analysisId) {
      analysis = await this.analyses.findPolicyContext(
        attempt.organizationId,
        attempt.tenantId,
        attempt.analysisId,
      );
      if (!analysis) {
        return fail('ANALYSIS_UNAVAILABLE', 'The analysis is not available');
      }
    }
    let base: PolicyContent | null = null;
    if (attempt.kind === 'edit') {
      base = attempt.baseVersion
        ? await this.policies.findContent(
            attempt.organizationId,
            attempt.tenantId,
            attempt.baseVersion,
          )
        : null;
      if (!base || !attempt.instruction) {
        return fail(
          'BASE_POLICY_UNAVAILABLE',
          'The base policy version is not available',
        );
      }
    }

    const analysisContext = analysis ? this.toProviderContext(analysis) : null;
    let input: PolicyGenerationInput;
    if (base) {
      input = {
        mode: 'edit',
        analysis: analysisContext,
        basePolicy: {
          humanReadableIntent: base.humanReadableIntent,
          structuredPolicy: base.structuredPolicy,
        },
        instruction: attempt.instruction!,
      };
    } else if (analysisContext) {
      input = { mode: 'generate', analysis: analysisContext };
    } else {
      return fail('ANALYSIS_UNAVAILABLE', 'The analysis is not available');
    }

    let response;
    try {
      response = await this.provider.generate(input);
    } catch (error) {
      const providerError =
        error instanceof AiProviderError
          ? error
          : new AiProviderError('PROVIDER_ERROR', 'AI provider request failed');
      if (providerError.retryable && !finalAttempt) {
        return { kind: 'retry', errorCode: providerError.code };
      }
      return fail(providerError.code, providerError.message);
    }
    const provenance = {
      aiProvider: response.provider,
      aiModel: response.model,
    };

    // 1. Contract validation.
    const normalized = normalizeAiPolicyOutput(response.output);
    if (typeof normalized !== 'object' || normalized === null) {
      return fail(
        'INVALID_OUTPUT',
        'AI output did not match the policy generation contract',
        provenance,
      );
    }
    const dto = plainToInstance(AiPolicyOutputDto, normalized);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    if (errors.length > 0) {
      return fail(
        'INVALID_OUTPUT',
        'AI output did not match the policy generation contract',
        provenance,
        this.describeErrors(errors),
      );
    }
    // Plain JSON drops the undefined members class instances carry, so the
    // content hash and stored document match what the provider returned.
    const output = JSON.parse(JSON.stringify(dto)) as AiPolicyOutputDto;

    // 2. Credentials must never reach a stored policy.
    const secretRules = new Set(
      [output.humanReadableIntent, ...output.limitations]
        .flatMap((text) => detectSecrets(text))
        .map((finding) => finding.ruleId),
    );
    if (secretRules.size > 0) {
      return fail(
        'SECRET_DETECTED',
        'AI output contained a detectable credential',
        provenance,
        [...secretRules].map((rule) => `credential: ${rule}`),
      );
    }

    // 3. Compilation against the closed tool registry.
    const compilation = this.compiler.compile(output.structuredPolicy);
    if (!compilation.ok) {
      return fail(
        'COMPILATION_FAILED',
        'AI output did not compile against the tool registry',
        provenance,
        [`${compilation.error.code}: ${compilation.error.message}`],
      );
    }

    // 4. Grounding: no endpoints or fields the analysis does not know about.
    if (analysis) {
      const issues = this.ungrounded(
        output.structuredPolicy,
        analysis,
        base?.structuredPolicy ?? null,
      );
      if (issues.length > 0) {
        return fail(
          'UNGROUNDED_OUTPUT',
          'AI output referenced endpoints or fields unknown to the analysis',
          provenance,
          issues.slice(0, MAX_VALIDATION_ISSUES),
        );
      }
    }

    return {
      kind: 'succeeded',
      provenance,
      policy: {
        humanReadableIntent: output.humanReadableIntent,
        structuredPolicy: output.structuredPolicy,
        compiledPolicy: compilation.compiledPolicy,
        limitations: output.limitations,
        diff: base
          ? this.diff(
              base.structuredPolicy,
              output.structuredPolicy,
              base.humanReadableIntent.trim() !==
                output.humanReadableIntent.trim(),
            )
          : null,
      },
    };
  }

  private toProviderContext(
    analysis: AnalysisPolicyContext,
  ): PolicyGenerationAnalysisContext {
    // Evidence locations are omitted: they add tokens, not policy signal.
    return {
      endpoints: analysis.results.apiSurface.map((endpoint) => ({
        method: endpoint.method,
        path: endpoint.path,
        description: endpoint.description,
        fields: endpoint.fields.map((field) => ({
          name: field.name,
          location: field.location,
          type: field.type,
          required: field.required,
          constraints: field.constraints,
        })),
      })),
      configuration: analysis.results.configuration.map((item) => ({
        name: item.name,
        summary: item.summary,
      })),
      findings: analysis.results.findings.map((finding) => ({
        category: finding.category,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        basis: finding.basis,
      })),
    };
  }

  private ungrounded(
    policy: StructuredPolicyV1Dto,
    analysis: AnalysisPolicyContext,
    base: StructuredPolicyV1Dto | null,
  ): string[] {
    const known = new Map<string, Set<string>>();
    const add = (endpoint: string, targets: string[]): void => {
      const set = known.get(endpoint) ?? new Set<string>();
      targets.forEach((target) => set.add(target));
      known.set(endpoint, set);
    };
    for (const endpoint of analysis.results.apiSurface) {
      add(
        `${endpoint.method} ${endpoint.path}`,
        endpoint.fields.map((field) => field.name),
      );
    }
    for (const endpoint of base?.endpoints ?? []) {
      add(
        `${endpoint.method} ${endpoint.path}`,
        endpoint.tools.map((tool) => tool.target),
      );
    }
    const issues: string[] = [];
    policy.endpoints.forEach((endpoint, endpointIndex) => {
      const targets = known.get(`${endpoint.method} ${endpoint.path}`);
      if (!targets) {
        issues.push(`structuredPolicy.endpoints.${endpointIndex}: unknown`);
        return;
      }
      endpoint.tools.forEach((tool, toolIndex) => {
        if (!targets.has(tool.target)) {
          issues.push(
            `structuredPolicy.endpoints.${endpointIndex}.tools.${toolIndex}.target: unknown`,
          );
        }
      });
    });
    return issues;
  }

  private diff(
    before: StructuredPolicyV1Dto,
    after: StructuredPolicyV1Dto,
    humanReadableIntentChanged: boolean,
  ): PolicyDiff {
    const index = (policy: StructuredPolicyV1Dto) =>
      new Map(
        policy.endpoints.map((endpoint) => [
          `${endpoint.method} ${endpoint.path}`,
          new Map(
            endpoint.tools.map((tool) => [
              tool.target,
              this.bounds(tool.config),
            ]),
          ),
        ]),
      );
    const left = index(before);
    const right = index(after);
    const diff: PolicyDiff = {
      addedEndpoints: [...right.keys()].filter((key) => !left.has(key)),
      removedEndpoints: [...left.keys()].filter((key) => !right.has(key)),
      changedEndpoints: [],
      humanReadableIntentChanged,
    };
    for (const [endpoint, beforeTools] of left) {
      const afterTools = right.get(endpoint);
      if (!afterTools) continue;
      const change: PolicyDiff['changedEndpoints'][number] = {
        endpoint,
        addedTargets: [...afterTools.keys()].filter(
          (target) => !beforeTools.has(target),
        ),
        removedTargets: [...beforeTools.keys()].filter(
          (target) => !afterTools.has(target),
        ),
        changedTargets: [],
      };
      for (const [target, beforeBounds] of beforeTools) {
        const afterBounds = afterTools.get(target);
        if (
          afterBounds &&
          (afterBounds.minLength !== beforeBounds.minLength ||
            afterBounds.maxLength !== beforeBounds.maxLength)
        ) {
          change.changedTargets.push({
            target,
            before: beforeBounds,
            after: afterBounds,
          });
        }
      }
      if (
        change.addedTargets.length > 0 ||
        change.removedTargets.length > 0 ||
        change.changedTargets.length > 0
      ) {
        diff.changedEndpoints.push(change);
      }
    }
    return diff;
  }

  /** Normalizes stored bounds, which may carry nulls for absent values. */
  private bounds(config: StringLengthBounds): StringLengthBounds {
    const result: StringLengthBounds = {};
    if (typeof config.minLength === 'number') {
      result.minLength = config.minLength;
    }
    if (typeof config.maxLength === 'number') {
      result.maxLength = config.maxLength;
    }
    return result;
  }

  /** Flattens validation errors to paths and rule names, never values. */
  private describeErrors(errors: ValidationError[], prefix = ''): string[] {
    const issues: string[] = [];
    for (const error of errors) {
      // Unknown property names come from the AI output; keep them short.
      const property = error.property.slice(0, 100);
      const path = prefix ? `${prefix}.${property}` : property;
      for (const rule of Object.keys(error.constraints ?? {})) {
        issues.push(`${path}: ${rule}`);
      }
      issues.push(...this.describeErrors(error.children ?? [], path));
      if (issues.length >= MAX_VALIDATION_ISSUES) break;
    }
    return issues.slice(0, MAX_VALIDATION_ISSUES);
  }
}
