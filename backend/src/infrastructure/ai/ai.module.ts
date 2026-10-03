import { Module } from '@nestjs/common';
import { AnthropicApplicationAnalysisProvider } from './anthropic-application-analysis.provider.js';
import { ApplicationAnalysisProvider } from './application-analysis.provider.js';

@Module({
  providers: [
    {
      provide: ApplicationAnalysisProvider,
      useClass: AnthropicApplicationAnalysisProvider,
    },
  ],
  exports: [ApplicationAnalysisProvider],
})
export class AiModule {}
