import { ObjectId } from 'mongodb';

export interface GitHubInstallationDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  installationId: number;
  accountLogin: string;
  linkedBy: string;
  linkedAt: Date;
}

export interface TenantRepositoryDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  provider: 'github';
  installationId: number;
  repositoryId: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  boundBy: string;
  boundAt: Date;
}

export interface GitHubInstallationView {
  installationId: number;
  accountLogin: string;
  linkedBy: string;
  linkedAt: Date;
}

export interface TenantRepositoryView {
  tenantId: string;
  provider: 'github';
  installationId: number;
  repositoryId: number;
  fullName: string;
  private: boolean;
  boundBy: string;
  boundAt: Date;
}

/** What the analysis worker needs to fetch source; never sent to clients. */
export interface RepositorySource {
  installationId: number;
  repositoryId: number;
  fullName: string;
}
