import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CursorPage,
  CursorPaginationDto,
} from '../../common/cursor-pagination.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { DashboardAuthGuard } from '../auth/dashboard-auth.guard.js';
import type { DashboardPrincipal } from '../auth/dashboard-principal.js';
import { OrganizationParamsDto } from '../organizations/organization.dto.js';
import { OrganizationRoleGuard } from '../organizations/organization-role.guard.js';
import { RequireOrganizationRoles } from '../organizations/organization-roles.decorator.js';
import {
  CreateTenantDto,
  TenantParamsDto,
  UpdateTenantDto,
} from './project.dto.js';
import { TenantView } from './project.types.js';
import { ProjectsService } from './projects.service.js';

@ApiTags('projects')
@ApiBearerAuth()
@Controller('organizations/:organizationId/projects')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @RequireOrganizationRoles('owner', 'admin')
  create(
    @Param() params: OrganizationParamsDto,
    @Body() dto: CreateTenantDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<TenantView> {
    return this.projects.create(params.organizationId, dto, principal.subject);
  }

  @Get()
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  list(
    @Param() params: OrganizationParamsDto,
    @Query() pagination: CursorPaginationDto,
  ): Promise<CursorPage<TenantView>> {
    return this.projects.list(params.organizationId, pagination);
  }

  @Get(':tenantId')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  get(@Param() params: TenantParamsDto): Promise<TenantView> {
    return this.projects.get(params.organizationId, params.tenantId);
  }

  @Patch(':tenantId')
  @RequireOrganizationRoles('owner', 'admin')
  update(
    @Param() params: TenantParamsDto,
    @Body() dto: UpdateTenantDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<TenantView> {
    return this.projects.update(
      params.organizationId,
      params.tenantId,
      dto,
      principal.subject,
    );
  }

  @Delete(':tenantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireOrganizationRoles('owner', 'admin')
  remove(
    @Param() params: TenantParamsDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<void> {
    return this.projects.remove(
      params.organizationId,
      params.tenantId,
      principal.subject,
    );
  }
}
