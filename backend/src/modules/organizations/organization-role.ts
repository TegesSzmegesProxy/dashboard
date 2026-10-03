export const ORGANIZATION_ROLES = ['owner', 'admin', 'viewer'] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];
