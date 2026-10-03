import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const HEARTBEAT_SCHEMA_VERSION = 'tessera.heartbeat/v1' as const;
export const BUNDLE_SOURCES = ['remote', 'last_known_good', 'none'] as const;
export type BundleSource = (typeof BUNDLE_SOURCES)[number];
export const PROXY_HEALTH_STATES = ['ok', 'degraded'] as const;
export type ProxyHealth = (typeof PROXY_HEALTH_STATES)[number];

const CONTRACT_ID_PATTERN = /^[a-z0-9.-]+\/v[0-9]+$/;

export class HeartbeatTenantV1Dto {
  @ApiProperty()
  @IsMongoId()
  tenantId!: string;

  @ApiProperty({ enum: BUNDLE_SOURCES })
  @IsIn(BUNDLE_SOURCES)
  bundleSource!: BundleSource;

  @ApiProperty({
    required: false,
    description: 'Required unless bundleSource is none',
  })
  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  loadedBundleVersion?: string;
}

export class ProxyHeartbeatV1Dto {
  @ApiProperty({ enum: [HEARTBEAT_SCHEMA_VERSION] })
  @IsIn([HEARTBEAT_SCHEMA_VERSION])
  schemaVersion!: typeof HEARTBEAT_SCHEMA_VERSION;

  @ApiProperty({ description: 'Random identifier of one proxy process' })
  @IsUUID()
  instanceId!: string;

  @ApiProperty({ example: '0.1.0' })
  @IsString()
  @Matches(/^[\w.+-]+$/)
  @MaxLength(64)
  proxyVersion!: string;

  @ApiProperty({ type: String, isArray: true, example: ['tessera.bundle/v1'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @Matches(CONTRACT_ID_PATTERN, { each: true })
  @MaxLength(64, { each: true })
  supportedBundleSchemas!: string[];

  @ApiProperty({ type: String, isArray: true, example: ['tessera.tools/v1'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @Matches(CONTRACT_ID_PATTERN, { each: true })
  @MaxLength(64, { each: true })
  supportedToolRegistries!: string[];

  @ApiProperty({ enum: PROXY_HEALTH_STATES })
  @IsIn(PROXY_HEALTH_STATES)
  health!: ProxyHealth;

  @ApiProperty({ type: HeartbeatTenantV1Dto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => HeartbeatTenantV1Dto)
  tenants!: HeartbeatTenantV1Dto[];
}
