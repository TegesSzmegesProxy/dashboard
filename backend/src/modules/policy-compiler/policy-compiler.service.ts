import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import {
  HTTP_METHODS,
  POLICY_SCHEMA_VERSION,
  TOOL_REGISTRY_VERSION,
} from '../../contracts/policy/v1/policy.contract.js';
import {
  MAX_ENDPOINTS_V2,
  StructuredPolicyV2,
  StructuredPolicyV2Dto,
  toolPlacementIssues,
} from '../../contracts/policy/v2/policy.contract.js';
import {
  CompilationResult,
  CompiledEndpointPolicy,
  CompiledToolStep,
  PolicyInput,
} from './policy-compiler.types.js';

@Injectable()
export class PolicyCompilerService {
  compile(policy: PolicyInput): CompilationResult {
    if (
      !policy ||
      typeof policy !== 'object' ||
      policy.schemaVersion !== POLICY_SCHEMA_VERSION ||
      !Array.isArray(policy.endpoints) ||
      policy.endpoints.length === 0 ||
      policy.endpoints.length > 500
    ) {
      return this.invalidConfig('Invalid policy contract');
    }
    const endpoints = new Set<string>();
    const compiledEndpoints: CompiledEndpointPolicy[] = [];

    for (const endpoint of policy.endpoints) {
      if (
        !endpoint ||
        typeof endpoint !== 'object' ||
        !HTTP_METHODS.some((method) => method === endpoint.method) ||
        typeof endpoint.path !== 'string' ||
        endpoint.path.length > 1024 ||
        !/^\/(?!.*[?#\s]).*$/.test(endpoint.path) ||
        !Array.isArray(endpoint.tools) ||
        endpoint.tools.length === 0 ||
        endpoint.tools.length > 100
      ) {
        return this.invalidConfig('Invalid endpoint contract');
      }
      const endpointKey = `${endpoint.method} ${endpoint.path}`;
      if (endpoints.has(endpointKey)) {
        return this.invalidConfig(`Duplicate endpoint: ${endpointKey}`);
      }
      endpoints.add(endpointKey);
      const steps: CompiledToolStep[] = [];
      const stepKeys = new Set<string>();

      for (const tool of endpoint.tools) {
        if (!tool || typeof tool !== 'object') {
          return this.invalidConfig('Invalid tool contract');
        }
        if (tool.toolId !== 'string_length') {
          return {
            ok: false,
            error: {
              code: 'UNKNOWN_TOOL',
              message: `Unknown tool id: ${tool.toolId}`,
            },
          };
        }
        if (
          typeof tool.target !== 'string' ||
          !/^(body|query)\.[^\s]+$/.test(tool.target) ||
          tool.target.length === 0 ||
          tool.target.length > 512 ||
          !tool.config ||
          typeof tool.config !== 'object' ||
          Array.isArray(tool.config)
        ) {
          return this.invalidConfig('Invalid string_length contract');
        }
        if (
          Object.keys(tool.config).some(
            (key) => key !== 'minLength' && key !== 'maxLength',
          )
        ) {
          return this.invalidConfig('Unknown string_length configuration');
        }
        const stepKey = `${tool.toolId}:${tool.target}`;
        if (stepKeys.has(stepKey)) {
          return this.invalidConfig(`Duplicate tool target: ${stepKey}`);
        }
        stepKeys.add(stepKey);
        const { minLength, maxLength } = tool.config;
        if (
          (minLength !== undefined &&
            (!Number.isInteger(minLength) ||
              minLength < 0 ||
              minLength > 1_000_000)) ||
          (maxLength !== undefined &&
            (!Number.isInteger(maxLength) ||
              maxLength < 0 ||
              maxLength > 1_000_000))
        ) {
          return this.invalidConfig('Invalid string_length bounds');
        }
        if (minLength === undefined && maxLength === undefined) {
          return this.invalidConfig(
            'string_length requires minLength or maxLength',
          );
        }
        if (
          minLength !== undefined &&
          maxLength !== undefined &&
          minLength > maxLength
        ) {
          return this.invalidConfig(
            'string_length minLength cannot exceed maxLength',
          );
        }
        const config: CompiledToolStep['config'] = {};
        if (minLength !== undefined) config.minLength = minLength;
        if (maxLength !== undefined) config.maxLength = maxLength;
        steps.push({
          toolId: 'string_length',
          contextType: 'field',
          target: tool.target,
          config,
        });
      }
      compiledEndpoints.push({
        method: endpoint.method,
        path: endpoint.path,
        steps,
      });
    }

    return {
      ok: true,
      compiledPolicy: {
        schemaVersion: POLICY_SCHEMA_VERSION,
        toolRegistryVersion: TOOL_REGISTRY_VERSION,
        endpoints: compiledEndpoints,
      },
    };
  }

  /**
   * Checks a `tessera.policy/v2` policy against its contract and the
   * placement rules of `tessera.tools/v2`. Tools carry no configuration, so
   * the compiled form is the structured policy itself; only issues are
   * returned, as contract paths without values.
   */
  compileV2(policy: StructuredPolicyV2): { ok: boolean; issues: string[] } {
    const issues = flattenValidation(
      validateSync(plainToInstance(StructuredPolicyV2Dto, policy), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    if (issues.length > 0) return { ok: false, issues };
    if (
      policy.endpoints.length === 0 ||
      policy.endpoints.length > MAX_ENDPOINTS_V2
    ) {
      issues.push('endpoints: count');
    }
    const seen = new Set<string>();
    policy.endpoints.forEach((endpoint, index) => {
      const key = `${endpoint.method} ${endpoint.path}`;
      if (seen.has(key)) issues.push(`endpoints.${index}: duplicate`);
      seen.add(key);
      issues.push(...toolPlacementIssues(endpoint, `endpoints.${index}`));
    });
    return { ok: issues.length === 0, issues };
  }

  private invalidConfig(message: string): CompilationResult {
    return { ok: false, error: { code: 'INVALID_TOOL_CONFIG', message } };
  }
}

function flattenValidation(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((error) => {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    const own = Object.keys(error.constraints ?? {}).map(
      (rule) => `${path}: ${rule}`,
    );
    return [...own, ...flattenValidation(error.children ?? [], path)];
  });
}
