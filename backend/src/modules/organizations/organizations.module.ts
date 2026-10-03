import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MembershipsController } from './memberships.controller.js';
import { MembershipsService } from './memberships.service.js';
import { OrganizationRoleGuard } from './organization-role.guard.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [OrganizationsController, MembershipsController],
  providers: [OrganizationsService, MembershipsService, OrganizationRoleGuard],
  exports: [MembershipsService, OrganizationRoleGuard],
})
export class OrganizationsModule {}
