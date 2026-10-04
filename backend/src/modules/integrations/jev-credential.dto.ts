import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class PutJevCredentialDto {
  @ApiProperty({
    description:
      'JEV API key. Write-only: it is encrypted at rest, never returned to the dashboard, and delivered only to deployment keys with jev-credentials:read.',
    writeOnly: true,
  })
  @IsString()
  @MaxLength(4096)
  // The proxy sends it as an HTTP credential: printable ASCII, no whitespace.
  @Matches(/^[\x21-\x7e]+$/, {
    message: 'apiKey must be printable ASCII without whitespace',
  })
  apiKey!: string;
}
