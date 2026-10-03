import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { AnalysisUploadV1Dto } from '../../contracts/analysis-upload/v1/analysis-upload.contract.js';
import type { MachinePrincipal } from '../api-keys/api-key.types.js';
import { CurrentMachinePrincipal } from '../api-keys/current-machine-principal.decorator.js';
import { CollectorKeyGuard } from '../api-keys/machine-key.guard.js';
import { RequireMachineScopes } from '../api-keys/machine-scopes.decorator.js';
import { DashboardAuthGuard } from '../auth/dashboard-auth.guard.js';
import { OrganizationRoleGuard } from '../organizations/organization-role.guard.js';
import { RequireOrganizationRoles } from '../organizations/organization-roles.decorator.js';
import { TenantParamsDto } from '../projects/project.dto.js';
import type {
  AnalysisUploadReceipt,
  AnalysisUploadView,
} from './analysis-upload.types.js';
import { AnalysisUploadsService } from './analysis-uploads.service.js';

class CollectorTenantParamsDto {
  @IsMongoId()
  tenantId!: string;
}

class CollectorUploadParamsDto extends CollectorTenantParamsDto {
  @IsMongoId()
  uploadId!: string;
}

class DashboardUploadParamsDto extends TenantParamsDto {
  @IsMongoId()
  uploadId!: string;
}

@ApiTags('collector')
@ApiBearerAuth()
@Controller('tenants/:tenantId/analysis-uploads')
@UseGuards(CollectorKeyGuard)
@RequireMachineScopes('analysis-uploads:write')
export class CollectorUploadsController {
  constructor(private readonly uploads: AnalysisUploadsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  receive(
    @Param() params: CollectorTenantParamsDto,
    @Body() dto: AnalysisUploadV1Dto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentMachinePrincipal() principal: MachinePrincipal,
  ): Promise<AnalysisUploadReceipt> {
    return this.uploads.receive(
      principal,
      params.tenantId,
      dto,
      idempotencyKey,
    );
  }

  @Get(':uploadId')
  get(
    @Param() params: CollectorUploadParamsDto,
    @CurrentMachinePrincipal() principal: MachinePrincipal,
  ): Promise<AnalysisUploadView> {
    return this.uploads.getForCollector(
      principal,
      params.tenantId,
      params.uploadId,
    );
  }
}

@ApiTags('analyses')
@ApiBearerAuth()
@Controller('organizations/:organizationId/projects/:tenantId/analysis-uploads')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
@RequireOrganizationRoles('owner', 'admin', 'viewer')
export class AnalysisUploadsController {
  constructor(private readonly uploads: AnalysisUploadsService) {}

  @Get(':uploadId')
  get(@Param() params: DashboardUploadParamsDto): Promise<AnalysisUploadView> {
    return this.uploads.get(
      params.organizationId,
      params.tenantId,
      params.uploadId,
    );
  }
}
