import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DashboardAuthGuard } from '../auth/dashboard-auth.guard.js';
import { OrganizationRoleGuard } from '../organizations/organization-role.guard.js';
import { RequireOrganizationRoles } from '../organizations/organization-roles.decorator.js';
import { TenantParamsDto } from '../projects/project.dto.js';
import type { ActiveBundleView } from './bundle.types.js';
import { BundlesService } from './bundles.service.js';

@ApiTags('bundles')
@ApiBearerAuth()
@Controller('organizations/:organizationId/projects/:tenantId/bundles')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
export class BundlesController {
  constructor(private readonly bundles: BundlesService) {}

  @Get('active')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  getActive(@Param() params: TenantParamsDto): Promise<ActiveBundleView> {
    return this.bundles.getActiveView(params.organizationId, params.tenantId);
  }
}
