import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { HTTP_METHODS } from '../../policy/v1/policy.contract.js';
import type { PolicyHttpMethod } from '../../policy/v1/policy.contract.js';
import {
  FIELD_LOCATIONS_V2,
  FIELD_NAME_PATTERN,
  MAX_ENDPOINT_JEV_CONTEXT,
  MAX_FIELD_HUMAN_READABLE_POLICY,
  MAX_FIELD_JEV_CONTEXT,
  MAX_FIELDS_PER_ENDPOINT,
  MAX_HUMAN_READABLE_POLICY,
  MAX_TOOLS_PER_ELEMENT,
} from '../../policy/v2/policy.contract.js';
import type { FieldLocationV2 } from '../../policy/v2/policy.contract.js';
import {
  MAX_SCOPE_JEV_CONTEXT,
  MAX_TOOL_CONFIG_LENGTH,
  SCOPE_FIELD_LOCATIONS,
} from '../../policy/v3/policy.contract.js';
import type { ScopeFieldLocation } from '../../policy/v3/policy.contract.js';
import { AI_TOOL_IDS_V3 } from '../../tools/v3/tool-registry.js';

/**
 * `tessera.analysis/v2` agent submissions (ADR-0013). The JSON schemas below
 * are the strict `submit_*` tool inputs; strict schemas cannot express
 * lengths, so the DTOs re-validate every submission as untrusted input.
 *
 * Tool choices name `tessera.tools/v3` tools (ADR-0021) and carry their
 * configuration as a JSON string: strict schemas cannot describe 150
 * different configuration objects, so reconciliation parses it and checks it
 * against the tool's schema.
 */
export const ANALYSIS_SCHEMA_V2 = 'tessera.analysis/v2' as const;
export const DISPOSITIONS = [
  'endpoint',
  'not_an_endpoint',
  'duplicate',
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];
export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export const AUTH_REQUIRED = ['yes', 'no', 'unknown'] as const;
export const EVIDENCE_BASES = ['observed', 'inferred', 'environment'] as const;
export type EvidenceBasis = (typeof EVIDENCE_BASES)[number];
export const SINK_KINDS = [
  'sql',
  'nosql',
  'shell',
  'filesystem',
  'html_output',
  'template',
  'redirect',
  'outbound_http',
  'deserialization',
  'log',
  'other',
] as const;
export const FINDING_CATEGORIES = [
  'validation',
  'authentication',
  'authorization',
  'injection',
  'configuration',
  'dependency',
  'business_logic',
  'other',
] as const;
export const FINDING_SEVERITIES = [
  'info',
  'low',
  'medium',
  'high',
  'critical',
] as const;

export const MAX_EVIDENCE = 10;
const LIST = 300;

/**
 * Local models sometimes ignore the strict schema and send a single string
 * where a list is required. Wrapping it loses nothing; validation still runs.
 */
const stringOrList = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? [value] : value,
  );

export class EvidenceDto {
  @IsString()
  @MaxLength(1_024)
  path!: string;

  @IsInt()
  @Min(1)
  @Max(10_000_000)
  startLine!: number;

  @IsInt()
  @Min(1)
  @Max(10_000_000)
  endLine!: number;
}

export class ToolChoiceDto {
  @IsIn(AI_TOOL_IDS_V3)
  toolId!: string;

  @IsIn(EVIDENCE_BASES)
  basis!: EvidenceBasis;

  @IsString()
  @MaxLength(500)
  rationale!: string;

  /** The tool's configuration as a JSON object string; `{}` uses the proxy's defaults. */
  @IsString()
  @MaxLength(MAX_TOOL_CONFIG_LENGTH)
  configJson!: string;
}

/** A field tool a scope runs on every field of the listed locations. */
export class ScopeFieldToolChoiceDto extends ToolChoiceDto {
  @IsArray()
  @ArrayMaxSize(SCOPE_FIELD_LOCATIONS.length)
  @IsIn(SCOPE_FIELD_LOCATIONS, { each: true })
  locations!: ScopeFieldLocation[];
}

/**
 * Policies that apply to every request: `global` ones from cross-cutting code,
 * `environment` ones from the environment snapshot.
 */
export class ScopePolicySubmissionDto {
  @IsString()
  @MaxLength(MAX_HUMAN_READABLE_POLICY)
  humanReadablePolicy!: string;

  @IsArray()
  @ArrayMaxSize(MAX_TOOLS_PER_ELEMENT)
  @ValidateNested({ each: true })
  @Type(() => ToolChoiceDto)
  requestTools!: ToolChoiceDto[];

