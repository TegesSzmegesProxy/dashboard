import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
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
import { TOOL_IDS } from '../../tools/v2/tool-registry.js';
import type { ToolId } from '../../tools/v2/tool-registry.js';

/**
 * `tessera.analysis/v2` agent submissions (ADR-0013). The JSON schemas below
 * are the strict `submit_*` tool inputs; strict schemas cannot express
 * lengths, so the DTOs re-validate every submission as untrusted input.
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
  @IsIn(TOOL_IDS)
  toolId!: ToolId;

  @IsIn(EVIDENCE_BASES)
  basis!: EvidenceBasis;

  @IsString()
  @MaxLength(500)
  rationale!: string;
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

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  languages!: string[];

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  frameworks!: string[];

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(LIST, { each: true })
  routePrefixes!: string[];

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(LIST, { each: true })
  globalMiddleware!: string[];

  @IsString()
  @MaxLength(1_000)
  authentication!: string;

  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(LIST, { each: true })
  validationConventions!: string[];

  @IsString()
  @MaxLength(1_000)
  errorHandling!: string;

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
const toolChoiceSchema = obj({
  toolId: enumOf(TOOL_IDS),
  basis: enumOf(EVIDENCE_BASES),
  rationale: str(),
});
const candidateSchema = obj({
  method: enumOf(HTTP_METHODS, true),
  path: nullableStr(),
  reason: str(),
  evidence: evidenceList,
});

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
      methodGroup: { type: ['integer', 'null'] },
      pathGroup: int(),
      pathPrefix: str(),
    }),
  ),
  candidates: arr(candidateSchema),
});

export const SUBMIT_SWEEP_SCHEMA: Schema = obj({
  candidates: arr(candidateSchema),
});
