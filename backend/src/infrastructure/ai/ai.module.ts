import { Module } from '@nestjs/common';
import { AnalysisAiService } from './analysis-ai.service.js';
import { LlmPolicyGenerationProvider } from './llm-policy-generation.provider.js';
import { PolicyGenerationProvider } from './policy-generation.provider.js';

@Module({
  providers: [
    AnalysisAiService,
    {
      provide: PolicyGenerationProvider,
      useClass: LlmPolicyGenerationProvider,
    },
  ],
  exports: [AnalysisAiService, PolicyGenerationProvider],
})
export class AiModule {}