  @IsArray()
  @ArrayMaxSize(MAX_TOOLS_PER_ELEMENT)
  @ValidateNested({ each: true })
  @Type(() => ScopeFieldToolChoiceDto)
  fieldTools!: ScopeFieldToolChoiceDto[];

  @ValidateIf((scope: ScopePolicySubmissionDto) => scope.jevContext !== null)
  @IsString()
  @MaxLength(MAX_SCOPE_JEV_CONTEXT)
  jevContext!: string | null;

  @IsArray()
  @ArrayMaxSize(MAX_EVIDENCE)
  @ValidateNested({ each: true })
  @Type(() => EvidenceDto)
  evidence!: EvidenceDto[];

  @stringOrList()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(LIST, { each: true })
  limitations!: string[];
}

export class AuthFactDto {
  @IsIn(AUTH_REQUIRED)
  required!: (typeof AUTH_REQUIRED)[number];

  @IsString()
  @MaxLength(LIST)
  mechanism!: string;

  @IsArray()
  @ArrayMaxSize(MAX_EVIDENCE)
  @ValidateNested({ each: true })
  @Type(() => EvidenceDto)
  evidence!: EvidenceDto[];
}

export class ObservedLimitDto {
  @IsString()
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MaxLength(200)
  limit!: string;

  @IsArray()
  @ArrayMaxSize(MAX_EVIDENCE)
  @ValidateNested({ each: true })
  @Type(() => EvidenceDto)
  evidence!: EvidenceDto[];
}

export class SinkDto {
  @IsIn(SINK_KINDS)
  kind!: (typeof SINK_KINDS)[number];

  @ValidateIf((sink: SinkDto) => sink.field !== null)
  @IsString()
  @MaxLength(512)
  field!: string | null;

  @IsArray()
  @ArrayMaxSize(MAX_EVIDENCE)
  @ValidateNested({ each: true })
  @Type(() => EvidenceDto)
  evidence!: EvidenceDto[];
}

export class FieldFindingDto {
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
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(LIST, { each: true })
  constraints!: string[];

  @IsArray()
  @ArrayMaxSize(MAX_EVIDENCE)
  @ValidateNested({ each: true })
  @Type(() => EvidenceDto)
  evidence!: EvidenceDto[];

  @IsArray()
  @ArrayMaxSize(MAX_TOOLS_PER_ELEMENT)
  @ValidateNested({ each: true })
  @Type(() => ToolChoiceDto)
  tools!: ToolChoiceDto[];

  @IsString()
  @MaxLength(MAX_FIELD_HUMAN_READABLE_POLICY)
  humanReadablePolicy!: string;

  @ValidateIf((field: FieldFindingDto) => field.jevContext !== null)
  @IsString()
  @MaxLength(MAX_FIELD_JEV_CONTEXT)
  jevContext!: string | null;
}

export class FindingDto {
  @IsIn(FINDING_CATEGORIES)
  category!: (typeof FINDING_CATEGORIES)[number];

  @IsIn(FINDING_SEVERITIES)
  severity!: (typeof FINDING_SEVERITIES)[number];

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(2_000)
  description!: string;

  @IsIn(EVIDENCE_BASES)
  basis!: EvidenceBasis;

  @IsArray()
  @ArrayMaxSize(MAX_EVIDENCE)
  @ValidateNested({ each: true })
  @Type(() => EvidenceDto)
  evidence!: EvidenceDto[];
}

export class EndpointFindingDto {
  @IsIn(HTTP_METHODS)
  method!: PolicyHttpMethod;

  @IsString()
  @MaxLength(1_024)
  path!: string;

  @ValidateIf((endpoint: EndpointFindingDto) => endpoint.handler !== null)
  @ValidateNested()
  @Type(() => EvidenceDto)
  handler!: EvidenceDto | null;

  @IsIn(CONFIDENCES)
  confidence!: (typeof CONFIDENCES)[number];

