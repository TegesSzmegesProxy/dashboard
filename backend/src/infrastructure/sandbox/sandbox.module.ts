import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from '../../config/environment.js';
import {
  DockerRepoSandbox,
  LocalProcessRepoSandbox,
  RepoSandbox,
  UnconfiguredRepoSandbox,
} from './repo-sandbox.js';

@Module({
  providers: [
    {
      provide: RepoSandbox,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>): RepoSandbox => {
        const kind = config.get('ANALYSIS_SANDBOX', { infer: true });
        const wallTimeMs = config.get('ANALYSIS_SANDBOX_TIMEOUT_MS', {
          infer: true,
        });
        if (kind === 'docker') {
          return new DockerRepoSandbox(
            config.get('ANALYSIS_SANDBOX_IMAGE', { infer: true }),
            config.get('ANALYSIS_SANDBOX_RUNTIME', { infer: true }),
            config.get('ANALYSIS_SANDBOX_MEMORY_MB', { infer: true }),
            wallTimeMs,
          );
        }
        if (kind === 'local-process') {
          if (config.get('NODE_ENV', { infer: true }) === 'production') {
            throw new Error(
              'ANALYSIS_SANDBOX=local-process is refused in production',
            );
          }
          return new LocalProcessRepoSandbox(wallTimeMs);
        }
        return new UnconfiguredRepoSandbox();
      },
    },
  ],
  exports: [RepoSandbox],
})
export class SandboxModule {}
