import { ObjectId } from 'mongodb';
import { OrganizationRole } from './organization-role.js';

export interface OrganizationDocument {
  _id: ObjectId;
  name: string;
  status: 'active';
  createdAt: Date;
  updatedAt: Date;
}

export interface MembershipDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  subject: string;
  role: OrganizationRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationView {
  id: string;
  name: string;
  status: 'active';
  role: OrganizationRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface MembershipView {
  id: string;
  subject: string;
  role: OrganizationRole;
  createdAt: Date;
  updatedAt: Date;
}
