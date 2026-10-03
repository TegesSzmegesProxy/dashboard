import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { DashboardAuthGuard } from '../auth/dashboard-auth.guard.js';
import type { DashboardPrincipal } from '../auth/dashboard-principal.js';
import { OrganizationRoleGuard } from '../organizations/organization-role.guard.js';
import { RequireOrganizationRoles } from '../organizations/organization-roles.decorator.js';
import {
  PolicyVersionParamsDto,
  RejectPolicyDto,
} from '../policies/policy.dto.js';
import type { PolicyVersionView } from '../policies/policy.types.js';
import { ApprovalsService } from './approvals.service.js';

@ApiTags('policy approvals')
@ApiBearerAuth()
@Controller('organizations/:organizationId/projects/:tenantId/policies')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
@RequireOrganizationRoles('owner', 'admin')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Post(':version/approve')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  approve(
    @Param() params: PolicyVersionParamsDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<PolicyVersionView> {
    return this.approvals.approve(
      params.organizationId,
      params.tenantId,
      params.version,
      idempotencyKey,
      principal.subject,
    );
  }

  @Post(':version/reject')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  reject(
    @Param() params: PolicyVersionParamsDto,
    @Body() dto: RejectPolicyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<PolicyVersionView> {
    return this.approvals.reject(
      params.organizationId,
      params.tenantId,
      params.version,
      dto.reason,
      idempotencyKey,
      principal.subject,
    );
  }
}
