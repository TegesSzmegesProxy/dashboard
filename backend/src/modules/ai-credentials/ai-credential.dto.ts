import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class SetAiCredentialDto {
  @ApiProperty({
    description: 'Anthropic API key. Write-only; never returned.',
  })
  @IsString()
  @Matches(/^sk-ant-[A-Za-z0-9_-]{20,300}$/, {
    message: 'apiKey must be an Anthropic API key',
  })
  apiKey!: string;
}
