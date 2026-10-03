import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsObject,
  IsNumber,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * Batched, redacted proxy telemetry. Every value is a counter or a bounded
 * gauge; the contract has no free-text fields. Endpoints are identified only
 * by the policy endpoint key ("METHOD /path" with ":param" segments) from the
 * bundle the proxy had loaded, never by a raw request path.
 */
export const TELEMETRY_SCHEMA_VERSION = 'tessera.telemetry/v1' as const;
/** Every window covers one UTC minute starting at `windowStart`. */
export const TELEMETRY_WINDOW_SECONDS = 60;
export const MAX_TELEMETRY_COUNT = 1_000_000_000;
export const MAX_TELEMETRY_ENDPOINT_ENTRIES = 5_000;

export class TelemetryDecisionCountsV1Dto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_TELEMETRY_COUNT)
  allow!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_TELEMETRY_COUNT)
  block!: number;
}

export class TelemetryStaticVerdictCountsV1Dto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_TELEMETRY_COUNT)
  safe!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_TELEMETRY_COUNT)
  suspicious!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_TELEMETRY_COUNT)
  policyViolation!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_TELEMETRY_COUNT)
  error!: number;
}

export class TelemetryJevCountsV1Dto {
  @ApiProperty({
    minimum: 0,
    description: 'SAFE requests selected by sampling',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_TELEMETRY_COUNT)
  sampledSafe!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_TELEMETRY_COUNT)
  attack!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_TELEMETRY_COUNT)
  benign!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_TELEMETRY_COUNT)
  unavailable!: number;
}

export class TelemetryEndpointV1Dto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'POST /users/:id',
    description:
      'Policy endpoint key from the loaded bundle; null aggregates requests that matched no policy endpoint',
  })
  @ValidateIf((_, value) => value !== null)
  @Matches(/^(DELETE|GET|HEAD|OPTIONS|PATCH|POST|PUT) \/(?!.*[?#\s]).*$/)
  @MaxLength(1040)
  endpoint!: string | null;

  @ApiProperty({ type: TelemetryDecisionCountsV1Dto })
  @IsObject()
  @ValidateNested()
  @Type(() => TelemetryDecisionCountsV1Dto)
  decisions!: TelemetryDecisionCountsV1Dto;

  @ApiProperty({ type: TelemetryStaticVerdictCountsV1Dto })
  @IsObject()
  @ValidateNested()
  @Type(() => TelemetryStaticVerdictCountsV1Dto)
  staticVerdicts!: TelemetryStaticVerdictCountsV1Dto;

  @ApiProperty({ type: TelemetryJevCountsV1Dto })
  @IsObject()
  @ValidateNested()
  @Type(() => TelemetryJevCountsV1Dto)
  jev!: TelemetryJevCountsV1Dto;

  @ApiProperty({
    minimum: 0,
    description: 'Decisions taken by the tenant failure behavior',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_TELEMETRY_COUNT)
  failureBehaviorApplied!: number;

  @ApiProperty({
    required: false,
    nullable: true,
    minimum: 0,
    maximum: 1,
    description: 'Sampling rate in effect at the end of the window',
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  samplingRate?: number | null;

  @ApiProperty({
    required: false,
    nullable: true,
    minimum: 0,
    maximum: 1,
    description: 'Endpoint attack-rate EWMA at the end of the window',
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  attackRateEwma?: number | null;
}

export class TelemetryTenantEventsV1Dto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_TELEMETRY_COUNT)
  bundleVerificationFailures!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_TELEMETRY_COUNT)
  bundlePullFailures!: number;

  @ApiProperty({
    minimum: 0,
    description: 'Earlier telemetry windows the proxy dropped',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_TELEMETRY_COUNT)
  droppedWindows!: number;
}

export class TelemetryWindowV1Dto {
  @ApiProperty()
  @IsMongoId()
  tenantId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Bundle loaded during the window; null when none is loaded',
  })
  @ValidateIf((_, value) => value !== null)
  @Matches(/^[a-f0-9]{64}$/)
  bundleVersion!: string | null;

  @ApiProperty({ example: '2026-10-03T12:34:00.000Z' })
  @IsISO8601({ strict: true })
  windowStart!: string;

  @ApiProperty({ type: TelemetryEndpointV1Dto, isArray: true })
  @IsArray()
  @ArrayMaxSize(501)
  @ValidateNested({ each: true })
  @Type(() => TelemetryEndpointV1Dto)
  endpoints!: TelemetryEndpointV1Dto[];

  @ApiProperty({ type: TelemetryTenantEventsV1Dto })
  @IsObject()
  @ValidateNested()
  @Type(() => TelemetryTenantEventsV1Dto)
  events!: TelemetryTenantEventsV1Dto;

  @ApiProperty({
    required: false,
    nullable: true,
    minimum: 0,
    maximum: 1,
    description: 'Tenant attack-rate EWMA at the end of the window',
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  attackRateEwma?: number | null;
}

export class TelemetryBatchV1Dto {
  @ApiProperty({ enum: [TELEMETRY_SCHEMA_VERSION] })
  @IsIn([TELEMETRY_SCHEMA_VERSION])
  schemaVersion!: typeof TELEMETRY_SCHEMA_VERSION;

  @ApiProperty({ description: 'Same instance id as in heartbeats' })
  @IsUUID()
  instanceId!: string;

  @ApiProperty({ description: 'Random per batch; retries reuse it' })
  @IsUUID()
  batchId!: string;

  @ApiProperty({ type: TelemetryWindowV1Dto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1_440)
  @ValidateNested({ each: true })
  @Type(() => TelemetryWindowV1Dto)
  windows!: TelemetryWindowV1Dto[];
}
