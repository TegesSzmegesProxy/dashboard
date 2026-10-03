import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  CursorPage,
  CursorPaginationDto,
} from '../../common/cursor-pagination.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { DashboardAuthGuard } from '../auth/dashboard-auth.guard.js';
import type { DashboardPrincipal } from '../auth/dashboard-principal.js';
import { OrganizationRoleGuard } from '../organizations/organization-role.guard.js';
import { RequireOrganizationRoles } from '../organizations/organization-roles.decorator.js';
import { PolicyVersionParamsDto } from '../policies/policy.dto.js';
import { TenantParamsDto } from '../projects/project.dto.js';
import {
  EditPolicyDto,
  GeneratePolicyDto,
  PolicyGenerationParamsDto,
} from './policy-generation.dto.js';
import type { PolicyGenerationView } from './policy-generation.types.js';
import { PolicyGenerationService } from './policy-generation.service.js';

@ApiTags('policy generation')
@ApiBearerAuth()
@Controller('organizations/:organizationId/projects/:tenantId')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
export class PolicyGenerationController {
  constructor(private readonly generations: PolicyGenerationService) {}

  @Post('policy-generations')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireOrganizationRoles('owner', 'admin')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  generate(
    @Param() params: TenantParamsDto,
    @Body() dto: GeneratePolicyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<PolicyGenerationView> {
    return this.generations.requestGeneration(
      params.organizationId,
      params.tenantId,
      dto.analysisId,
      idempotencyKey,
      principal.subject,
    );
  }

  @Post('policies/:version/edits')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireOrganizationRoles('owner', 'admin')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  edit(
    @Param() params: PolicyVersionParamsDto,
    @Body() dto: EditPolicyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<PolicyGenerationView> {
    return this.generations.requestEdit(
      params.organizationId,
      params.tenantId,
      params.version,
      dto.instruction,
      idempotencyKey,
      principal.subject,
    );
  }

  @Get('policy-generations')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  list(
    @Param() params: TenantParamsDto,
    @Query() pagination: CursorPaginationDto,
  ): Promise<CursorPage<PolicyGenerationView>> {
    return this.generations.list(
      params.organizationId,
      params.tenantId,
      pagination,
    );
  }

  @Get('policy-generations/:attemptId')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  get(
    @Param() params: PolicyGenerationParamsDto,
  ): Promise<PolicyGenerationView> {
    return this.generations.get(
      params.organizationId,
      params.tenantId,
      params.attemptId,
    );
  }
}
