import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const POLICY_SCHEMA_VERSION = 'tessera.policy/v1' as const;
export const TOOL_REGISTRY_VERSION = 'tessera.tools/v1' as const;
export const HTTP_METHODS = [
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
] as const;
export type PolicyHttpMethod = (typeof HTTP_METHODS)[number];

export class PolicyToolConfigDto {
  @ApiProperty({ required: false, minimum: 0, maximum: 1_000_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  minLength?: number;

  @ApiProperty({ required: false, minimum: 0, maximum: 1_000_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  maxLength?: number;
}

export class PolicyToolDto {
  @ApiProperty({ example: 'string_length' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  toolId!: string;

  @ApiProperty({ example: 'body.username' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  target!: string;

  @ApiProperty({ type: PolicyToolConfigDto })
  @IsObject()
  @ValidateNested()
  @Type(() => PolicyToolConfigDto)
  config!: PolicyToolConfigDto;
}

export class EndpointPolicyDto {
  @ApiProperty({ enum: HTTP_METHODS })
  @IsIn(HTTP_METHODS)
  method!: PolicyHttpMethod;

  @ApiProperty({ example: '/users/:id' })
  @IsString()
  @Matches(/^\/(?!.*[?#\s]).*$/)
  @MaxLength(1024)
  path!: string;

  @ApiProperty({ type: PolicyToolDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PolicyToolDto)
  tools!: PolicyToolDto[];
}

export class StructuredPolicyV1Dto {
  @ApiProperty({ enum: [POLICY_SCHEMA_VERSION] })
  @IsIn([POLICY_SCHEMA_VERSION])
  schemaVersion!: typeof POLICY_SCHEMA_VERSION;

  @ApiProperty({ type: EndpointPolicyDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => EndpointPolicyDto)
  endpoints!: EndpointPolicyDto[];
}
