import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { StructuredPolicyV1Dto } from '../../contracts/policy/v1/policy.contract.js';
import { TenantParamsDto } from '../projects/project.dto.js';

export class PolicyVersionParamsDto extends TenantParamsDto {
  @Matches(/^[a-f0-9]{64}$/)
  version!: string;
}

export class ImportPolicyDto {
  @ApiProperty({ maxLength: 10_000 })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(10_000)
  humanReadableIntent!: string;

  @ApiProperty({ type: StructuredPolicyV1Dto })
  @ValidateNested()
  @Type(() => StructuredPolicyV1Dto)
  structuredPolicy!: StructuredPolicyV1Dto;
}

export class RejectPolicyDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(500)
  reason!: string;
}
