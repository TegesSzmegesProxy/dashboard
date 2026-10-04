import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EventsModule } from '../events/events.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import {
  CollectorEnvironmentSnapshotsController,
  EnvironmentSnapshotsController,
} from './environment-snapshots.controller.js';
import { EnvironmentSnapshotsService } from './environment-snapshots.service.js';

@Module({
  imports: [
    ApiKeysModule,
    AuditModule,
    AuthModule,
    EventsModule,
    OrganizationsModule,
    ProjectsModule,
  ],
  controllers: [
    CollectorEnvironmentSnapshotsController,
    EnvironmentSnapshotsController,
  ],
  providers: [EnvironmentSnapshotsService],
  exports: [EnvironmentSnapshotsService],
})
export class EnvironmentSnapshotsModule {}
