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
import { OrganizationParamsDto } from '../organizations/organization.dto.js';
import { OrganizationRoleGuard } from '../organizations/organization-role.guard.js';
import { RequireOrganizationRoles } from '../organizations/organization-roles.decorator.js';
import { ApiKeyParamsDto, CreateApiKeyDto } from './api-key.dto.js';
import type { ApiKeyView, RevealedApiKey } from './api-key.types.js';
import { ApiKeysService } from './api-keys.service.js';

@ApiTags('API keys')
@ApiBearerAuth()
@Controller('organizations/:organizationId/api-keys')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
@RequireOrganizationRoles('owner', 'admin')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Post()
  create(
    @Param() params: OrganizationParamsDto,
    @Body() dto: CreateApiKeyDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<RevealedApiKey> {
    return this.apiKeys.create(params.organizationId, dto, principal.subject);
  }

  @Get()
  list(
    @Param() params: OrganizationParamsDto,
    @Query() pagination: CursorPaginationDto,
  ): Promise<CursorPage<ApiKeyView>> {
    return this.apiKeys.list(params.organizationId, pagination);
  }

  @Post(':apiKeyId/rotate')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  rotate(
    @Param() params: ApiKeyParamsDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<RevealedApiKey> {
    return this.apiKeys.rotate(
      params.organizationId,
      params.apiKeyId,
      idempotencyKey,
      principal.subject,
    );
  }

  @Post(':apiKeyId/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @Param() params: ApiKeyParamsDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<ApiKeyView> {
    return this.apiKeys.revoke(
      params.organizationId,
      params.apiKeyId,
      principal.subject,
    );
  }
}
