import { Module } from '@nestjs/common';
import { SecretsModule } from '../../infrastructure/secrets/secrets.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { JevCredentialController } from './jev-credential.controller.js';
import { JevCredentialService } from './jev-credential.service.js';
import { ProxyJevCredentialController } from './proxy-jev-credential.controller.js';

@Module({
  imports: [
    ApiKeysModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    SecretsModule,
  ],
  controllers: [JevCredentialController, ProxyJevCredentialController],
  providers: [JevCredentialService],
})
export class IntegrationsModule {}
