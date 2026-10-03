import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CursorPage,
  CursorPaginationDto,
} from '../../common/cursor-pagination.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { DashboardAuthGuard } from '../auth/dashboard-auth.guard.js';
import type { DashboardPrincipal } from '../auth/dashboard-principal.js';
import { MembershipsService } from './memberships.service.js';
import {
  CreateMembershipDto,
  MembershipParamsDto,
  OrganizationParamsDto,
  UpdateMembershipDto,
} from './organization.dto.js';
import { OrganizationRoleGuard } from './organization-role.guard.js';
import { RequireOrganizationRoles } from './organization-roles.decorator.js';
import { MembershipView } from './organization.types.js';

@ApiTags('organization memberships')
@ApiBearerAuth()
@Controller('organizations/:organizationId/memberships')
@UseGuards(DashboardAuthGuard, OrganizationRoleGuard)
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  @RequireOrganizationRoles('owner', 'admin', 'viewer')
  list(
    @Param() params: OrganizationParamsDto,
    @Query() pagination: CursorPaginationDto,
  ): Promise<CursorPage<MembershipView>> {
    return this.memberships.list(params.organizationId, pagination);
  }

  @Post()
  @RequireOrganizationRoles('owner', 'admin')
  create(
    @Param() params: OrganizationParamsDto,
    @Body() dto: CreateMembershipDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<MembershipView> {
    return this.memberships.create(
      params.organizationId,
      dto,
      principal.subject,
    );
  }

  @Patch(':membershipId')
  @RequireOrganizationRoles('owner', 'admin')
  update(
    @Param() params: MembershipParamsDto,
    @Body() dto: UpdateMembershipDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<MembershipView> {
    return this.memberships.update(
      params.organizationId,
      params.membershipId,
      dto,
      principal.subject,
    );
  }

  @Delete(':membershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireOrganizationRoles('owner', 'admin')
  remove(
    @Param() params: MembershipParamsDto,
    @CurrentPrincipal() principal: DashboardPrincipal,
  ): Promise<void> {
    return this.memberships.remove(
      params.organizationId,
      params.membershipId,
      principal.subject,
    );
  }
}
