import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ORGANIZATION_ROLES } from './organization-role.js';
import type { OrganizationRole } from './organization-role.js';

export class OrganizationParamsDto {
  @IsMongoId()
  organizationId!: string;
}

export class MembershipParamsDto extends OrganizationParamsDto {
  @IsMongoId()
  membershipId!: string;
}

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Acme' })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(120)
  name!: string;
}

export class UpdateOrganizationDto extends PartialType(CreateOrganizationDto) {}

export class CreateMembershipDto {
  @ApiProperty({ description: 'Stable Auth0 subject identifier' })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(255)
  subject!: string;

  @ApiProperty({ enum: ORGANIZATION_ROLES })
  @IsIn(ORGANIZATION_ROLES)
  role!: OrganizationRole;
}

export class UpdateMembershipDto {
  @ApiProperty({ enum: ORGANIZATION_ROLES })
  @IsIn(ORGANIZATION_ROLES)
  role!: OrganizationRole;
}
