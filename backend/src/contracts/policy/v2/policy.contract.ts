import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  findTool,
  TOOL_IDS,
  TOOL_REGISTRY_V2,
} from '../../tools/v2/tool-registry.js';
import type { ToolId } from '../../tools/v2/tool-registry.js';
import { HTTP_METHODS } from '../v1/policy.contract.js';
import type { PolicyHttpMethod } from '../v1/policy.contract.js';

/**
 * `tessera.policy/v2` (ADR-0010): endpoint policies shaped like the proxy's
 * `EndpointPolicy` (`requestTools`, `fields[].tools`, `jevContext`), plus an
 * editable human-readable policy. Tools carry no configuration yet, and
 * endpoint `sampling` is still configured by the user, not by analysis.
 */
export const POLICY_SCHEMA_V2 = 'tessera.policy/v2' as const;
export const FIELD_LOCATIONS_V2 = [
  'body',
  'query',
  'path',
  'header',
  'cookie',
  'file',
] as const;
export type FieldLocationV2 = (typeof FIELD_LOCATIONS_V2)[number];

export const MAX_HUMAN_READABLE_POLICY = 2_000;
export const MAX_ENDPOINT_JEV_CONTEXT = 1_500;
export const MAX_FIELD_JEV_CONTEXT = 500;
export const MAX_ENDPOINTS_V2 = 500;
export const MAX_FIELDS_PER_ENDPOINT = 200;
export const MAX_TOOLS_PER_ELEMENT = 20;
/** Dot path with `[]` for array items, e.g. `items[].sku`. */
// eslint-disable-next-line no-control-regex
export const FIELD_NAME_PATTERN = /^[^\s\u0000-\u001f]{1,512}$/;
export const ENDPOINT_PATH_PATTERN = /^\/(?!.*[?#\s]).*$/;

export class PolicyToolV2Dto {
  @IsIn(TOOL_IDS)
  toolId!: ToolId;
}

export class FieldPolicyV2Dto {
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

  @IsArray()
  @ArrayMaxSize(MAX_TOOLS_PER_ELEMENT)
  @ValidateNested({ each: true })
  @Type(() => PolicyToolV2Dto)
  tools!: PolicyToolV2Dto[];

  @ValidateIf((field: FieldPolicyV2Dto) => field.jevContext !== null)
  @IsString()
  @MaxLength(MAX_FIELD_JEV_CONTEXT)
  jevContext!: string | null;
}

export class EndpointPolicyV2Dto {
  @IsIn(HTTP_METHODS)
  method!: PolicyHttpMethod;

  @IsString()
  @Matches(ENDPOINT_PATH_PATTERN)
  @MaxLength(1024)
  path!: string;

  @IsString()
  @MaxLength(MAX_HUMAN_READABLE_POLICY)
  humanReadablePolicy!: string;

  /** Scope `full` tools: they inspect the whole request. */
  @IsArray()
  @ArrayMaxSize(MAX_TOOLS_PER_ELEMENT)
  @ValidateNested({ each: true })
  @Type(() => PolicyToolV2Dto)
  requestTools!: PolicyToolV2Dto[];

  @ValidateIf((endpoint: EndpointPolicyV2Dto) => endpoint.jevContext !== null)
  @IsString()
  @MaxLength(MAX_ENDPOINT_JEV_CONTEXT)
  jevContext!: string | null;

  @IsArray()
  @ArrayMaxSize(MAX_FIELDS_PER_ENDPOINT)
  @ValidateNested({ each: true })
  @Type(() => FieldPolicyV2Dto)
  fields!: FieldPolicyV2Dto[];
}

export class StructuredPolicyV2Dto {
  @IsIn([POLICY_SCHEMA_V2])
  schemaVersion!: typeof POLICY_SCHEMA_V2;

  @IsIn([TOOL_REGISTRY_V2])
  toolRegistryVersion!: typeof TOOL_REGISTRY_V2;

  @IsArray()
  @ArrayMaxSize(MAX_ENDPOINTS_V2)
  @ValidateNested({ each: true })
  @Type(() => EndpointPolicyV2Dto)
  endpoints!: EndpointPolicyV2Dto[];
}

/** Plain shapes of the DTOs above, for stored documents and views. */
export interface FieldPolicyV2 {
  name: string;
  location: FieldLocationV2;
  type: string;
  required: boolean;
  tools: { toolId: ToolId }[];
  jevContext: string | null;
}

export interface EndpointPolicyV2 {
  method: PolicyHttpMethod;
  path: string;
  humanReadablePolicy: string;
  requestTools: { toolId: ToolId }[];
  jevContext: string | null;
  fields: FieldPolicyV2[];
}

export interface StructuredPolicyV2 {
  schemaVersion: typeof POLICY_SCHEMA_V2;
  toolRegistryVersion: typeof TOOL_REGISTRY_V2;
  endpoints: EndpointPolicyV2[];
}

/**
 * Placement rules of ADR-0010: `full` tools on the endpoint, `field` tools on
 * non-file fields, `file` tools only on `file` fields, no duplicates. Returns
 * contract paths of violations, never values.
 */
export function toolPlacementIssues(
  endpoint: EndpointPolicyV2,
  prefix = 'endpoint',
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  endpoint.requestTools.forEach((tool, index) => {
    if (findTool(tool.toolId)?.scope !== 'full') {
      issues.push(`${prefix}.requestTools.${index}: scope`);
    }
    if (seen.has(tool.toolId)) {
      issues.push(`${prefix}.requestTools.${index}: duplicate`);
    }
    seen.add(tool.toolId);
  });
  const fieldKeys = new Set<string>();
  endpoint.fields.forEach((field, fieldIndex) => {
    const key = `${field.location}:${field.name}`;
    if (fieldKeys.has(key)) {
      issues.push(`${prefix}.fields.${fieldIndex}: duplicate`);
    }
    fieldKeys.add(key);
    const fieldTools = new Set<string>();
    field.tools.forEach((tool, toolIndex) => {
      const scope = findTool(tool.toolId)?.scope;
      const expected = field.location === 'file' ? 'file' : 'field';
      if (scope !== expected) {
        issues.push(`${prefix}.fields.${fieldIndex}.tools.${toolIndex}: scope`);
      }
      if (fieldTools.has(tool.toolId)) {
        issues.push(
          `${prefix}.fields.${fieldIndex}.tools.${toolIndex}: duplicate`,
        );
      }
      fieldTools.add(tool.toolId);
    });
  });
  return issues;
}
