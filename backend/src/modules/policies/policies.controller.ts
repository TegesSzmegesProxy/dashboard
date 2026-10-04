import {
  Body,
  Controller,
  Get,
  Param,
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
import { OrganizationRoleGuard } from '../organizations/organization-role.guard.js';
import { RequireOrganizationRoles } from '../organizations/organization-roles.decorator.js';
import { TenantParamsDto } from '../projects/project.dto.js';
import {
  ImportPolicyDto,
  PolicyVersionParamsDto,
  SavePolicyDraftDto,
  SavePolicyDraftV3Dto,
} from './policy.dto.js';
import type { PolicyVersionView } from './policy.types.js';
import { PoliciesService } from './policies.service.js';

@ApiTags('policies')
@ApiBearerAuth()
@Controller('organizations/:organizationId/projects/:tenantId/policies')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Post('import')
  @RequireOrganizationRoles('owner', 'admin')
  import(
    @Param() params: TenantParamsDto,
    @Body() dto: ImportPolicyDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<PolicyVersionView> {
    return this.policies.import(
      params.organizationId,
      params.tenantId,
      dto,
      principal.subject,
    );
  }

  /** Saves a policy editor draft as a new pending `tessera.policy/v2` version. */
  @Post('v2')
  @RequireOrganizationRoles('owner', 'admin')
  saveDraft(
    @Param() params: TenantParamsDto,
    @Body() dto: SavePolicyDraftDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<PolicyVersionView> {
    return this.policies.saveDraft(
      params.organizationId,
      params.tenantId,
      dto,
      principal.subject,
    );
  }

  /** Saves a policy editor draft as a new pending `tessera.policy/v3` version. */
  @Post('v3')
  @RequireOrganizationRoles('owner', 'admin')
  saveDraftV3(
    @Param() params: TenantParamsDto,
    @Body() dto: SavePolicyDraftV3Dto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<PolicyVersionView> {
    return this.policies.saveDraftV3(
      params.organizationId,
      params.tenantId,
      dto,
      principal.subject,
    );
  }

  /** Drafts a pending `tessera.policy/v3` version from a v2 one so it can be activated. */
  @Post(':version/upgrade-v3')
  @RequireOrganizationRoles('owner', 'admin')
  upgradeToV3(
    @Param() params: PolicyVersionParamsDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<PolicyVersionView> {
    return this.policies.upgradeToV3(
      params.organizationId,
      params.tenantId,
      params.version,
      principal.subject,
    );
  }

  @Get()
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  list(
    @Param() params: TenantParamsDto,
    @Query() pagination: CursorPaginationDto,
  ): Promise<CursorPage<PolicyVersionView>> {
    return this.policies.list(
      params.organizationId,
      params.tenantId,
      pagination,
    );
  }

  @Get(':version')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  get(@Param() params: PolicyVersionParamsDto): Promise<PolicyVersionView> {
    return this.policies.get(
      params.organizationId,
      params.tenantId,
      params.version,
    );
  }
}
