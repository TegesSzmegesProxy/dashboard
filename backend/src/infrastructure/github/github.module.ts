import { Module } from '@nestjs/common';
import { GitHubAppClient } from './github-app.client.js';

@Module({
  providers: [GitHubAppClient],
  exports: [GitHubAppClient],
})
export class GitHubModule {}
