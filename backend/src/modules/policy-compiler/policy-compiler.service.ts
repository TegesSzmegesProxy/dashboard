import { Injectable } from '@nestjs/common';
import {
  HTTP_METHODS,
  POLICY_SCHEMA_VERSION,
  TOOL_REGISTRY_VERSION,
} from '../../contracts/policy/v1/policy.contract.js';
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

  private invalidConfig(message: string): CompilationResult {
    return { ok: false, error: { code: 'INVALID_TOOL_CONFIG', message } };
  }
}
