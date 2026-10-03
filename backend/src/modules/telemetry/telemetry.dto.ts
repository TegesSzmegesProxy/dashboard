import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsMongoId,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { TenantParamsDto } from '../projects/project.dto.js';
import type { TelemetryGranularity } from './telemetry.types.js';

export class TelemetryQueryDto {
  @ApiProperty({ required: false, enum: ['minute', 'hour'], default: 'minute' })
  @IsOptional()
  @IsIn(['minute', 'hour'])
  granularity: TelemetryGranularity = 'minute';

  @ApiProperty({
    required: false,
    description:
      'Inclusive start; defaults to 1 hour (minute) or 24 hours (hour) before to',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiProperty({
    required: false,
    description: 'Exclusive end; defaults to now',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class AlertListQueryDto {
  @ApiProperty({ required: false, enum: ['open', 'resolved'], default: 'open' })
  @IsOptional()
  @IsIn(['open', 'resolved'])
  status: 'open' | 'resolved' = 'open';
}

export class AlertParamsDto extends TenantParamsDto {
  @IsMongoId()
  alertId!: string;
}

export class AlertSettingsDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 1,
    description:
      'Open an attack-rate alert when the last hour exceeds this ATTACK share of JEV-classified requests. null disables it; there is no default.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  attackRateThreshold!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 1,
    description:
      'Minimum JEV-classified requests in the last hour before the threshold applies. Required with attackRateThreshold.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 0 })
  @Min(1)
  @Max(1_000_000_000)
  attackRateMinClassified!: number | null;
}