  @ValidateNested()
  @Type(() => AuthFactDto)
  auth!: AuthFactDto;

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  contentTypes!: string[];

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ObservedLimitDto)
  observedLimits!: ObservedLimitDto[];

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SinkDto)
  sinks!: SinkDto[];

  @IsArray()
  @ArrayMaxSize(MAX_FIELDS_PER_ENDPOINT)
  @ValidateNested({ each: true })
  @Type(() => FieldFindingDto)
  fields!: FieldFindingDto[];

  @IsArray()
  @ArrayMaxSize(MAX_TOOLS_PER_ELEMENT)
  @ValidateNested({ each: true })
  @Type(() => ToolChoiceDto)
  requestTools!: ToolChoiceDto[];

  @ValidateIf((endpoint: EndpointFindingDto) => endpoint.jevContext !== null)
  @IsString()
  @MaxLength(MAX_ENDPOINT_JEV_CONTEXT)
  jevContext!: string | null;

  @IsString()
  @MaxLength(MAX_HUMAN_READABLE_POLICY)
  humanReadablePolicy!: string;

  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(LIST, { each: true })
  limitations!: string[];

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => FindingDto)
  findings!: FindingDto[];
}

export class SubmitEndpointDto {
  @IsIn(DISPOSITIONS)
  disposition!: Disposition;

  @IsString()
  @MaxLength(1_000)
  reason!: string;

  @ValidateIf((submission: SubmitEndpointDto) => submission.endpoint !== null)
  @ValidateNested()
  @Type(() => EndpointFindingDto)
  endpoint!: EndpointFindingDto | null;
}

export class DossierDto {
  @IsString()
  @MaxLength(3_000)
  summary!: string;

  @stringOrList()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  languages!: string[];

  @stringOrList()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  frameworks!: string[];

  @stringOrList()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(LIST, { each: true })
  routePrefixes!: string[];

  @stringOrList()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(LIST, { each: true })
  globalMiddleware!: string[];

  @IsString()
  @MaxLength(1_000)
  authentication!: string;

  @stringOrList()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(LIST, { each: true })
  validationConventions!: string[];

  @IsString()
  @MaxLength(1_000)
  errorHandling!: string;

  @stringOrList()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(LIST, { each: true })
  notes!: string[];
}

export class RouteRuleDto {
  @IsString()
  @MaxLength(LIST)
  description!: string;

  @ValidateIf((rule: RouteRuleDto) => rule.fileGlob !== null)
  @IsString()
  @MaxLength(200)
  fileGlob!: string | null;

  @IsString()
  @MaxLength(500)
  pattern!: string;

  @IsBoolean()
  caseInsensitive!: boolean;

  @ValidateIf((rule: RouteRuleDto) => rule.method !== null)
  @IsIn(HTTP_METHODS)
  method!: PolicyHttpMethod | null;

  @ValidateIf((rule: RouteRuleDto) => rule.methodGroup !== null)
  @IsInt()
  @Min(1)
  @Max(9)
  methodGroup!: number | null;

  @IsInt()
  @Min(1)
  @Max(9)
  pathGroup!: number;

  @IsString()
  @MaxLength(200)
  pathPrefix!: string;
}

export class CandidateDto {
  @ValidateIf((candidate: CandidateDto) => candidate.method !== null)
  @IsIn(HTTP_METHODS)
  method!: PolicyHttpMethod | null;

  @ValidateIf((candidate: CandidateDto) => candidate.path !== null)
  @IsString()
  @MaxLength(1_024)
  path!: string | null;

  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsArray()
  @ArrayMaxSize(MAX_EVIDENCE)
  @ValidateNested({ each: true })
  @Type(() => EvidenceDto)
  evidence!: EvidenceDto[];
}

export class SubmitReconDto {
  @ValidateNested()
  @Type(() => DossierDto)
  dossier!: DossierDto;

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => RouteRuleDto)
  routeRules!: RouteRuleDto[];

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CandidateDto)
  candidates!: CandidateDto[];

  /** Optional so a model that leaves it out still keeps its dossier and rules. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ScopePolicySubmissionDto)
  globalPolicy?: ScopePolicySubmissionDto;
}

export class SubmitEnvironmentPolicyDto {
  @ValidateNested()
  @Type(() => ScopePolicySubmissionDto)
  environmentPolicy!: ScopePolicySubmissionDto;
}

export class SubmitSweepDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CandidateDto)
  candidates!: CandidateDto[];
}

/* ---------- strict JSON schemas for the submit tools ---------- */

type Schema = Record<string, unknown>;
const str = (): Schema => ({ type: 'string' });
const nullableStr = (): Schema => ({ type: ['string', 'null'] });
const int = (): Schema => ({ type: 'integer' });
const bool = (): Schema => ({ type: 'boolean' });
const enumOf = (values: readonly string[], nullable = false): Schema =>
  nullable
    ? { type: ['string', 'null'], enum: [...values, null] }
    : { type: 'string', enum: [...values] };
