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
import { SetAiCredentialDto } from './ai-credential.dto.js';
import type { AiCredentialView } from './ai-credential.types.js';
import { AiCredentialsService } from './ai-credentials.service.js';

@ApiTags('ai credentials')
@ApiBearerAuth()
@Controller('organizations/:organizationId/ai-credentials/anthropic')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
export class AiCredentialsController {
  constructor(private readonly credentials: AiCredentialsService) {}

  @Get()
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  get(@Param() params: OrganizationParamsDto): Promise<AiCredentialView> {
    return this.credentials.view(params.organizationId, 'anthropic');
  }

  @Put()
  @RequireOrganizationRoles('owner', 'admin')
  set(
    @Param() params: OrganizationParamsDto,
    @Body() dto: SetAiCredentialDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<AiCredentialView> {
    return this.credentials.set(
      params.organizationId,
      'anthropic',
      dto.apiKey,
      principal.subject,
    );
  }

  @Delete()
  @RequireOrganizationRoles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param() params: OrganizationParamsDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<void> {
    return this.credentials.remove(
      params.organizationId,
      'anthropic',
      principal.subject,
    );
  }
}
