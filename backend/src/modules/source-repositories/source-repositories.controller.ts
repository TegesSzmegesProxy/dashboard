import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { DashboardAuthGuard } from '../auth/dashboard-auth.guard.js';
import type { DashboardPrincipal } from '../auth/dashboard-principal.js';
import { OrganizationParamsDto } from '../organizations/organization.dto.js';
import { OrganizationRoleGuard } from '../organizations/organization-role.guard.js';
import { RequireOrganizationRoles } from '../organizations/organization-roles.decorator.js';
import { TenantParamsDto } from '../projects/project.dto.js';
import {
  BindRepositoryDto,
  InstallationParamsDto,
  LinkGitHubInstallationDto,
} from './source-repository.dto.js';
import type {
  GitHubInstallationView,
  TenantRepositoryView,
} from './source-repository.types.js';
import { SourceRepositoriesService } from './source-repositories.service.js';

@ApiTags('source repositories')
@ApiBearerAuth()
@Controller('organizations/:organizationId')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
export class SourceRepositoriesController {
  constructor(private readonly repositories: SourceRepositoriesService) {}

  @Post('github-installations')
  @RequireOrganizationRoles('owner', 'admin')
  linkInstallation(
    @Param() params: OrganizationParamsDto,
    @Body() dto: LinkGitHubInstallationDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<GitHubInstallationView> {
    return this.repositories.linkInstallation(
      params.organizationId,
      dto,
      principal.subject,
    );
  }

  @Get('github-installations')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  listInstallations(
    @Param() params: OrganizationParamsDto,
  ): Promise<GitHubInstallationView[]> {
    return this.repositories.listInstallations(params.organizationId);
  }

  @Delete('github-installations/:installationId')
  @RequireOrganizationRoles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  unlinkInstallation(
    @Param() params: InstallationParamsDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<void> {
    return this.repositories.unlinkInstallation(
      params.organizationId,
      params.installationId,
      principal.subject,
    );
  }

  @Put('projects/:tenantId/repository')
  @RequireOrganizationRoles('owner', 'admin')
  bindRepository(
    @Param() params: TenantParamsDto,
    @Body() dto: BindRepositoryDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<TenantRepositoryView> {
    return this.repositories.bindRepository(
      params.organizationId,
      params.tenantId,
      dto,
      principal.subject,
    );
  }

  @Get('projects/:tenantId/repository')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  getRepository(
    @Param() params: TenantParamsDto,
  ): Promise<TenantRepositoryView> {
    return this.repositories.getRepository(
      params.organizationId,
      params.tenantId,
    );
  }

  @Delete('projects/:tenantId/repository')
  @RequireOrganizationRoles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  unbindRepository(
    @Param() params: TenantParamsDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<void> {
    return this.repositories.unbindRepository(
      params.organizationId,
      params.tenantId,
      principal.subject,
    );
  }
}
