import { Module } from '@nestjs/common';
import { AiModule } from '../../infrastructure/ai/ai.module.js';
import { AnalysesModule } from '../analyses/analyses.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EventsModule } from '../events/events.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { PoliciesModule } from '../policies/policies.module.js';
import { PolicyCompilerModule } from '../policy-compiler/policy-compiler.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { PolicyGenerationWorker } from './policy-generation-worker.service.js';
import { PolicyGenerationController } from './policy-generation.controller.js';
import { PolicyGenerationPipeline } from './policy-generation.pipeline.js';
import { PolicyGenerationService } from './policy-generation.service.js';

@Module({
  imports: [
    AiModule,
    AnalysesModule,
    AuditModule,
    AuthModule,
    EventsModule,
    OrganizationsModule,
    PoliciesModule,
    PolicyCompilerModule,
    ProjectsModule,
  ],
  controllers: [PolicyGenerationController],
  providers: [
    PolicyGenerationService,
    PolicyGenerationPipeline,
    PolicyGenerationWorker,
  ],
})
export class PolicyGenerationModule {}
