import { Module } from '@nestjs/common';
import { GitHubModule } from '../../infrastructure/github/github.module.js';
import { SandboxModule } from '../../infrastructure/sandbox/sandbox.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EnvironmentSnapshotsModule } from '../environment-snapshots/environment-snapshots.module.js';
import { EventsModule } from '../events/events.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { SourceRepositoriesModule } from '../source-repositories/source-repositories.module.js';
import { AnalysesController } from './analyses.controller.js';
import { AnalysesService } from './analyses.service.js';
import { AnalysisPipeline } from './analysis-pipeline.service.js';
import { AnalysisWorker } from './analysis-worker.service.js';

@Module({
  imports: [
    AuditModule,
    AuthModule,
    EnvironmentSnapshotsModule,
    EventsModule,
    GitHubModule,
    IntegrationsModule,
    OrganizationsModule,
    ProjectsModule,
    SandboxModule,
    SourceRepositoriesModule,
  ],
  controllers: [AnalysesController],
  providers: [AnalysesService, AnalysisPipeline, AnalysisWorker],
  exports: [AnalysesService],
})
export class AnalysesModule {}
