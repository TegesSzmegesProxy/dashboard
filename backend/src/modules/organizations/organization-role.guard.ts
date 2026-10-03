import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ORGANIZATION_ROLES_KEY } from './organization-roles.decorator.js';
import { OrganizationRole } from './organization-role.js';
import { MembershipsService } from './memberships.service.js';

@Injectable()
export class OrganizationRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly memberships: MembershipsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<OrganizationRole[]>(
      ORGANIZATION_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const request = context.switchToHttp().getRequest<Request>();
    const rawOrganizationId = request.params.organizationId;
    const organizationId = Array.isArray(rawOrganizationId)
      ? rawOrganizationId[0]
      : rawOrganizationId;
    const subject = request.dashboardPrincipal?.subject;
    if (!organizationId || !subject) {
      throw new ForbiddenException('Organization access denied');
    }

    const membership = await this.memberships.find(organizationId, subject);
    if (!membership || (roles?.length && !roles.includes(membership.role))) {
      throw new ForbiddenException('Organization access denied');
    }
    return true;
  }
}
