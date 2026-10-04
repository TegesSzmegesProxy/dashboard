import { ApiProperty } from '@nestjs/swagger';
import {
  IsMongoId,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { TenantParamsDto } from '../projects/project.dto.js';

export class PolicyGenerationParamsDto extends TenantParamsDto {
  @IsMongoId()
  attemptId!: string;
}

export class EditPolicyDto {
  @ApiProperty({
    maxLength: 2_000,
    description:
      'Natural-language change to the base version. The result is a new ' +
      'version that must be reviewed; see precisionWarning.',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(2_000)
  instruction!: string;
}
