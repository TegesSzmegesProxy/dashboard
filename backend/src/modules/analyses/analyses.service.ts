import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ClientSession, ObjectId } from 'mongodb';
import {
  afterCursor,
  CursorPage,
  CursorPaginationDto,
} from '../../common/cursor-pagination.js';
import { objectId } from '../../common/mongodb.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import type { StoredObject } from '../../infrastructure/object-storage/object-storage.js';
import { OutboxService } from '../events/outbox.service.js';
import {
  AnalysisDocument,
  AnalysisResults,
  AnalysisStatus,
  AnalysisSummaryView,
  AnalysisView,
} from './analysis.types.js';

export interface EnqueueAnalysisInput {
  organizationId: ObjectId;
  tenantId: ObjectId;
  uploadId: ObjectId;
  commitSha: string;
  environmentObject: StoredObject;
}

/** The derived analysis parts policy generation may use. Never source. */
export interface AnalysisPolicyContext {
  analysisId: ObjectId;
  version: string;
  results: Pick<AnalysisResults, 'apiSurface' | 'configuration' | 'findings'>;
}

@Injectable()
export class AnalysesService implements OnModuleInit {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly outbox: OutboxService,
  ) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ uploadId: 1 }, { unique: true }),
      this.collection.createIndex({ organizationId: 1, tenantId: 1, _id: 1 }),
      this.collection.createIndex({ status: 1, availableAt: 1 }),
    ]);
  }

  /** Creates the durable job inside the upload transaction. */
  async enqueue(
    input: EnqueueAnalysisInput,
    session: ClientSession,
  ): Promise<ObjectId> {
    const now = new Date();
    const document: AnalysisDocument = {
      _id: new ObjectId(),
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      uploadId: input.uploadId,
      commitSha: input.commitSha,
      status: 'queued',
      attempts: 0,
      availableAt: now,
      environmentObject: input.environmentObject,
      pendingObjectKeys: [],
      repository: null,
      manifest: null,
      steps: [],
      results: null,
      version: null,
      provenance: { aiProvider: null, aiModel: null },
      errorCode: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      rawDeletedAt: null,
    };
    await this.collection.insertOne(document, { session });
    await this.outbox.append(
      'AnalysisRequested',
      input.organizationId,
      input.tenantId,
      document._id.toHexString(),
      {
        analysisId: document._id.toHexString(),
        uploadId: input.uploadId.toHexString(),
        commitSha: input.commitSha,
      },
      session,
    );
    return document._id;
  }

  async statusOf(analysisId: ObjectId): Promise<AnalysisStatus> {
    const document = await this.collection.findOne(
      { _id: analysisId },
      { projection: { status: 1 } },
    );
    if (!document) throw new NotFoundException('Analysis not found');
    return document.status;
  }

  /** A finished analysis in the tenant, or null when none is usable. */
  async findPolicyContext(
    organizationId: ObjectId,
    tenantId: ObjectId,
    analysisId: ObjectId,
    session?: ClientSession,
  ): Promise<AnalysisPolicyContext | null> {
    const document = await this.collection.findOne(
      {
        _id: analysisId,
        organizationId,
        tenantId,
        status: { $in: ['completed', 'partial'] },
      },
      {
        session,
        projection: {
          version: 1,
          'results.apiSurface': 1,
          'results.configuration': 1,
          'results.findings': 1,
        },
      },
    );
    if (!document?.results || !document.version) return null;
    return {
      analysisId: document._id,
      version: document.version,
      results: {
        apiSurface: document.results.apiSurface,
        configuration: document.results.configuration,
        findings: document.results.findings,
      },
    };
  }

  async list(
    organizationId: string,
    tenantId: string,
    pagination: CursorPaginationDto,
  ): Promise<CursorPage<AnalysisSummaryView>> {
    const filter: {
      organizationId: ObjectId;
      tenantId: ObjectId;
      _id?: { $gt: ObjectId };
    } = {
      organizationId: objectId(organizationId),
      tenantId: objectId(tenantId),
    };
    const cursor = afterCursor(pagination.cursor);
    if (cursor) filter._id = cursor;
    const documents = await this.collection
      .find(filter, { projection: { manifest: 0, results: 0 } })
      .sort({ _id: 1 })
      .limit(pagination.limit + 1)
      .toArray();
    const hasNextPage = documents.length > pagination.limit;
    const pageDocuments = documents.slice(0, pagination.limit);
    return {
      items: pageDocuments.map((document) => this.toSummary(document)),
      nextCursor: hasNextPage ? pageDocuments.at(-1)!._id.toHexString() : null,
    };
  }

  async get(
    organizationId: string,
    tenantId: string,
    analysisId: string,
  ): Promise<AnalysisView> {
    const document = await this.collection.findOne({
      _id: objectId(analysisId),
      organizationId: objectId(organizationId),
      tenantId: objectId(tenantId),
    });
    if (!document) throw new NotFoundException('Analysis not found');
    return {
      ...this.toSummary(document),
      manifest: document.manifest,
      results: document.results,
      provenance: document.provenance,
    };
  }

  private toSummary(document: AnalysisDocument): AnalysisSummaryView {
    return {
      id: document._id.toHexString(),
      organizationId: document.organizationId.toHexString(),
      tenantId: document.tenantId.toHexString(),
      uploadId: document.uploadId.toHexString(),
      commitSha: document.commitSha,
      status: document.status,
      version: document.version,
      repository: document.repository,
      steps: document.steps,
      errorCode: document.errorCode,
      createdAt: document.createdAt,
      startedAt: document.startedAt,
      finishedAt: document.finishedAt,
      rawDeletedAt: document.rawDeletedAt,
    };
  }

  private get collection() {
    return this.mongo.db.collection<AnalysisDocument>('analyses');
  }
}
