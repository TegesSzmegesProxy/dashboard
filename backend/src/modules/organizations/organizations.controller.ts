import {
  Body,
  Controller,
  Get,
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
import {
  CreateOrganizationDto,
  OrganizationParamsDto,
  UpdateOrganizationDto,
} from './organization.dto.js';
import { OrganizationRoleGuard } from './organization-role.guard.js';
import { RequireOrganizationRoles } from './organization-roles.decorator.js';
import { OrganizationView } from './organization.types.js';
import { OrganizationsService } from './organizations.service.js';

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post()
  @UseGuards(DashboardAuthGuard)
  create(
    @Body() dto: CreateOrganizationDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<OrganizationView> {
    return this.organizations.create(dto, principal.subject);
  }

  @Get()
  @UseGuards(DashboardAuthGuard)
  list(
    @CurrentPrincipal() principal: DashboardPrincipal,
    @Query() pagination: CursorPaginationDto,
  ): Promise<CursorPage<OrganizationView>> {
    return this.organizations.list(principal.subject, pagination);
  }

  @Get(':organizationId')
  @UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  get(
    @Param() params: OrganizationParamsDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<OrganizationView> {
    return this.organizations.get(params.organizationId, principal.subject);
  }

  @Patch(':organizationId')
  @UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
  @RequireOrganizationRoles('owner', 'admin')
  update(
    @Param() params: OrganizationParamsDto,
    @Body() dto: UpdateOrganizationDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<OrganizationView> {
    return this.organizations.update(
      params.organizationId,
      dto,
      principal.subject,
    );
  }
}
