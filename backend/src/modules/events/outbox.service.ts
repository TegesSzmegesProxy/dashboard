import { Injectable, OnModuleInit } from '@nestjs/common';
import { ClientSession, ObjectId } from 'mongodb';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';

export type PolicyEventType =
  | 'PolicyImported'
  | 'PolicyCompiled'
  | 'PolicyCompilationFailed'
  | 'PolicyApproved'
  | 'PolicyRejected'
  | 'PolicyActivated';

interface OutboxEventDocument {
  _id: ObjectId;
  eventId: string;
  eventType: PolicyEventType;
  version: 1;
  organizationId: ObjectId;
  tenantId: ObjectId;
  aggregateId: string;
  occurredAt: Date;
  payload: Record<string, string>;
  publishedAt?: Date;
}

@Injectable()
export class OutboxService implements OnModuleInit {
  constructor(private readonly mongo: MongoDatabase) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ eventId: 1 }, { unique: true }),
      this.collection.createIndex({ publishedAt: 1, occurredAt: 1 }),
    ]);
  }

  async appendPolicyEvent(
    eventType: PolicyEventType,
    organizationId: ObjectId,
    tenantId: ObjectId,
    aggregateId: string,
    payload: Record<string, string>,
    session: ClientSession,
  ): Promise<void> {
    const id = new ObjectId();
    await this.collection.insertOne(
      {
        _id: id,
        eventId: id.toHexString(),
        eventType,
        version: 1,
        organizationId,
        tenantId,
        aggregateId,
        occurredAt: new Date(),
        payload,
      },
      { session },
    );
  }

  private get collection() {
    return this.mongo.db.collection<OutboxEventDocument>('outboxEvents');
  }
}
