import { SetMetadata } from '@nestjs/common';
import { OrganizationRole } from './organization-role.js';

export const ORGANIZATION_ROLES_KEY = 'organizationRoles';

export const RequireOrganizationRoles = (...roles: OrganizationRole[]) =>
  SetMetadata(ORGANIZATION_ROLES_KEY, roles);
