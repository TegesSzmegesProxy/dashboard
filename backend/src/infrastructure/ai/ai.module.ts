import { Module } from '@nestjs/common';
import { AnalysisAiService } from './analysis-ai.service.js';
import { AnthropicPolicyGenerationProvider } from './anthropic-policy-generation.provider.js';
import { PolicyGenerationProvider } from './policy-generation.provider.js';

@Module({
  providers: [
    AnalysisAiService,
    {
      provide: PolicyGenerationProvider,
      useClass: AnthropicPolicyGenerationProvider,
    },
  ],
  exports: [AnalysisAiService, PolicyGenerationProvider],
})
export class AiModule {}
