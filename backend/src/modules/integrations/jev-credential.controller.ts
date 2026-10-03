import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { PutJevCredentialDto } from './jev-credential.dto.js';
import type { JevCredentialView } from './jev-credential.types.js';
import { JevCredentialService } from './jev-credential.service.js';

@ApiTags('integrations')
@ApiBearerAuth()
@Controller('organizations/:organizationId/integrations/jev')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
export class JevCredentialController {
  constructor(private readonly credentials: JevCredentialService) {}

  @Get()
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  get(@Param() params: OrganizationParamsDto): Promise<JevCredentialView> {
    return this.credentials.get(params.organizationId);
  }

  @Put()
  @RequireOrganizationRoles('owner', 'admin')
  set(
    @Param() params: OrganizationParamsDto,
    @Body() dto: PutJevCredentialDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<JevCredentialView> {
    return this.credentials.set(params.organizationId, dto, principal.subject);
  }

  @Delete()
  @RequireOrganizationRoles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param() params: OrganizationParamsDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<void> {
    return this.credentials.remove(params.organizationId, principal.subject);
  }
}
