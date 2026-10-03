import { Module } from '@nestjs/common';
import { AnthropicApplicationAnalysisProvider } from './anthropic-application-analysis.provider.js';
import { AnthropicPolicyGenerationProvider } from './anthropic-policy-generation.provider.js';
import { ApplicationAnalysisProvider } from './application-analysis.provider.js';
import { PolicyGenerationProvider } from './policy-generation.provider.js';

@Module({
  providers: [
    {
      provide: ApplicationAnalysisProvider,
      useClass: AnthropicApplicationAnalysisProvider,
    },
    {
      provide: PolicyGenerationProvider,
      useClass: AnthropicPolicyGenerationProvider,
    },
  ],
  exports: [ApplicationAnalysisProvider, PolicyGenerationProvider],
})
export class AiModule {}
