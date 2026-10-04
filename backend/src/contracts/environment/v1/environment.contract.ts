import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * `tessera.environment/v1` (ADR-0012): one result of `tessera -get-environment`,
 * mirroring the collector's `EnvironmentAnalysisResult`
 * (`source/analysis/environment/types.ts` in the proxy repository). The
 * collector does not send `schemaVersion` yet; its absence means v1.
 */
export const ENVIRONMENT_SCHEMA_VERSION = 'tessera.environment/v1' as const;
export const ENVIRONMENT_TOOLS = [
  'nmap',
  'nuclei',
  'trivy',
  'httpx',
  'lynis',
] as const;
export type EnvironmentTool = (typeof ENVIRONMENT_TOOLS)[number];
export const ENVIRONMENT_SEVERITIES = [
  'unknown',
  'info',
  'low',
  'medium',
  'high',
  'critical',
] as const;
export type EnvironmentSeverity = (typeof ENVIRONMENT_SEVERITIES)[number];
export const TOOL_RUN_STATUSES = ['ok', 'failed', 'skipped'] as const;
export const TOOL_FAILURE_KINDS = [
  'missing',
  'timeout',
  'exit',
  'parse',
] as const;
export const NMAP_PORT_STATES = [
  'open',
  'closed',
  'filtered',
  'unfiltered',
  'open|filtered',
  'closed|filtered',
] as const;

export const MAX_HTTP_HEADERS = 100;
export const MAX_HEADER_NAME = 128;
export const MAX_HEADER_VALUE = 2_000;

export class SecurityFindingDto {
  @IsIn(ENVIRONMENT_TOOLS)
  source!: EnvironmentTool;

  @IsString()
  @MaxLength(256)
  ruleId!: string;

  @IsIn(ENVIRONMENT_SEVERITIES)
  severity!: EnvironmentSeverity;

  @IsString()
  @MaxLength(500)
  title!: string;

  @IsString()
  @MaxLength(4_000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  target?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  evidence?: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  cves!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  remediation?: string;
}

export class ToolFailureDto {
  @IsIn(TOOL_FAILURE_KINDS)
  kind!: (typeof TOOL_FAILURE_KINDS)[number];

  @IsString()
  @MaxLength(1_000)
  message!: string;
}

/** Fields shared by every per-tool run; `result` is declared per tool. */
abstract class ToolRunDto {
  @IsIn(ENVIRONMENT_TOOLS)
  tool!: EnvironmentTool;

  @IsIn(TOOL_RUN_STATUSES)
  status!: (typeof TOOL_RUN_STATUSES)[number];

  @IsISO8601()
  startedAt!: string;

  @IsInt()
  @Min(0)
  @Max(24 * 60 * 60_000)
  durationMs!: number;

  @ValidateIf((run: ToolRunDto) => run.status === 'failed')
  @IsDefined()
  @ValidateNested()
  @Type(() => ToolFailureDto)
  error?: ToolFailureDto;

  @ValidateIf((run: ToolRunDto) => run.status === 'skipped')
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class NmapPortDto {
  @IsInt()
  @Min(0)
  @Max(65_535)
  port!: number;

  @IsIn(['tcp', 'udp'])
  protocol!: 'tcp' | 'udp';

  @IsIn(NMAP_PORT_STATES)
  state!: (typeof NMAP_PORT_STATES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(128)
  service?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  version?: string;
}

export class NmapHostDto {
  @IsString()
  @MaxLength(256)
  address!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  hostname?: string;

  @IsArray()
  @ArrayMaxSize(2_000)
  @ValidateNested({ each: true })
  @Type(() => NmapPortDto)
  ports!: NmapPortDto[];
}

export class NmapResultDto {
  @IsArray()
  @ArrayMaxSize(256)
  @ValidateNested({ each: true })
  @Type(() => NmapHostDto)
  hosts!: NmapHostDto[];
}

export class NucleiResultDto {
  @IsArray()
  @ArrayMaxSize(5_000)
  @ValidateNested({ each: true })
  @Type(() => SecurityFindingDto)
  findings!: SecurityFindingDto[];
}

export class TrivyVulnerabilityDto {
  @IsString()
  @MaxLength(128)
  id!: string;

  @IsString()
  @MaxLength(256)
  package!: string;

  @IsString()
  @MaxLength(128)
  installedVersion!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  fixedVersion?: string;

  @IsIn(ENVIRONMENT_SEVERITIES)
  severity!: EnvironmentSeverity;

  @IsString()
  @MaxLength(1_000)
  title!: string;

  @IsString()
  @MaxLength(1_024)
  target!: string;
}

export class TrivyResultDto {
  @IsArray()
  @ArrayMaxSize(20_000)
  @ValidateNested({ each: true })
  @Type(() => TrivyVulnerabilityDto)
  vulnerabilities!: TrivyVulnerabilityDto[];

  @IsArray()
  @ArrayMaxSize(5_000)
  @ValidateNested({ each: true })
  @Type(() => SecurityFindingDto)
  misconfigurations!: SecurityFindingDto[];

  @IsArray()
  @ArrayMaxSize(5_000)
  @ValidateNested({ each: true })
  @Type(() => SecurityFindingDto)
  secrets!: SecurityFindingDto[];
}

export class HttpTlsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  version?: string;
}

export class HttpTargetDto {
  @IsString()
  @MaxLength(2_048)
  url!: string;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(599)
  statusCode?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  server?: string;

  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  technologies!: string[];

