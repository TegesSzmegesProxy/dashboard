import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ApiKeySecretService } from './api-key-secret.service.js';
import { ApiKeysController } from './api-keys.controller.js';
import { ApiKeysService } from './api-keys.service.js';
import { CollectorKeyGuard, DeploymentKeyGuard } from './machine-key.guard.js';
import { MachineRateLimiter } from './machine-rate-limiter.service.js';

@Module({
  imports: [AuthModule, AuditModule, OrganizationsModule, ProjectsModule],
  controllers: [ApiKeysController],
  providers: [
    ApiKeySecretService,
    ApiKeysService,
    MachineRateLimiter,
    CollectorKeyGuard,
    DeploymentKeyGuard,
  ],
  exports: [
    ApiKeysService,
    CollectorKeyGuard,
    DeploymentKeyGuard,
    MachineRateLimiter,
  ],
})
export class ApiKeysModule {}
