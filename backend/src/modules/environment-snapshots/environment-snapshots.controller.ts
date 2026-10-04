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
import { EnvironmentSnapshotV1Dto } from '../../contracts/environment/v1/environment.contract.js';
import type { MachinePrincipal } from '../api-keys/api-key.types.js';
import { CurrentMachinePrincipal } from '../api-keys/current-machine-principal.decorator.js';
import { CollectorKeyGuard } from '../api-keys/machine-key.guard.js';
import { RequireMachineScopes } from '../api-keys/machine-scopes.decorator.js';
import { DashboardAuthGuard } from '../auth/dashboard-auth.guard.js';
import { OrganizationRoleGuard } from '../organizations/organization-role.guard.js';
import { RequireOrganizationRoles } from '../organizations/organization-roles.decorator.js';
import { TenantParamsDto } from '../projects/project.dto.js';
import type {
  EnvironmentSnapshotReceipt,
  EnvironmentSnapshotView,
  ProjectEnvironmentStatus,
} from './environment-snapshot.types.js';
import { EnvironmentSnapshotsService } from './environment-snapshots.service.js';

class CollectorTenantParamsDto {
  @IsMongoId()
  tenantId!: string;
}

class SnapshotParamsDto extends TenantParamsDto {
  @IsMongoId()
  snapshotId!: string;
}

/** Target of `tessera -get-environment` (ADR-0012). */
@ApiTags('collector')
@ApiBearerAuth()
@Controller('tenants/:tenantId/environment-snapshots')
@UseGuards(CollectorKeyGuard)
@RequireMachineScopes('environment-snapshots:write')
export class CollectorEnvironmentSnapshotsController {
  constructor(private readonly snapshots: EnvironmentSnapshotsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  receive(
    @Param() params: CollectorTenantParamsDto,
    @Body() dto: EnvironmentSnapshotV1Dto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentMachinePrincipal() principal: MachinePrincipal,
  ): Promise<EnvironmentSnapshotReceipt> {
    return this.snapshots.receive(
      principal,
      params.tenantId,
      dto,
      idempotencyKey,
    );
  }
}

@ApiTags('environment')
@ApiBearerAuth()
@Controller('organizations/:organizationId/projects/:tenantId')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
@RequireOrganizationRoles('owner', 'admin', 'viewer')
export class EnvironmentSnapshotsController {
  constructor(private readonly snapshots: EnvironmentSnapshotsService) {}

  /** Latest snapshot summary, or the `tessera -get-environment` notice. */
  @Get('environment')
  status(@Param() params: TenantParamsDto): Promise<ProjectEnvironmentStatus> {
    return this.snapshots.status(params.organizationId, params.tenantId);
  }

  @Get('environment-snapshots/:snapshotId')
  get(@Param() params: SnapshotParamsDto): Promise<EnvironmentSnapshotView> {
    return this.snapshots.get(
      params.organizationId,
      params.tenantId,
      params.snapshotId,
    );
  }
}
