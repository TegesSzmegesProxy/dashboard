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
  ValidateNested,
} from 'class-validator';
import { HTTP_METHODS } from '../../policy/v1/policy.contract.js';
import type { PolicyHttpMethod } from '../../policy/v1/policy.contract.js';

/**
 * Structured output requested from the AI provider. The JSON schema
 * constrains generation; the DTOs below re-validate the result because AI
 * output is untrusted input.
 */
export const AI_ANALYSIS_SCHEMA_VERSION = 'tessera.ai-analysis/v1' as const;
export const FIELD_LOCATIONS = [
  'body',
  'query',
  'path',
  'header',
  'cookie',
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
export const FINDING_BASES = ['observed', 'inferred'] as const;

export class AiEvidenceDto {
  @IsString()
  @MaxLength(1024)
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

export class AiRequestFieldDto {
  @IsString()
  @MaxLength(256)
  name!: string;

  @IsIn(FIELD_LOCATIONS)
  location!: (typeof FIELD_LOCATIONS)[number];

  @IsString()
  @MaxLength(64)
  type!: string;

  @IsBoolean()
  required!: boolean;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  constraints!: string[];
}

export class AiEndpointDto {
  @IsIn(HTTP_METHODS)
  method!: PolicyHttpMethod;

  @Matches(/^\/(?!.*[?#\s]).*$/)
  @MaxLength(1024)
  path!: string;

  @IsString()
  @MaxLength(1000)
  description!: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AiRequestFieldDto)
  fields!: AiRequestFieldDto[];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AiEvidenceDto)
  evidence!: AiEvidenceDto[];
}

export class AiConfigurationItemDto {
  @IsString()
  @MaxLength(256)
  name!: string;

  @IsString()
  @MaxLength(1000)
  summary!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AiEvidenceDto)
  evidence!: AiEvidenceDto[];
}

export class AiFindingDto {
  @IsIn(FINDING_CATEGORIES)
  category!: (typeof FINDING_CATEGORIES)[number];

  @IsIn(FINDING_SEVERITIES)
  severity!: (typeof FINDING_SEVERITIES)[number];

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(2000)
  description!: string;

  @IsIn(FINDING_BASES)
  basis!: (typeof FINDING_BASES)[number];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AiEvidenceDto)
  evidence!: AiEvidenceDto[];
}

export class AiAnalysisOutputDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AiEndpointDto)
  endpoints!: AiEndpointDto[];

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AiConfigurationItemDto)
  configuration!: AiConfigurationItemDto[];

  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => AiFindingDto)
  findings!: AiFindingDto[];
}

const evidenceSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      startLine: { type: 'integer' },
      endLine: { type: 'integer' },
    },
    required: ['path', 'startLine', 'endLine'],
    additionalProperties: false,
  },
} as const;

export const AI_ANALYSIS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    endpoints: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: [...HTTP_METHODS] },
          path: { type: 'string' },
          description: { type: 'string' },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                location: { type: 'string', enum: [...FIELD_LOCATIONS] },
                type: { type: 'string' },
                required: { type: 'boolean' },
                constraints: { type: 'array', items: { type: 'string' } },
              },
              required: ['name', 'location', 'type', 'required', 'constraints'],
              additionalProperties: false,
            },
          },
          evidence: evidenceSchema,
        },
        required: ['method', 'path', 'description', 'fields', 'evidence'],
        additionalProperties: false,
      },
    },
    configuration: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          summary: { type: 'string' },
          evidence: evidenceSchema,
        },
        required: ['name', 'summary', 'evidence'],
        additionalProperties: false,
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: [...FINDING_CATEGORIES] },
          severity: { type: 'string', enum: [...FINDING_SEVERITIES] },
          title: { type: 'string' },
          description: { type: 'string' },
          basis: { type: 'string', enum: [...FINDING_BASES] },
          evidence: evidenceSchema,
        },
        required: [
          'category',
          'severity',
          'title',
          'description',
          'basis',
          'evidence',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['endpoints', 'configuration', 'findings'],
  additionalProperties: false,
};
