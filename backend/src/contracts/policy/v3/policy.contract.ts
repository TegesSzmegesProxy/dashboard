import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsMongoId,
  IsObject,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { canonicalJson, JsonValue } from '../../../common/canonical-json.js';
import {
  findToolV3,
  TOOL_REGISTRY_V3,
  validateToolConfig,
} from '../../tools/v3/tool-registry.js';
import { HTTP_METHODS } from '../v1/policy.contract.js';
import type { PolicyHttpMethod } from '../v1/policy.contract.js';
import {
  ENDPOINT_PATH_PATTERN,
  FIELD_LOCATIONS_V2,
  FIELD_NAME_PATTERN,
  MAX_ENDPOINT_JEV_CONTEXT,
  MAX_ENDPOINTS_V2,
  MAX_FIELD_HUMAN_READABLE_POLICY,
  MAX_FIELD_JEV_CONTEXT,
  MAX_FIELDS_PER_ENDPOINT,
  MAX_HUMAN_READABLE_POLICY,
  MAX_TOOLS_PER_ELEMENT,
} from '../v2/policy.contract.js';
import type { FieldLocationV2 } from '../v2/policy.contract.js';

/**
 * `tessera.policy/v3` (ADR-0021): policies in three scopes.
 * - `global`: cross-cutting rules found in the code (middleware, parsers,
 *   framework limits); they apply to every request.
 * - `environment`: rules derived from an environment snapshot (scanner
 *   findings, vulnerable packages, exposed services); they also apply to
 *   every request, and record the snapshot they came from.
 * - `endpoints`: rules for one endpoint and its fields, as in v2.
 *
 * Tools carry a configuration validated against the proxy's
 * `tessera.tools/v3` schemas. When the same tool and target appear in more
 * than one scope, the most specific one runs (endpoint, then environment,
 * then global). Human-readable policies are never enforced or distributed.
 */
export const POLICY_SCHEMA_V3 = 'tessera.policy/v3' as const;

/** Locations whose fields the proxy inspects; scope field tools target every field of one. */
export const SCOPE_FIELD_LOCATIONS = ['body', 'query'] as const;
export type ScopeFieldLocation = (typeof SCOPE_FIELD_LOCATIONS)[number];
/** Field locations the proxy can attach field tools to today. */
export const ENFORCEABLE_FIELD_LOCATIONS: ReadonlySet<FieldLocationV2> =
  new Set(['body', 'query']);

export const MAX_SCOPE_JEV_CONTEXT = 1_500;
export const MAX_SCOPE_TOOLS = 50;
/** Canonical JSON length of one tool's configuration. */
export const MAX_TOOL_CONFIG_LENGTH = 16_384;

export class PolicyToolV3Dto {
  @IsString()
  @MaxLength(64)
  toolId!: string;

  /** Validated against the tool's schema by `toolIssuesV3`, not here. */
  @IsObject()
  config!: Record<string, unknown>;
}

export class ScopeFieldToolV3Dto extends PolicyToolV3Dto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SCOPE_FIELD_LOCATIONS.length)
  @IsIn(SCOPE_FIELD_LOCATIONS, { each: true })
  locations!: ScopeFieldLocation[];
}

export class ScopePolicyV3Dto {
  @IsString()
  @MaxLength(MAX_HUMAN_READABLE_POLICY)
  humanReadablePolicy!: string;

  /** Scope `full` tools: they inspect the whole request. */
  @IsArray()
  @ArrayMaxSize(MAX_SCOPE_TOOLS)
  @ValidateNested({ each: true })
  @Type(() => PolicyToolV3Dto)
  requestTools!: PolicyToolV3Dto[];

  /** Scope `field` tools run on every field of the listed locations. */
  @IsArray()
  @ArrayMaxSize(MAX_SCOPE_TOOLS)
  @ValidateNested({ each: true })
  @Type(() => ScopeFieldToolV3Dto)
  fieldTools!: ScopeFieldToolV3Dto[];

  @ValidateIf((scope: ScopePolicyV3Dto) => scope.jevContext !== null)
  @IsString()
  @MaxLength(MAX_SCOPE_JEV_CONTEXT)
  jevContext!: string | null;
}

export class EnvironmentScopePolicyV3Dto extends ScopePolicyV3Dto {
  /** The snapshot the environment policies were derived from. */
  @ValidateIf(
    (scope: EnvironmentScopePolicyV3Dto) =>
      scope.environmentSnapshotId !== null,
  )
  @IsMongoId()
  environmentSnapshotId!: string | null;
}

