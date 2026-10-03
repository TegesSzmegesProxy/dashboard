import { Module } from '@nestjs/common';
import { GitHubModule } from '../../infrastructure/github/github.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { SourceRepositoriesController } from './source-repositories.controller.js';
import { SourceRepositoriesService } from './source-repositories.service.js';

@Module({
  imports: [
    AuditModule,
    AuthModule,
    GitHubModule,
    OrganizationsModule,
    ProjectsModule,
  ],
  controllers: [SourceRepositoriesController],
  providers: [SourceRepositoriesService],
  exports: [SourceRepositoriesService],
})
export class SourceRepositoriesModule {}
