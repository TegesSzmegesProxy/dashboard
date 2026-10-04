import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  AI_MODEL_PROVIDERS,
  type AiModelProvider,
} from './ai-model-credential.types.js';

export class PutAiModelCredentialDto {
  @ApiProperty({ enum: AI_MODEL_PROVIDERS })
  @IsIn(AI_MODEL_PROVIDERS)
  provider!: AiModelProvider;

  @ApiPropertyOptional({
    description:
      'AI model provider API key, required for openai and anthropic and not accepted for local. Write-only: it is encrypted at rest and never returned to the dashboard.',
    writeOnly: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  // Provider SDKs send it as an HTTP credential: printable ASCII, no whitespace.
  @Matches(/^[\x21-\x7e]+$/, {
    message: 'apiKey must be printable ASCII without whitespace',
  })
  apiKey?: string;

  @ApiPropertyOptional({
    description:
      'Endpoint of a local model with an Anthropic-compatible API, for example http://localhost:11434. Required for local and not accepted for other providers. Local, private and plain-http addresses are accepted only when the control plane sets AI_MODEL_ALLOW_PRIVATE_BASE_URL.',
    example: 'http://localhost:11434',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  baseUrl?: string;
}