export class FieldPolicyV3Dto {
  @IsString()
  @Matches(FIELD_NAME_PATTERN)
  name!: string;

  @IsIn(FIELD_LOCATIONS_V2)
  location!: FieldLocationV2;

  @IsString()
  @MaxLength(64)
  type!: string;

  @IsBoolean()
  required!: boolean;

  @IsString()
  @MaxLength(MAX_FIELD_HUMAN_READABLE_POLICY)
  humanReadablePolicy!: string;

  @IsArray()
  @ArrayMaxSize(MAX_TOOLS_PER_ELEMENT)
  @ValidateNested({ each: true })
  @Type(() => PolicyToolV3Dto)
  tools!: PolicyToolV3Dto[];

  @ValidateIf((field: FieldPolicyV3Dto) => field.jevContext !== null)
  @IsString()
  @MaxLength(MAX_FIELD_JEV_CONTEXT)
  jevContext!: string | null;
}

export class EndpointPolicyV3Dto {
  @IsIn(HTTP_METHODS)
  method!: PolicyHttpMethod;

  @IsString()
  @Matches(ENDPOINT_PATH_PATTERN)
  @MaxLength(1024)
  path!: string;

  @IsString()
  @MaxLength(MAX_HUMAN_READABLE_POLICY)
  humanReadablePolicy!: string;

  @IsArray()
  @ArrayMaxSize(MAX_TOOLS_PER_ELEMENT)
  @ValidateNested({ each: true })
  @Type(() => PolicyToolV3Dto)
  requestTools!: PolicyToolV3Dto[];

  @ValidateIf((endpoint: EndpointPolicyV3Dto) => endpoint.jevContext !== null)
  @IsString()
  @MaxLength(MAX_ENDPOINT_JEV_CONTEXT)
  jevContext!: string | null;

  @IsArray()
  @ArrayMaxSize(MAX_FIELDS_PER_ENDPOINT)
  @ValidateNested({ each: true })
  @Type(() => FieldPolicyV3Dto)
  fields!: FieldPolicyV3Dto[];
}

export class StructuredPolicyV3Dto {
  @IsIn([POLICY_SCHEMA_V3])
  schemaVersion!: typeof POLICY_SCHEMA_V3;

  @IsIn([TOOL_REGISTRY_V3])
  toolRegistryVersion!: typeof TOOL_REGISTRY_V3;

  @ValidateNested()
  @Type(() => ScopePolicyV3Dto)
  global!: ScopePolicyV3Dto;

  @ValidateNested()
  @Type(() => EnvironmentScopePolicyV3Dto)
  environment!: EnvironmentScopePolicyV3Dto;

  @IsArray()
  @ArrayMaxSize(MAX_ENDPOINTS_V2)
  @ValidateNested({ each: true })
  @Type(() => EndpointPolicyV3Dto)
  endpoints!: EndpointPolicyV3Dto[];
}

/** Plain shapes of the DTOs above, for stored documents and views. */
export interface PolicyToolV3 {
  toolId: string;
  config: Record<string, unknown>;
}

export interface ScopeFieldToolV3 extends PolicyToolV3 {
  locations: ScopeFieldLocation[];
}

export interface ScopePolicyV3 {
  humanReadablePolicy: string;
  requestTools: PolicyToolV3[];
  fieldTools: ScopeFieldToolV3[];
  jevContext: string | null;
}

export interface EnvironmentScopePolicyV3 extends ScopePolicyV3 {
  environmentSnapshotId: string | null;
}

export interface FieldPolicyV3 {
  name: string;
  location: FieldLocationV2;
  type: string;
  required: boolean;
  humanReadablePolicy: string;
  tools: PolicyToolV3[];
  jevContext: string | null;
}

export interface EndpointPolicyV3 {
  method: PolicyHttpMethod;
  path: string;
  humanReadablePolicy: string;
  requestTools: PolicyToolV3[];
  jevContext: string | null;
  fields: FieldPolicyV3[];
}

export interface StructuredPolicyV3 {
  schemaVersion: typeof POLICY_SCHEMA_V3;
  toolRegistryVersion: typeof TOOL_REGISTRY_V3;
  global: ScopePolicyV3;
  environment: EnvironmentScopePolicyV3;
  endpoints: EndpointPolicyV3[];
}

