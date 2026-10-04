import { Module } from '@nestjs/common';
import { AnthropicPolicyGenerationProvider } from './anthropic-policy-generation.provider.js';
import { PolicyGenerationProvider } from './policy-generation.provider.js';

@Module({
  providers: [
    {
      provide: PolicyGenerationProvider,
      useClass: AnthropicPolicyGenerationProvider,
    },
  ],
  exports: [PolicyGenerationProvider],
})
export class AiModule {}
