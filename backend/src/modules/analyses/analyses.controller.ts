import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import {
  CursorPage,
  CursorPaginationDto,
} from '../../common/cursor-pagination.js';
import { DashboardAuthGuard } from '../auth/dashboard-auth.guard.js';
import { OrganizationRoleGuard } from '../organizations/organization-role.guard.js';
import { RequireOrganizationRoles } from '../organizations/organization-roles.decorator.js';
import { TenantParamsDto } from '../projects/project.dto.js';
import type { AnalysisSummaryView, AnalysisView } from './analysis.types.js';
import { AnalysesService } from './analyses.service.js';

class AnalysisParamsDto extends TenantParamsDto {
  @IsMongoId()
  analysisId!: string;
}

@ApiTags('analyses')
@ApiBearerAuth()
@Controller('organizations/:organizationId/projects/:tenantId/analyses')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
@RequireOrganizationRoles('owner', 'admin', 'viewer')
export class AnalysesController {
  constructor(private readonly analyses: AnalysesService) {}

  @Get()
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

  @Get(':analysisId')
  get(@Param() params: AnalysisParamsDto): Promise<AnalysisView> {
    return this.analyses.get(
      params.organizationId,
      params.tenantId,
      params.analysisId,
    );
  }
}
