import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  HTTP_METHODS,
  type PolicyHttpMethod,
} from '../../contracts/policy/v1/policy.contract.js';
import {
  FIELD_RULES,
  POLICY_ACTIONS,
  type FieldRule,
  type PolicyAction,
} from './tuning.types.js';

const CONSTRAINTS_MAX_LENGTH = 2000;

export class PutModelSettingsDto {
  @ApiProperty({
    minimum: 1,
    maximum: 100,
    description:
      'Number of most recent requests given to the model as context.',
  })
  @IsInt()
  @Min(1)
  @Max(100)
  contextLength!: number;

  @ApiProperty({ minimum: 0, maximum: 2 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(2)
  temperature!: number;

  @ApiProperty({ minimum: 0, maximum: 1 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  topP!: number;

  @ApiProperty({ minimum: 1, maximum: 1_000_000, description: 'Per response.' })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxTokens!: number;
}

export class PutPolicyDefaultsDto {
  @ApiProperty({ enum: POLICY_ACTIONS })
  @IsIn(POLICY_ACTIONS)
  defaultAction!: PolicyAction;

  @ApiProperty({
    maxLength: CONSTRAINTS_MAX_LENGTH,
    description:
      'Free-text constraints for every endpoint. May be empty; must not contain credentials.',
  })
  @IsString()
  @MaxLength(CONSTRAINTS_MAX_LENGTH)
  customConstraints!: string;

  @ApiProperty({
    minimum: 0,
    maximum: 1,
    description: 'Score at which a policy is triggered.',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  threshold!: number;
}

export class FieldOverrideDto {
  @ApiProperty({ example: 'card_number', maxLength: 256 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  name!: string;

  @ApiProperty({ enum: FIELD_RULES })
  @IsIn(FIELD_RULES)
  rule!: FieldRule;

  @ApiProperty({
    maxLength: CONSTRAINTS_MAX_LENGTH,
    description: 'May be empty; must not contain credentials.',
  })
  @IsString()
  @MaxLength(CONSTRAINTS_MAX_LENGTH)
  constraints!: string;
}

export class EndpointOverrideDto {
  @ApiProperty({ enum: HTTP_METHODS })
  @IsIn(HTTP_METHODS)
  method!: PolicyHttpMethod;

  // Same path rules as `tessera.policy/v1` endpoints.
  @ApiProperty({ example: '/v1/checkout' })
  @IsString()
  @Matches(/^\/(?!.*[?#\s]).*$/)
  @MaxLength(1024)
  path!: string;

  @ApiProperty({
    enum: POLICY_ACTIONS,
    nullable: true,
    description: 'null uses the policy defaults.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsIn(POLICY_ACTIONS)
  requestPolicy!: PolicyAction | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 1,
    description: 'null uses the policy defaults.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  threshold!: number | null;

  @ApiProperty({ type: FieldOverrideDto, isArray: true })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FieldOverrideDto)
  fields!: FieldOverrideDto[];
}

export class PutEndpointOverridesDto {
  @ApiProperty({
    type: EndpointOverrideDto,
    isArray: true,
    description: 'Replaces every override of the project. Empty clears them.',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => EndpointOverrideDto)
  endpoints!: EndpointOverrideDto[];
}
