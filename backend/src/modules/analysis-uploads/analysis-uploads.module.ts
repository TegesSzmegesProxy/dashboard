import { Module } from '@nestjs/common';
import { AnalysesModule } from '../analyses/analyses.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { SourceRepositoriesModule } from '../source-repositories/source-repositories.module.js';
import {
  AnalysisUploadsController,
  CollectorUploadsController,
} from './analysis-uploads.controller.js';
import { AnalysisUploadsService } from './analysis-uploads.service.js';

@Module({
  imports: [
    AnalysesModule,
    ApiKeysModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    ProjectsModule,
    SourceRepositoriesModule,
  ],
  controllers: [CollectorUploadsController, AnalysisUploadsController],
  providers: [AnalysisUploadsService],
})
export class AnalysisUploadsModule {}
