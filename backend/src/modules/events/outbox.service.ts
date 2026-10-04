import { Injectable, OnModuleInit } from '@nestjs/common';
import { ClientSession, ObjectId } from 'mongodb';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';

export type OutboxEventType =
  | 'PolicyImported'
  | 'PolicyCompiled'
  | 'PolicyCompilationFailed'
  | 'PolicyApproved'
  | 'PolicyRejected'
  | 'PolicyActivated'
  | 'BundleActivated'
  | 'AnalysisRequested'
  | 'AnalysisAwaitingBudget'
  | 'AnalysisBudgetApproved'
  | 'AnalysisCompleted'
  | 'AnalysisFailed'
  | 'EnvironmentSnapshotReceived'
  | 'PolicyGenerationRequested'
  | 'PolicyGenerationSucceeded'
  | 'PolicyGenerationFailed'
  | 'PolicyGenerated'
  | 'OperationalAlertOpened'
  | 'OperationalAlertResolved';

interface OutboxEventDocument {
  _id: ObjectId;
  eventId: string;
  eventType: OutboxEventType;
  version: 1;
  organizationId: ObjectId;
  tenantId: ObjectId;
  aggregateId: string;
  occurredAt: Date;
  payload: Record<string, string>;
  publishedAt?: Date;
  /** In-process consumers that have handled this event (inbox receipts). */
  consumedBy?: string[];
}

export interface OutboxEvent {
  eventId: string;
  eventType: OutboxEventType;
  organizationId: ObjectId;
  tenantId: ObjectId;
  aggregateId: string;
  payload: Record<string, string>;
}

@Injectable()
export class OutboxService implements OnModuleInit {
  constructor(private readonly mongo: MongoDatabase) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ eventId: 1 }, { unique: true }),
      this.collection.createIndex({ publishedAt: 1, occurredAt: 1 }),
      this.collection.createIndex({ eventType: 1, consumedBy: 1, _id: 1 }),
    ]);
  }

  async append(
    eventType: OutboxEventType,
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

  /**
   * Oldest events of the given types that `consumer` has not handled yet.
   * Consumers must handle an event and call `markConsumed` in one
   * transaction, so every event is processed effectively once.
   */
  async findUnconsumed(
    consumer: string,
    eventTypes: OutboxEventType[],
    limit: number,
  ): Promise<OutboxEvent[]> {
    const documents = await this.collection
      .find({ eventType: { $in: eventTypes }, consumedBy: { $ne: consumer } })
      .sort({ _id: 1 })
      .limit(limit)
      .toArray();
    return documents.map((document) => ({
      eventId: document.eventId,
      eventType: document.eventType,
      organizationId: document.organizationId,
      tenantId: document.tenantId,
      aggregateId: document.aggregateId,
      payload: document.payload,
    }));
  }

  async markConsumed(
    eventId: string,
    consumer: string,
    session: ClientSession,
  ): Promise<void> {
    await this.collection.updateOne(
      { eventId },
      { $addToSet: { consumedBy: consumer } },
      { session },
    );
  }

  private get collection() {
    return this.mongo.db.collection<OutboxEventDocument>('outboxEvents');
  }
}
