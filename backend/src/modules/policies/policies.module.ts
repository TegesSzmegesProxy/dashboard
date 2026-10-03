import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EventsModule } from '../events/events.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { PolicyCompilerModule } from '../policy-compiler/policy-compiler.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { PoliciesController } from './policies.controller.js';
import { PoliciesService } from './policies.service.js';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    EventsModule,
    OrganizationsModule,
    PolicyCompilerModule,
    ProjectsModule,
  ],
  controllers: [PoliciesController],
  providers: [PoliciesService],
  exports: [PoliciesService],
})
export class PoliciesModule {}
