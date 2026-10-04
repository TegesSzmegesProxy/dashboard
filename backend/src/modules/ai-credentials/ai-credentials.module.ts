import { Module } from '@nestjs/common';
import { SecretsModule } from '../../infrastructure/secrets/secrets.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { AiCredentialsController } from './ai-credentials.controller.js';
import { AiCredentialsService } from './ai-credentials.service.js';

@Module({
  imports: [AuditModule, AuthModule, OrganizationsModule, SecretsModule],
  controllers: [AiCredentialsController],
  providers: [AiCredentialsService],
  exports: [AiCredentialsService],
})
export class AiCredentialsModule {}
