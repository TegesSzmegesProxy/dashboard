import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { API_KEY_SCOPES, API_KEY_TYPES } from './api-key.constants.js';
import type { ApiKeyScope, ApiKeyType } from './api-key.constants.js';
import { OrganizationParamsDto } from '../organizations/organization.dto.js';

export class ApiKeyParamsDto extends OrganizationParamsDto {
  @IsMongoId()
  apiKeyId!: string;
}

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Production collector' })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: API_KEY_TYPES })
  @IsIn(API_KEY_TYPES)
  type!: ApiKeyType;

  @ApiProperty({ enum: API_KEY_SCOPES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes!: ApiKeyScope[];

  @ApiProperty({ type: String, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsMongoId({ each: true })
  allowedTenantIds!: string[];
}
