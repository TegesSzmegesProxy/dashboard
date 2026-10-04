import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
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
import { TenantParamsDto } from '../projects/project.dto.js';
import {
  AnalysisParamsDto,
  AnalysisSettingsDto,
  ApproveBudgetDto,
} from './analysis.dto.js';
import type {
  AnalysisReadinessView,
  AnalysisSummaryView,
  AnalysisView,
  WorkItemView,
} from './analysis.types.js';
import { AnalysesService } from './analyses.service.js';

@ApiTags('analyses')
@ApiBearerAuth()
@Controller('organizations/:organizationId/projects/:tenantId')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
export class AnalysesController {
  constructor(private readonly analyses: AnalysesService) {}

  @Get('analyses')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  list(
    @Param() params: TenantParamsDto,
    @Query() pagination: CursorPaginationDto,
  ): Promise<CursorPage<AnalysisSummaryView>> {
    return this.analyses.list(
      params.organizationId,
      params.tenantId,
      pagination,
    );
  }

  @Get('analyses/:analysisId')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  get(@Param() params: AnalysisParamsDto): Promise<AnalysisView> {
    return this.analyses.get(
      params.organizationId,
      params.tenantId,
      params.analysisId,
    );
  }

  /** The coverage ledger: every candidate and how it was resolved. */
  @Get('analyses/:analysisId/work-items')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  workItems(
    @Param() params: AnalysisParamsDto,
    @Query() pagination: CursorPaginationDto,
  ): Promise<CursorPage<WorkItemView>> {
    return this.analyses.listWorkItems(
      params.organizationId,
      params.tenantId,
      params.analysisId,
      pagination,
    );
  }

  /** What this deployment provides for analyses (model, sandbox). */
  @Get('analysis-readiness')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  readiness(@Param() params: TenantParamsDto): Promise<AnalysisReadinessView> {
    return this.analyses.readiness(params.organizationId, params.tenantId);
  }

  /** Starts an analysis of the bound repository's head, without a collector. */
  @Post('analyses')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireOrganizationRoles('owner', 'admin')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  start(
    @Param() params: TenantParamsDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<AnalysisSummaryView> {
    return this.analyses.startFromRepository(
      params.organizationId,
      params.tenantId,
      idempotencyKey,
      principal.subject,
    );
  }

  /** Approves the spending ceiling after reviewing the estimate (ADR-0015). */
  @Post('analyses/:analysisId/budget-approval')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireOrganizationRoles('owner', 'admin')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  approveBudget(
    @Param() params: AnalysisParamsDto,
    @Body() dto: ApproveBudgetDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<AnalysisSummaryView> {
    return this.analyses.approveBudget(
      params.organizationId,
      params.tenantId,
      params.analysisId,
      dto.ceilingUsd,
      dto.policyReviewMode ?? 'review',
      idempotencyKey,
      principal.subject,
    );
  }

  /** Resumes an analysis paused because the provider account ran out of credit. */
  @Post('analyses/:analysisId/resume')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireOrganizationRoles('owner', 'admin')
  resume(
    @Param() params: AnalysisParamsDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<AnalysisSummaryView> {
    return this.analyses.resume(
      params.organizationId,
      params.tenantId,
      params.analysisId,
      principal.subject,
    );
  }

  @Get('analysis-settings')
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  settings(@Param() params: TenantParamsDto) {
    return this.analyses.getSettings(params.organizationId, params.tenantId);
  }

  @Put('analysis-settings')
  @RequireOrganizationRoles('owner', 'admin')
  setSettings(
    @Param() params: TenantParamsDto,
    @Body() dto: AnalysisSettingsDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ) {
    return this.analyses.setSettings(
      params.organizationId,
      params.tenantId,
      dto.autoApproveCeilingUsd,
      dto.defaultPolicyReviewMode,
      principal.subject,
    );
  }
}
