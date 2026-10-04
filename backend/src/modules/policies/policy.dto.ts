import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { StructuredPolicyV1Dto } from '../../contracts/policy/v1/policy.contract.js';
import {
  EndpointPolicyV2Dto,
  FIELD_LOCATIONS_V2,
  FIELD_NAME_PATTERN,
  StructuredPolicyV2Dto,
} from '../../contracts/policy/v2/policy.contract.js';
import type { FieldLocationV2 } from '../../contracts/policy/v2/policy.contract.js';
import { StructuredPolicyV3Dto } from '../../contracts/policy/v3/policy.contract.js';
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

export class SavePolicyDraftDto {
  @ApiProperty({ description: 'The version the draft was started from.' })
  @Matches(/^[a-f0-9]{64}$/)
  parentVersion!: string;

  @ApiProperty({ type: StructuredPolicyV2Dto })
  @ValidateNested()
  @Type(() => StructuredPolicyV2Dto)
  structuredPolicy!: StructuredPolicyV2Dto;
}

export class SavePolicyDraftV3Dto {
  @ApiProperty({ description: 'The version the draft was started from.' })
  @Matches(/^[a-f0-9]{64}$/)
  parentVersion!: string;

  @ApiProperty({ type: StructuredPolicyV3Dto })
  @ValidateNested()
  @Type(() => StructuredPolicyV3Dto)
  structuredPolicy!: StructuredPolicyV3Dto;
}

export class CompileTargetDto {
  @IsIn(['endpoint', 'field'])
  kind!: 'endpoint' | 'field';

  @ValidateIf((target: CompileTargetDto) => target.kind === 'field')
  @IsIn(FIELD_LOCATIONS_V2)
  location?: FieldLocationV2;

  @ValidateIf((target: CompileTargetDto) => target.kind === 'field')
  @IsString()
  @Matches(FIELD_NAME_PATTERN)
  name?: string;
}

export class CompileHumanReadablePolicyDto {
  @ApiProperty({ description: 'The version the draft was started from.' })
  @Matches(/^[a-f0-9]{64}$/)
  parentVersion!: string;

  @ApiProperty({
    type: EndpointPolicyV2Dto,
    description: 'The endpoint as it is in the draft, with the edited text.',
  })
  @ValidateNested()
  @Type(() => EndpointPolicyV2Dto)
  endpoint!: EndpointPolicyV2Dto;

  @ApiProperty({ type: CompileTargetDto })
  @ValidateNested()
  @Type(() => CompileTargetDto)
  target!: CompileTargetDto;
}
