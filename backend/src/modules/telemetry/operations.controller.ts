import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { DashboardAuthGuard } from '../auth/dashboard-auth.guard.js';
import type { DashboardPrincipal } from '../auth/dashboard-principal.js';
import { OrganizationRoleGuard } from '../organizations/organization-role.guard.js';
import { RequireOrganizationRoles } from '../organizations/organization-roles.decorator.js';
import { TenantParamsDto } from '../projects/project.dto.js';
import type {
  AlertSettingsView,
  OperationalAlertView,
} from './operational-alert.types.js';
import { OperationalAlertsService } from './operational-alerts.service.js';
import {
  OperationsOverviewService,
  OperationsOverviewView,
} from './operations-overview.service.js';
import {
  AlertListQueryDto,
  AlertParamsDto,
  AlertSettingsDto,
  TelemetryQueryDto,
} from './telemetry.dto.js';
import type { TelemetrySummaryView } from './telemetry.types.js';
import { TelemetryQueryService } from './telemetry-query.service.js';

@ApiTags('operations')
@ApiBearerAuth()
@Controller('organizations/:organizationId/projects/:tenantId')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
export class OperationsController {
  constructor(
    private readonly overviews: OperationsOverviewService,
    private readonly telemetry: TelemetryQueryService,
    private readonly alerts: OperationalAlertsService,
  ) {}

  @Get('operations')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  overview(@Param() params: TenantParamsDto): Promise<OperationsOverviewView> {
    return this.overviews.overview(params.organizationId, params.tenantId);
  }

  @Get('telemetry')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  summary(
    @Param() params: TenantParamsDto,
    @Query() query: TelemetryQueryDto,
  ): Promise<TelemetrySummaryView> {
    return this.telemetry.summary(
      params.organizationId,
      params.tenantId,
      query,
    );
  }

  @Get('alerts')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  listAlerts(
    @Param() params: TenantParamsDto,
    @Query() query: AlertListQueryDto,
  ): Promise<OperationalAlertView[]> {
    return this.alerts.list(
      params.organizationId,
      params.tenantId,
      query.status,
    );
  }

  @Post('alerts/:alertId/acknowledge')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationRoles('owner', 'admin')
  acknowledge(
    @Param() params: AlertParamsDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<OperationalAlertView> {
    return this.alerts.acknowledge(
      params.organizationId,
      params.tenantId,
      params.alertId,
      principal.subject,
    );
  }

  @Get('alert-settings')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  settings(@Param() params: TenantParamsDto): Promise<AlertSettingsView> {
    return this.alerts.getSettings(params.organizationId, params.tenantId);
  }

  @Put('alert-settings')
  @RequireOrganizationRoles('owner', 'admin')
  updateSettings(
    @Param() params: TenantParamsDto,
    @Body() dto: AlertSettingsDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<AlertSettingsView> {
    return this.alerts.updateSettings(
      params.organizationId,
      params.tenantId,
      dto,
      principal.subject,
    );
  }
}
