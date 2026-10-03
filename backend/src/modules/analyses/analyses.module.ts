import { Module } from '@nestjs/common';
import { AiModule } from '../../infrastructure/ai/ai.module.js';
import { GitHubModule } from '../../infrastructure/github/github.module.js';
import { ObjectStorageModule } from '../../infrastructure/object-storage/object-storage.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EventsModule } from '../events/events.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { SourceRepositoriesModule } from '../source-repositories/source-repositories.module.js';
import { AnalysesController } from './analyses.controller.js';
import { AnalysesService } from './analyses.service.js';
import { AnalysisPipeline } from './analysis-pipeline.service.js';
import { AnalysisWorker } from './analysis-worker.service.js';
import { SourceSnapshotBuilder } from './source-snapshot.builder.js';

@Module({
  imports: [
    AiModule,
    AuthModule,
    EventsModule,
    GitHubModule,
    ObjectStorageModule,
    OrganizationsModule,
    SourceRepositoriesModule,
  ],
  controllers: [AnalysesController],
  providers: [
    AnalysesService,
    AnalysisPipeline,
    AnalysisWorker,
    SourceSnapshotBuilder,
  ],
  exports: [AnalysesService],
})
export class AnalysesModule {}