export type PolicyScopeName = 'global' | 'environment';

/**
 * One tool at the scope its placement requires, with a configuration the
 * proxy accepts. Returns contract paths of violations, never values.
 */
export function toolIssuesV3(
  tool: PolicyToolV3,
  expectedScope: 'field' | 'file' | 'full',
  path: string,
): string[] {
  const definition = findToolV3(tool.toolId);
  if (!definition) return [`${path}.toolId: unknown`];
  const issues: string[] = [];
  if (definition.scope !== expectedScope) issues.push(`${path}: scope`);
  // Their configuration is secret material or a data feed, which policies
  // never store; they are configured with the proxy deployment instead.
  if (!definition.aiSelectable)
    issues.push(`${path}: operator-configured tool`);
  if (
    canonicalJson(tool.config as unknown as JsonValue).length >
    MAX_TOOL_CONFIG_LENGTH
  ) {
    issues.push(`${path}.config: size`);
  } else {
    issues.push(
      ...validateToolConfig(tool.toolId, tool.config).map(
        (issue) => `${path}.${issue}`,
      ),
    );
  }
  return issues;
}

/**
 * Placement and configuration rules of ADR-0021 for a whole policy: `full`
 * tools on scopes and endpoints, `field` tools on scope locations and on
 * body or query fields, `file` tools only on `file` fields, no duplicates
 * per element, and every configuration valid for its tool.
 */
export function policyIssuesV3(policy: StructuredPolicyV3): string[] {
  const issues: string[] = [];
  const scope = (name: PolicyScopeName, value: ScopePolicyV3) => {
    const requestIds = new Set<string>();
    value.requestTools.forEach((tool, index) => {
      const path = `${name}.requestTools.${index}`;
      issues.push(...toolIssuesV3(tool, 'full', path));
      if (requestIds.has(tool.toolId)) issues.push(`${path}: duplicate`);
      requestIds.add(tool.toolId);
    });
    const fieldKeys = new Set<string>();
    value.fieldTools.forEach((tool, index) => {
      const path = `${name}.fieldTools.${index}`;
      issues.push(...toolIssuesV3(tool, 'field', path));
      if (new Set(tool.locations).size !== tool.locations.length) {
        issues.push(`${path}.locations: duplicate`);
      }
      for (const location of tool.locations) {
        const key = `${tool.toolId}:${location}`;
        if (fieldKeys.has(key)) issues.push(`${path}: duplicate`);
        fieldKeys.add(key);
      }
    });
  };
  scope('global', policy.global);
  scope('environment', policy.environment);

  const endpoints = new Set<string>();
  policy.endpoints.forEach((endpoint, index) => {
    const prefix = `endpoints.${index}`;
    const key = `${endpoint.method} ${endpoint.path}`;
    if (endpoints.has(key)) issues.push(`${prefix}: duplicate`);
    endpoints.add(key);
    const requestIds = new Set<string>();
    endpoint.requestTools.forEach((tool, toolIndex) => {
      const path = `${prefix}.requestTools.${toolIndex}`;
      issues.push(...toolIssuesV3(tool, 'full', path));
      if (requestIds.has(tool.toolId)) issues.push(`${path}: duplicate`);
      requestIds.add(tool.toolId);
    });
    const fieldKeys = new Set<string>();
    endpoint.fields.forEach((field, fieldIndex) => {
      const fieldPrefix = `${prefix}.fields.${fieldIndex}`;
      const fieldKey = `${field.location}:${field.name}`;
      if (fieldKeys.has(fieldKey)) issues.push(`${fieldPrefix}: duplicate`);
      fieldKeys.add(fieldKey);
      if (
        field.tools.length > 0 &&
        field.location !== 'file' &&
        !ENFORCEABLE_FIELD_LOCATIONS.has(field.location)
      ) {
        issues.push(`${fieldPrefix}.location: not enforceable`);
      }
      const toolIds = new Set<string>();
      field.tools.forEach((tool, toolIndex) => {
        const path = `${fieldPrefix}.tools.${toolIndex}`;
        issues.push(
          ...toolIssuesV3(
            tool,
            field.location === 'file' ? 'file' : 'field',
            path,
          ),
        );
        if (toolIds.has(tool.toolId)) issues.push(`${path}: duplicate`);
        toolIds.add(tool.toolId);
      });
    });
  });
  return issues;
}
