import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { BundlesModule } from '../bundles/bundles.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ProxyHeartbeatsController } from './proxy-heartbeats.controller.js';
import { ProxyHeartbeatsService } from './proxy-heartbeats.service.js';
import { ProxyStatusController } from './proxy-status.controller.js';

@Module({
  imports: [
    ApiKeysModule,
    AuthModule,
    BundlesModule,
    OrganizationsModule,
    ProjectsModule,
  ],
  controllers: [ProxyHeartbeatsController, ProxyStatusController],
  providers: [ProxyHeartbeatsService],
})
export class TelemetryModule {}
