import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const ANALYSIS_UPLOAD_SCHEMA_VERSION =
  'tessera.analysis-upload/v1' as const;
export const ENVIRONMENT_TOOL_STATUSES = ['succeeded', 'failed'] as const;
export const VULNERABILITY_SEVERITIES = [
  'unknown',
  'low',
  'medium',
  'high',
  'critical',
] as const;
export type VulnerabilitySeverity = (typeof VULNERABILITY_SEVERITIES)[number];

const TOOL_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
// Rejects control characters in free text.
// eslint-disable-next-line no-control-regex
const SAFE_TEXT = /^[^\u0000-\u001f]*$/;

export class SourceRevisionV1Dto {
  @ApiProperty({ description: 'Full 40-character Git commit SHA' })
  @Matches(/^[a-f0-9]{40}$/)
  commitSha!: string;
}

export class CollectorInfoV1Dto {
  @ApiProperty({ example: 'tessera-collector' })
  @Matches(TOOL_NAME)
  name!: string;

  @ApiProperty({ example: '0.1.0' })
  @IsString()
  @Matches(/^[\w.+-]{1,64}$/)
  version!: string;
}

export class EnvironmentToolRunV1Dto {
  @ApiProperty({ example: 'syft' })
  @Matches(TOOL_NAME)
  name!: string;

  @ApiProperty({ example: '1.20.0' })
  @Matches(/^[\w.+-]{1,64}$/)
  version!: string;

  @ApiProperty({ enum: ENVIRONMENT_TOOL_STATUSES })
  @IsIn(ENVIRONMENT_TOOL_STATUSES)
  status!: (typeof ENVIRONMENT_TOOL_STATUSES)[number];

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @Matches(SAFE_TEXT)
  @MaxLength(500)
  error?: string;
}

export class DependencyV1Dto {
  @ApiProperty({ example: 'express' })
  @IsString()
  @Matches(SAFE_TEXT)
  @MaxLength(256)
  name!: string;

  @ApiProperty({ example: '4.21.2' })
  @IsString()
  @Matches(SAFE_TEXT)
  @MaxLength(128)
  version!: string;

  @ApiProperty({ example: 'npm' })
  @Matches(/^[a-z0-9._-]{1,32}$/)
  ecosystem!: string;

  @ApiProperty({ required: false, example: 'pkg:npm/express@4.21.2' })
  @IsOptional()
  @Matches(/^pkg:[^\s]{1,500}$/)
  purl?: string;

  @ApiProperty({ example: 'syft', description: 'Tool that reported it' })
  @Matches(TOOL_NAME)
  source!: string;
}

export class VulnerabilityV1Dto {
  @ApiProperty({ example: 'CVE-2024-45590' })
  @Matches(
    /^(?:CVE-\d{4}-\d{4,}|GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}|[A-Z]{2,10}-[\w.-]{1,64})$/,
  )
  id!: string;

  @ApiProperty({ example: 'body-parser' })
  @IsString()
  @Matches(SAFE_TEXT)
  @MaxLength(256)
  packageName!: string;

  @ApiProperty({ example: '1.20.2' })
  @IsString()
  @Matches(SAFE_TEXT)
  @MaxLength(128)
  installedVersion!: string;

  @ApiProperty({ required: false, example: '1.20.3' })
  @IsOptional()
  @IsString()
  @Matches(SAFE_TEXT)
  @MaxLength(128)
  fixedVersion?: string;

  @ApiProperty({ enum: VULNERABILITY_SEVERITIES })
  @IsIn(VULNERABILITY_SEVERITIES)
  severity!: VulnerabilitySeverity;

  @ApiProperty({ example: 'trivy', description: 'Tool that reported it' })
  @Matches(TOOL_NAME)
  source!: string;
}

export class EnvironmentContextV1Dto {
  @ApiProperty({ type: EnvironmentToolRunV1Dto, isArray: true })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EnvironmentToolRunV1Dto)
  tools!: EnvironmentToolRunV1Dto[];

  @ApiProperty({ type: DependencyV1Dto, isArray: true })
  @IsArray()
  @ArrayMaxSize(10_000)
  @ValidateNested({ each: true })
  @Type(() => DependencyV1Dto)
  dependencies!: DependencyV1Dto[];

  @ApiProperty({ type: VulnerabilityV1Dto, isArray: true })
  @IsArray()
  @ArrayMaxSize(10_000)
  @ValidateNested({ each: true })
  @Type(() => VulnerabilityV1Dto)
  vulnerabilities!: VulnerabilityV1Dto[];
}

export class CollectorRedactionManifestV1Dto {
  @ApiProperty({ example: 'tessera-redactor' })
  @Matches(TOOL_NAME)
  tool!: string;

  @ApiProperty({ type: String, isArray: true, example: ['env-values'] })
  @IsArray()
  @ArrayMaxSize(100)
  @Matches(/^[a-z0-9._-]{1,64}$/, { each: true })
  rules!: string[];

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  redactedValueCount!: number;
}

export class AnalysisUploadV1Dto {
  @ApiProperty({ enum: [ANALYSIS_UPLOAD_SCHEMA_VERSION] })
  @IsIn([ANALYSIS_UPLOAD_SCHEMA_VERSION])
  schemaVersion!: typeof ANALYSIS_UPLOAD_SCHEMA_VERSION;

  @ApiProperty({ type: SourceRevisionV1Dto })
  @ValidateNested()
  @Type(() => SourceRevisionV1Dto)
  sourceRevision!: SourceRevisionV1Dto;

  @ApiProperty({ type: CollectorInfoV1Dto })
  @ValidateNested()
  @Type(() => CollectorInfoV1Dto)
  collector!: CollectorInfoV1Dto;

  @ApiProperty({ type: EnvironmentContextV1Dto })
  @ValidateNested()
  @Type(() => EnvironmentContextV1Dto)
  environment!: EnvironmentContextV1Dto;

  @ApiProperty({ type: CollectorRedactionManifestV1Dto })
  @ValidateNested()
  @Type(() => CollectorRedactionManifestV1Dto)
  redaction!: CollectorRedactionManifestV1Dto;
}
