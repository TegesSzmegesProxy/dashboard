import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CursorPage,
  CursorPaginationDto,
} from '../../common/cursor-pagination.js';
import { DashboardAuthGuard } from '../auth/dashboard-auth.guard.js';
import { OrganizationRoleGuard } from '../organizations/organization-role.guard.js';
import { RequireOrganizationRoles } from '../organizations/organization-roles.decorator.js';
import { TenantParamsDto } from '../projects/project.dto.js';
import type { ProxyInstanceView } from './proxy-heartbeat.types.js';
import { ProxyHeartbeatsService } from './proxy-heartbeats.service.js';

@ApiTags('proxy status')
@ApiBearerAuth()
@Controller('organizations/:organizationId/projects/:tenantId/proxies')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
export class ProxyStatusController {
  constructor(private readonly heartbeats: ProxyHeartbeatsService) {}

  @Get()
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  list(
    @Param() params: TenantParamsDto,
    @Query() pagination: CursorPaginationDto,
  ): Promise<CursorPage<ProxyInstanceView>> {
    return this.heartbeats.listForTenant(
      params.organizationId,
      params.tenantId,
      pagination,
    );
  }
}
