import {
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
import { PolicyVersionParamsDto } from '../policies/policy.dto.js';
import type { PolicyVersionView } from '../policies/policy.types.js';
import { PolicyLifecycleService } from './policy-lifecycle.service.js';

@ApiTags('policy lifecycle')
@ApiBearerAuth()
@Controller('organizations/:organizationId/projects/:tenantId/policies')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
@RequireOrganizationRoles('owner', 'admin')
export class PolicyLifecycleController {
  constructor(private readonly lifecycle: PolicyLifecycleService) {}

  @Post(':version/activate')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  activate(
    @Param() params: PolicyVersionParamsDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<PolicyVersionView> {
    return this.lifecycle.activate(
      params.organizationId,
      params.tenantId,
      params.version,
      idempotencyKey,
      principal.subject,
    );
  }
}
