import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { TuningController } from './tuning.controller.js';
import { TuningService } from './tuning.service.js';

@Module({
  imports: [AuthModule, AuditModule, OrganizationsModule, ProjectsModule],
  controllers: [TuningController],
  providers: [TuningService],
})
export class TuningModule {}
