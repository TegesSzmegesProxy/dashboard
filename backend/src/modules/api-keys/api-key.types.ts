import { ObjectId } from 'mongodb';
import { ApiKeyScope, ApiKeyType } from './api-key.constants.js';

export interface ApiKeyDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  name: string;
  type: ApiKeyType;
  scopes: ApiKeyScope[];
  allowedTenantIds: ObjectId[];
  secretHash: string;
  displayPrefix: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
}

export interface ApiKeyView {
  id: string;
  organizationId: string;
  name: string;
  type: ApiKeyType;
  scopes: ApiKeyScope[];
  allowedTenantIds: string[];
  displayPrefix: string;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface RevealedApiKey {
  apiKey: ApiKeyView;
  plaintext: string;
}

export interface MachinePrincipal {
  apiKeyId: string;
  organizationId: string;
  type: ApiKeyType;
  scopes: ApiKeyScope[];
  allowedTenantIds: string[];
}
