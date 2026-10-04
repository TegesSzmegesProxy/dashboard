import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from 'ajv/dist/2020.js';
import { findTool as findToolV2 } from '../v2/tool-registry.js';
import { TOOL_REGISTRY_V3_DOCUMENT } from './tool-registry.document.js';

/**
 * `tessera.tools/v3`: the proxy's tools with their configuration schemas. The
 * tools, scopes and schemas come from the proxy's generated registry
 * (`scripts/sync-tool-registry.mjs`); this module adds what only the dashboard
 * needs: when an analysis should choose a tool, whether it needs runtime
 * state, and whether the model may choose it at all.
 *
 * This module is the single source for the v3 compiler, the model's tool
 * documentation and config validation.
 */
export const TOOL_REGISTRY_V3 = 'tessera.tools/v3' as const;

export type ToolScopeV3 = 'field' | 'file' | 'full';

export interface ToolDefinitionV3 {
  id: string;
  /** Short name for people, e.g. in the policy editor. */
  label: string;
  /** What the proxy checks, in one plain sentence. */
  summary: string;
  category: string;
  scope: ToolScopeV3;
  /** When an analysis should choose the tool; shown to the model. */
  useWhen: string;
  /** The tool needs runtime state (rates, sequences) that code rarely shows. */
  stateful: boolean;
  /**
   * False for tools whose configuration is operator secret material or a
   * data feed (keys, cookie secrets, GeoIP or reputation tables). Policies
   * never store those, so no policy may select these tools; the model must
   * never invent them.
   */
  aiSelectable: boolean;
  /** Top-level settings the proxy requires; empty when every setting has a default. */
  requiredSettings: string[];
  /** JSON Schema of the configuration, as the proxy accepts it. */
  configSchema: Record<string, unknown>;
}

/** Configured by operators only: secrets, keys and data feeds. */
const OPERATOR_CONFIGURED = new Set([
  'cookie_tampering',
  'jwt_validation',
  'ip_reputation',
  'geo_policy',
  'impossible_travel',
  'datacenter_asn',
  'tor_exit_node',
]);

/** Tools that keep state across requests in the proxy (they receive a `ToolState`). */
const STATEFUL = new Set([
  'account_enumeration',
  'brute_force',
  'concurrent_connections',
  'credential_stuffing',
  'duplicate_request',
  'endpoint_quota',
  'impossible_travel',
  'not_found_spike',
  'oauth_flow_validation',
  'otp_brute_force',
  'password_spraying',
  'rate_limit',
  'response_size_anomaly',
  'scraping_pattern',
  'sequence_analysis',
  'session_binding',
  'sms_email_pumping',
  'timestamp_replay',
  'timing_anomaly',
  'token_replay',
  'websocket_abuse',
]);

export const TOOL_DEFINITIONS_V3: readonly ToolDefinitionV3[] =
  TOOL_REGISTRY_V3_DOCUMENT.tools.map((tool) => {
    const v2 = findToolV2(tool.id);
    const required = tool.config['required'];
    return {
      id: tool.id,
      label: v2?.label ?? tool.displayName,
      summary: tool.description,
      category: tool.category,
      scope: tool.contextType,
      useWhen: v2?.useWhen ?? tool.description,
      stateful: STATEFUL.has(tool.id),
      aiSelectable: !OPERATOR_CONFIGURED.has(tool.id),
      requiredSettings: Array.isArray(required)
        ? required.filter((key): key is string => typeof key === 'string')
        : [],
      configSchema: tool.config,
    };
  });

export const TOOL_IDS_V3 = TOOL_DEFINITIONS_V3.map((tool) => tool.id);

/** The tools a model may choose: every tool that is not operator-configured. */
export const AI_TOOL_IDS_V3 = TOOL_DEFINITIONS_V3.filter(
  (tool) => tool.aiSelectable,
).map((tool) => tool.id);

const BY_ID = new Map(TOOL_DEFINITIONS_V3.map((tool) => [tool.id, tool]));

export function findToolV3(id: string): ToolDefinitionV3 | undefined {
  return BY_ID.get(id);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addFormat('uri', (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol.length > 1;
  } catch {
    return false;
  }
});
const validators = new Map<string, ValidateFunction>(
  TOOL_DEFINITIONS_V3.map((tool) => [tool.id, ajv.compile(tool.configSchema)]),
);

/** Contract paths and keywords of config violations, never the values. */
function describe(error: ErrorObject): string {
  const path = error.instancePath
    ? error.instancePath.slice(1).replaceAll('/', '.')
    : '';
  const missing =
    error.keyword === 'required' && typeof error.params === 'object'
      ? `.${String((error.params as { missingProperty?: unknown }).missingProperty)}`
      : '';
  const extra =
    error.keyword === 'additionalProperties' && typeof error.params === 'object'
      ? `.${String((error.params as { additionalProperty?: unknown }).additionalProperty)}`
      : '';
  return `config${path ? `.${path}` : ''}${missing}${extra}: ${error.keyword}`;
}

/**
 * Checks a tool's configuration against the proxy's schema. Returns issues as
 * contract paths without values; empty when valid. The proxy re-validates
 * with its own contract (including refinements JSON Schema cannot express)
 * when it fetches the bundle.
 */
export function validateToolConfig(toolId: string, config: unknown): string[] {
  const validate = validators.get(toolId);
  if (!validate) return ['toolId: unknown'];
  if (validate(config)) return [];
  const issues = (validate.errors ?? []).map(describe);
  return [...new Set(issues)].slice(0, 20);
}
