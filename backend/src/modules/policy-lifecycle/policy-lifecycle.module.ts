import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { PoliciesModule } from '../policies/policies.module.js';
import { PolicyLifecycleController } from './policy-lifecycle.controller.js';
import { PolicyLifecycleService } from './policy-lifecycle.service.js';

@Module({
  imports: [AuthModule, OrganizationsModule, PoliciesModule],
  controllers: [PolicyLifecycleController],
  providers: [PolicyLifecycleService],
})
export class PolicyLifecycleModule {}