const arr = (items: Schema): Schema => ({ type: 'array', items });
const obj = (properties: Record<string, Schema>): Schema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const nullableObj = (properties: Record<string, Schema>): Schema => ({
  ...obj(properties),
  type: ['object', 'null'],
});

const evidenceSchema = obj({ path: str(), startLine: int(), endLine: int() });
const evidenceList = arr(evidenceSchema);
const toolChoiceProperties = {
  toolId: enumOf(AI_TOOL_IDS_V3),
  basis: enumOf(EVIDENCE_BASES),
  rationale: str(),
  configJson: str(),
};
const toolChoiceSchema = obj(toolChoiceProperties);
const scopePolicySchema = obj({
  humanReadablePolicy: str(),
  requestTools: arr(toolChoiceSchema),
  fieldTools: arr(
    obj({
      ...toolChoiceProperties,
      locations: arr(enumOf(SCOPE_FIELD_LOCATIONS)),
    }),
  ),
  jevContext: nullableStr(),
  evidence: evidenceList,
  limitations: arr(str()),
});
const candidateSchema = obj({
  method: enumOf(HTTP_METHODS, true),
  path: nullableStr(),
  reason: str(),
  evidence: evidenceList,
});

/** Regex capture groups count from 1; group 0 is the whole match. */
export const METHOD_GROUP_SCHEMA: Schema = {
  type: ['integer', 'null'],
  description:
    'Number (1-9) of the regex capture group that holds the HTTP verb, or null when `method` is fixed. Groups count from 1; never 0.',
};
export const PATH_GROUP_SCHEMA: Schema = {
  type: 'integer',
  description:
    'Number (1-9) of the regex capture group that holds the route path. Groups count from 1; never 0.',
};

export const SUBMIT_ENDPOINT_SCHEMA: Schema = obj({
  disposition: enumOf(DISPOSITIONS),
  reason: str(),
  endpoint: nullableObj({
    method: enumOf(HTTP_METHODS),
    path: str(),
    handler: {
      ...evidenceSchema,
      type: ['object', 'null'],
    },
    confidence: enumOf(CONFIDENCES),
    auth: obj({
      required: enumOf(AUTH_REQUIRED),
      mechanism: str(),
      evidence: evidenceList,
    }),
    contentTypes: arr(str()),
    observedLimits: arr(
      obj({ subject: str(), limit: str(), evidence: evidenceList }),
    ),
    sinks: arr(
      obj({
        kind: enumOf(SINK_KINDS),
        field: nullableStr(),
        evidence: evidenceList,
      }),
    ),
    fields: arr(
      obj({
        name: str(),
        location: enumOf(FIELD_LOCATIONS_V2),
        type: str(),
        required: bool(),
        constraints: arr(str()),
        evidence: evidenceList,
        tools: arr(toolChoiceSchema),
        humanReadablePolicy: str(),
        jevContext: nullableStr(),
      }),
    ),
    requestTools: arr(toolChoiceSchema),
    jevContext: nullableStr(),
    humanReadablePolicy: str(),
    limitations: arr(str()),
    findings: arr(
      obj({
        category: enumOf(FINDING_CATEGORIES),
        severity: enumOf(FINDING_SEVERITIES),
        title: str(),
        description: str(),
        basis: enumOf(EVIDENCE_BASES),
        evidence: evidenceList,
      }),
    ),
  }),
});

export const SUBMIT_RECON_SCHEMA: Schema = obj({
  dossier: obj({
    summary: str(),
    languages: arr(str()),
    frameworks: arr(str()),
    routePrefixes: arr(str()),
    globalMiddleware: arr(str()),
    authentication: str(),
    validationConventions: arr(str()),
    errorHandling: str(),
    notes: arr(str()),
  }),
  routeRules: arr(
    obj({
      description: str(),
      fileGlob: nullableStr(),
      pattern: str(),
      caseInsensitive: bool(),
      method: enumOf(HTTP_METHODS, true),
      methodGroup: METHOD_GROUP_SCHEMA,
      pathGroup: PATH_GROUP_SCHEMA,
      pathPrefix: str(),
    }),
  ),
  candidates: arr(candidateSchema),
  globalPolicy: scopePolicySchema,
});

export const SUBMIT_ENVIRONMENT_POLICY_SCHEMA: Schema = obj({
  environmentPolicy: scopePolicySchema,
});

export const SUBMIT_SWEEP_SCHEMA: Schema = obj({
  candidates: arr(candidateSchema),
});
