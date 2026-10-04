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
  ENFORCEABLE_FIELD_LOCATIONS,
  POLICY_SCHEMA_V3,
  policyIssuesV3,
  PolicyToolV3,
  ScopePolicyV3,
  StructuredPolicyV3,
  StructuredPolicyV3Dto,
} from '../../contracts/policy/v3/policy.contract.js';
import { TOOL_REGISTRY_V3 } from '../../contracts/tools/v3/tool-registry.js';
import {
  CompilationResult,
  CompilationResultV3,
  CompiledEndpointPolicy,
  CompiledEndpointPolicyV3,
  CompiledScopeV3,
  CompiledStepV3,
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

  /**
   * Compiles a `tessera.policy/v3` policy into the steps and JEV context the
   * proxy runs (ADR-0021). Every tool is placed at its scope and its
   * configuration is checked against the vendored `tessera.tools/v3`
   * schemas. Human-readable policy is never compiled. Steps are sorted so
   * equal policies compile to equal bytes.
   */
  compileV3(policy: StructuredPolicyV3): CompilationResultV3 {
    const issues = flattenValidation(
      validateSync(plainToInstance(StructuredPolicyV3Dto, policy), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    if (issues.length > 0) return { ok: false, issues };
    issues.push(...policyIssuesV3(policy));
    if (issues.length > 0) return { ok: false, issues };

    const scope = (value: ScopePolicyV3): CompiledScopeV3 => ({
      steps: sortSteps([
        ...value.requestTools.map((tool) => step(tool, 'full')),
        ...value.fieldTools.flatMap((tool) =>
          tool.locations.map((location) =>
            step(tool, 'field', `${location}.*`),
          ),
        ),
      ]),
      jevContext: value.jevContext,
    });
    const global = scope(policy.global);
    const environment = {
      ...scope(policy.environment),
      environmentSnapshotId: policy.environment.environmentSnapshotId,
    };
    const endpoints: CompiledEndpointPolicyV3[] = policy.endpoints.map(
      (endpoint) => ({
        method: endpoint.method,
        path: endpoint.path,
        steps: sortSteps([
          ...endpoint.requestTools.map((tool) => step(tool, 'full')),
          ...endpoint.fields.flatMap((field) =>
            field.tools.map((tool) =>
              field.location === 'file'
                ? step(tool, 'file', field.name)
                : step(tool, 'field', `${field.location}.${field.name}`),
            ),
          ),
        ]),
        jevContext: endpoint.jevContext,
        // The proxy inspects body and query fields; other locations' context
        // stays in the policy for reviewers.
        fieldContexts: endpoint.fields
          .filter(
            (field): field is typeof field & { jevContext: string } =>
              field.jevContext !== null &&
              ENFORCEABLE_FIELD_LOCATIONS.has(field.location),
          )
          .map((field) => ({
            target: `${field.location}.${field.name}`,
            jevContext: field.jevContext,
          })),
      }),
    );

    const overrides: { endpoint: string | null; message: string }[] = [];
    const scopeKeys = (value: CompiledScopeV3) =>
      new Set(value.steps.map(stepKey));
    const globalKeys = scopeKeys(global);
    const environmentKeys = scopeKeys(environment);
    for (const key of environmentKeys) {
      if (globalKeys.has(key)) {
        overrides.push({
          endpoint: null,
          message: `Environment step ${key} replaces the global one.`,
        });
      }
    }
    for (const endpoint of endpoints) {
      for (const key of endpoint.steps.map(stepKey)) {
        const replaced = environmentKeys.has(key)
          ? 'environment'
          : globalKeys.has(key)
            ? 'global'
            : null;
        if (replaced) {
          overrides.push({
            endpoint: `${endpoint.method} ${endpoint.path}`,
            message: `Endpoint step ${key} replaces the ${replaced} one.`,
          });
        }
      }
    }
    const tooMany = [
      ...(global.steps.length > MAX_STEPS ? ['global.steps: count'] : []),
      ...(environment.steps.length > MAX_STEPS
        ? ['environment.steps: count']
        : []),
      ...endpoints.flatMap((endpoint, index) =>
        endpoint.steps.length > MAX_STEPS
          ? [`endpoints.${index}.steps: count`]
          : [],
      ),
    ];
    if (tooMany.length > 0) return { ok: false, issues: tooMany };

    return {
      ok: true,
      compiledPolicy: {
        schemaVersion: POLICY_SCHEMA_V3,
        toolRegistryVersion: TOOL_REGISTRY_V3,
        global,
        environment,
        endpoints,
      },
      overrides,
    };
  }

  private invalidConfig(message: string): CompilationResult {
    return { ok: false, error: { code: 'INVALID_TOOL_CONFIG', message } };
  }
}

/** Steps per scope or endpoint that a `tessera.bundle/v3` accepts. */
const MAX_STEPS = 100;

function step(
  tool: PolicyToolV3,
  contextType: CompiledStepV3['contextType'],
  target?: string,
): CompiledStepV3 {
  return {
    toolId: tool.toolId,
    contextType,
    ...(target === undefined ? {} : { target }),
    config: tool.config,
  };
}

const stepKey = (value: CompiledStepV3) =>
  `${value.toolId}:${value.target ?? ''}`;

function sortSteps(steps: CompiledStepV3[]): CompiledStepV3[] {
  return [...steps].sort((a, b) =>
    stepKey(a) < stepKey(b) ? -1 : stepKey(a) > stepKey(b) ? 1 : 0,
  );
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
