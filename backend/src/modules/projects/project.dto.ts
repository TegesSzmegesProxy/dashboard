import { Type } from 'class-transformer';
import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrganizationParamsDto } from '../organizations/organization.dto.js';

export const RUNTIME_BEHAVIORS = ['allow', 'block'] as const;
export type RuntimeBehavior = (typeof RUNTIME_BEHAVIORS)[number];

export class TenantParamsDto extends OrganizationParamsDto {
  @IsMongoId()
  tenantId!: string;
}

export class RoutingConfigurationDto {
  @ApiProperty({ example: '/' })
  @IsString()
  @Matches(/^\/(?:[^?#]*)$/)
  @MaxLength(512)
  pathPrefix!: string;
}

export class RuntimeThresholdsDto {
  @ApiProperty({ minimum: 100, maximum: 120000 })
  @IsInt()
  @Min(100)
  @Max(120000)
  requestTimeoutMs!: number;

  @ApiProperty({ minimum: 0, maximum: 104857600 })
  @IsInt()
  @Min(0)
  @Max(104857600)
  maxRequestBodyBytes!: number;
}

export class TenantRuntimeConfigurationDto {
  @ApiProperty({ example: 'https://app.internal.example' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  upstreamUrl!: string;

  @ApiProperty({ enum: RUNTIME_BEHAVIORS })
  @IsIn(RUNTIME_BEHAVIORS)
  failureBehavior!: RuntimeBehavior;

  @ApiProperty({ enum: RUNTIME_BEHAVIORS })
  @IsIn(RUNTIME_BEHAVIORS)
  unknownEndpointBehavior!: RuntimeBehavior;

  @ApiProperty({ type: RoutingConfigurationDto })
  @ValidateNested()
  @Type(() => RoutingConfigurationDto)
  routing!: RoutingConfigurationDto;

  @ApiProperty({ type: RuntimeThresholdsDto })
  @ValidateNested()
  @Type(() => RuntimeThresholdsDto)
  thresholds!: RuntimeThresholdsDto;

  @ApiProperty({ minimum: 0, maximum: 1 })
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(1)
  samplingRate!: number;
}

export class CreateTenantDto {
  @ApiProperty({ example: 'Checkout API' })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'checkout-api' })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(63)
  slug!: string;

  @ApiProperty({ type: TenantRuntimeConfigurationDto })
  @ValidateNested()
  @Type(() => TenantRuntimeConfigurationDto)
  runtimeConfiguration!: TenantRuntimeConfigurationDto;
}

export class UpdateTenantDto extends PartialType(CreateTenantDto) {}
