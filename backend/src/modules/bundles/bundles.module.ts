import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EventsModule } from '../events/events.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { BundleSigningService } from './bundle-signing.service.js';
import { BundlesController } from './bundles.controller.js';
import { BundlesService } from './bundles.service.js';
import { ProxyBundlesController } from './proxy-bundles.controller.js';

@Module({
  imports: [
    ApiKeysModule,
    AuditModule,
    AuthModule,
    EventsModule,
    OrganizationsModule,
    ProjectsModule,
  ],
  controllers: [BundlesController, ProxyBundlesController],
  providers: [BundleSigningService, BundlesService],
  exports: [BundlesService],
})
export class BundlesModule {}
