import { Injectable, OnModuleInit } from '@nestjs/common';
import { ClientSession, ObjectId } from 'mongodb';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';

export interface AuditRecord {
  organizationId: ObjectId;
  tenantId?: ObjectId;
  /**
   * Dashboard subject, `machine:<apiKeyId>` for machine credentials, or
   * `system:<workflow>` for automatic control-plane workflows.
   */
  actorSubject: string;
  action: string;
  targetType:
    | 'organization'
    | 'membership'
    | 'tenant'
    | 'apiKey'
    | 'policyVersion'
    | 'policySelection'
    | 'bundle'
    | 'githubInstallation'
    | 'tenantRepository'
    | 'analysisUpload'
    | 'analysis'
    | 'policyGeneration'
    | 'operationalAlert'
    | 'alertSettings'
    | 'integrationCredential';
  targetId: string;
  metadata?: Record<string, string>;
}

interface AuditDocument extends AuditRecord {
  createdAt: Date;
}

@Injectable()
export class AuditService implements OnModuleInit {
  constructor(private readonly mongo: MongoDatabase) {}

  async onModuleInit(): Promise<void> {
    await this.mongo.db
      .collection<AuditDocument>('auditEntries')
      .createIndex({ organizationId: 1, createdAt: -1 });
  }

  async append(record: AuditRecord, session: ClientSession): Promise<void> {
    await this.mongo.db.collection<AuditDocument>('auditEntries').insertOne(
      {
        ...record,
        createdAt: new Date(),
      },
      { session },
    );
  }
}
