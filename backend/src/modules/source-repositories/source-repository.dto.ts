import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { OrganizationParamsDto } from '../organizations/organization.dto.js';

export class InstallationParamsDto extends OrganizationParamsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  installationId!: number;
}

export class LinkGitHubInstallationDto {
  @ApiProperty({
    description: 'installation_id from the GitHub App setup callback',
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  installationId!: number;

  @ApiProperty({ description: 'OAuth code from the GitHub App setup callback' })
  @IsString()
  @Matches(/^[\w-]{1,200}$/)
  code!: string;
}

export class BindRepositoryDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  installationId!: number;

  @ApiProperty({ example: 'acme' })
  @Matches(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/)
  owner!: string;

  @ApiProperty({ example: 'checkout-api' })
  @Matches(/^[A-Za-z0-9._-]{1,100}$/)
  @MaxLength(100)
  name!: string;
}
