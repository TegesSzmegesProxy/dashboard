import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import {
  AI_MODEL_PROVIDERS,
  type AiModelProvider,
} from './ai-model-credential.types.js';

export class PutAiModelCredentialDto {
  @ApiProperty({ enum: AI_MODEL_PROVIDERS })
  @IsIn(AI_MODEL_PROVIDERS)
  provider!: AiModelProvider;

  @ApiProperty({
    description:
      'AI model provider API key. Write-only: it is encrypted at rest and never returned to the dashboard.',
    writeOnly: true,
  })
  @IsString()
  @MaxLength(4096)
  // Provider SDKs send it as an HTTP credential: printable ASCII, no whitespace.
  @Matches(/^[\x21-\x7e]+$/, {
    message: 'apiKey must be printable ASCII without whitespace',
  })
  apiKey!: string;
}
