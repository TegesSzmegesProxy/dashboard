import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { DashboardAuthGuard } from '../auth/dashboard-auth.guard.js';
import type { DashboardPrincipal } from '../auth/dashboard-principal.js';
import { OrganizationRoleGuard } from '../organizations/organization-role.guard.js';
import { RequireOrganizationRoles } from '../organizations/organization-roles.decorator.js';
import { TenantParamsDto } from '../projects/project.dto.js';
import {
  PutEndpointOverridesDto,
  PutModelSettingsDto,
  PutPolicyDefaultsDto,
} from './tuning.dto.js';
import type {
  EndpointOverridesView,
  ModelSettingsView,
  PolicyDefaultsView,
} from './tuning.types.js';
import { TuningService } from './tuning.service.js';

@ApiTags('tuning')
@ApiBearerAuth()
@Controller('organizations/:organizationId/projects/:tenantId')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
export class TuningController {
  constructor(private readonly tuning: TuningService) {}

  @Get('model-settings')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  getModelSettings(
    @Param() params: TenantParamsDto,
  ): Promise<ModelSettingsView> {
    return this.tuning.getModelSettings(params.organizationId, params.tenantId);
  }

  @Put('model-settings')
  @RequireOrganizationRoles('owner', 'admin')
  setModelSettings(
    @Param() params: TenantParamsDto,
    @Body() dto: PutModelSettingsDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<ModelSettingsView> {
    return this.tuning.setModelSettings(
      params.organizationId,
      params.tenantId,
      dto,
      principal.subject,
    );
  }

  @Get('policy-defaults')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  getPolicyDefaults(
    @Param() params: TenantParamsDto,
  ): Promise<PolicyDefaultsView> {
    return this.tuning.getPolicyDefaults(
      params.organizationId,
      params.tenantId,
    );
  }

  @Put('policy-defaults')
  @RequireOrganizationRoles('owner', 'admin')
  setPolicyDefaults(
    @Param() params: TenantParamsDto,
    @Body() dto: PutPolicyDefaultsDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<PolicyDefaultsView> {
    return this.tuning.setPolicyDefaults(
      params.organizationId,
      params.tenantId,
      dto,
      principal.subject,
    );
  }

  @Get('endpoint-overrides')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  getEndpointOverrides(
    @Param() params: TenantParamsDto,
  ): Promise<EndpointOverridesView> {
    return this.tuning.getEndpointOverrides(
      params.organizationId,
      params.tenantId,
    );
  }

  @Put('endpoint-overrides')
  @RequireOrganizationRoles('owner', 'admin')
  setEndpointOverrides(
    @Param() params: TenantParamsDto,
    @Body() dto: PutEndpointOverridesDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<EndpointOverridesView> {
    return this.tuning.setEndpointOverrides(
      params.organizationId,
      params.tenantId,
      dto,
      principal.subject,
    );
  }
}