  /** Checked for count and lengths by the service; class-validator cannot. */
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @IsOptional()
  @ValidateNested()
  @Type(() => HttpTlsDto)
  tls?: HttpTlsDto;
}

export class HttpxResultDto {
  @IsArray()
  @ArrayMaxSize(1_000)
  @ValidateNested({ each: true })
  @Type(() => HttpTargetDto)
  targets!: HttpTargetDto[];
}

export class LynisResultDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;

  @IsBoolean()
  privileged!: boolean;

  @IsArray()
  @ArrayMaxSize(1_000)
  @ValidateNested({ each: true })
  @Type(() => SecurityFindingDto)
  warnings!: SecurityFindingDto[];

  @IsArray()
  @ArrayMaxSize(1_000)
  @ValidateNested({ each: true })
  @Type(() => SecurityFindingDto)
  suggestions!: SecurityFindingDto[];
}

const okOnly = (run: ToolRunDto) => run.status === 'ok';

export class NmapRunDto extends ToolRunDto {
  @ValidateIf(okOnly)
  @IsDefined()
  @ValidateNested()
  @Type(() => NmapResultDto)
  result?: NmapResultDto;
}

export class NucleiRunDto extends ToolRunDto {
  @ValidateIf(okOnly)
  @IsDefined()
  @ValidateNested()
  @Type(() => NucleiResultDto)
  result?: NucleiResultDto;
}

export class TrivyRunDto extends ToolRunDto {
  @ValidateIf(okOnly)
  @IsDefined()
  @ValidateNested()
  @Type(() => TrivyResultDto)
  result?: TrivyResultDto;
}

export class HttpxRunDto extends ToolRunDto {
  @ValidateIf(okOnly)
  @IsDefined()
  @ValidateNested()
  @Type(() => HttpxResultDto)
  result?: HttpxResultDto;
}

export class LynisRunDto extends ToolRunDto {
  @ValidateIf(okOnly)
  @IsDefined()
  @ValidateNested()
  @Type(() => LynisResultDto)
  result?: LynisResultDto;
}

export class EnvironmentSnapshotV1Dto {
  @ApiProperty({ required: false, enum: [ENVIRONMENT_SCHEMA_VERSION] })
  @IsOptional()
  @IsIn([ENVIRONMENT_SCHEMA_VERSION])
  schemaVersion?: typeof ENVIRONMENT_SCHEMA_VERSION;

  /** Must match the route's tenant; the route and key decide the tenant. */
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,40}$/)
  tenantId!: string;

  @IsISO8601()
  startedAt!: string;

  @IsISO8601()
  completedAt!: string;

  @ValidateNested()
  @Type(() => NmapRunDto)
  nmap!: NmapRunDto;

  @ValidateNested()
  @Type(() => NucleiRunDto)
  nuclei!: NucleiRunDto;

  @ValidateNested()
  @Type(() => TrivyRunDto)
  trivy!: TrivyRunDto;

  @ValidateNested()
  @Type(() => HttpxRunDto)
  httpx!: HttpxRunDto;

  @ValidateNested()
  @Type(() => LynisRunDto)
  lynis!: LynisRunDto;
}

/** Plain stored shapes. */
export interface SecurityFinding {
  source: EnvironmentTool;
  ruleId: string;
  severity: EnvironmentSeverity;
  title: string;
  description: string;
  target?: string;
  evidence?: string;
  cves: string[];
  remediation?: string;
}

export type ToolRun<T> = (
  | { status: 'ok'; result: T }
  | {
      status: 'failed';
      error: { kind: (typeof TOOL_FAILURE_KINDS)[number]; message: string };
    }
  | { status: 'skipped'; reason: string }
) & { tool: EnvironmentTool; startedAt: string; durationMs: number };

export interface NmapResult {
  hosts: {
    address: string;
    hostname?: string;
    ports: {
      port: number;
      protocol: 'tcp' | 'udp';
      state: (typeof NMAP_PORT_STATES)[number];
      service?: string;
      version?: string;
    }[];
  }[];
}

export interface NucleiResult {
  findings: SecurityFinding[];
}

export interface TrivyResult {
  vulnerabilities: {
    id: string;
    package: string;
    installedVersion: string;
    fixedVersion?: string;
    severity: EnvironmentSeverity;
    title: string;
    target: string;
  }[];
  misconfigurations: SecurityFinding[];
  secrets: SecurityFinding[];
}

export interface HttpxResult {
  targets: {
    url: string;
    statusCode?: number;
    title?: string;
    server?: string;
    technologies: string[];
    headers?: Record<string, string>;
    tls?: { enabled: boolean; version?: string };
  }[];
}

export interface LynisResult {
  score?: number;
  privileged: boolean;
  warnings: SecurityFinding[];
  suggestions: SecurityFinding[];
}

export interface EnvironmentRuns {
  nmap: ToolRun<NmapResult>;
  nuclei: ToolRun<NucleiResult>;
  trivy: ToolRun<TrivyResult>;
  httpx: ToolRun<HttpxResult>;
  lynis: ToolRun<LynisResult>;
}
