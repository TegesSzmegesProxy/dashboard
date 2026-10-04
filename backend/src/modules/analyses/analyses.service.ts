import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AnyBulkWriteOperation, ClientSession, ObjectId } from 'mongodb';
import { canonicalJson, JsonValue } from '../../common/canonical-json.js';
import {
  afterCursor,
  CursorPage,
  CursorPaginationDto,
} from '../../common/cursor-pagination.js';
import { assertIdempotencyKey } from '../../common/idempotency-key.js';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import { Environment } from '../../config/environment.js';
import { ANALYSIS_SCHEMA_V2 } from '../../contracts/analysis/v2/analysis-agent.contract.js';
import { AnalysisAiService } from '../../infrastructure/ai/analysis-ai.service.js';
import { EMPTY_USAGE } from '../../infrastructure/ai/pricing.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { SourceRepositoriesService } from '../source-repositories/source-repositories.service.js';
import type {
  AnalysisDocument,
  AnalysisReadinessView,
  AnalysisSettingsDocument,
  AnalysisStatus,
  AnalysisSettingsView,
  AnalysisSummaryView,
  AnalysisView,
  PolicyReviewChoice,
  PolicyReviewMode,
  WorkItemDocument,
  WorkItemView,
} from './analysis.types.js';

export interface EnqueueAnalysisInput {
  organizationId: ObjectId;
  tenantId: ObjectId;
  /** Null when the dashboard starts the analysis; then `startedBy` is set. */
  uploadId: ObjectId | null;
  commitSha: string;
  startedBy?: string;
  startKeyHash?: string;
}

/** The worker lost its lease; another instance owns the job now. */
export class LeaseLostError extends Error {}

const MAX_CEILING_USD = 10_000;

/** Statuses of an analysis that has not reached a final result. */
const UNFINISHED_STATUSES: AnalysisStatus[] = [
  'queued',
  'running',
  'awaiting_budget',
  'paused',
];

@Injectable()
export class AnalysesService implements OnModuleInit {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly projects: ProjectsService,
    private readonly ai: AnalysisAiService,
    private readonly repositories: SourceRepositoriesService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.ensureUploadIndex(),
      this.analyses.createIndex(
        { organizationId: 1, tenantId: 1, startKeyHash: 1 },
        {
          unique: true,
          partialFilterExpression: { startKeyHash: { $type: 'string' } },
        },
      ),
      this.analyses.createIndex({ organizationId: 1, tenantId: 1, _id: 1 }),
      this.analyses.createIndex({ status: 1, availableAt: 1 }),
      this.workItems.createIndex({ analysisId: 1, key: 1 }, { unique: true }),
      this.workItems.createIndex({ analysisId: 1, status: 1, priority: 1 }),
      this.settings.createIndex(
        { organizationId: 1, tenantId: 1 },
        { unique: true },
      ),
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
      ...(input.startedBy ? { startedBy: input.startedBy } : {}),
      ...(input.startKeyHash ? { startKeyHash: input.startKeyHash } : {}),
      commitSha: input.commitSha,
      schemaVersion: ANALYSIS_SCHEMA_V2,
      status: 'queued',
      phase: 'estimate',
      attempts: 0,
      availableAt: now,
      repository: null,
      extraction: null,
      index: null,
      environment: null,
      estimate: null,
      budget: null,
      usage: { usd: 0, tokens: EMPTY_USAGE, byStep: {}, models: [] },
      dossier: null,
      routeRules: null,
      steps: [],
      readManifest: null,
      results: null,
      version: null,
      policyReview: null,
      policy: null,
      errorCode: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
    };
    await this.analyses.insertOne(document, { session });
    await this.outbox.append(
      'AnalysisRequested',
      input.organizationId,
      input.tenantId,
      document._id.toHexString(),
      {
        analysisId: document._id.toHexString(),
        ...(input.uploadId
          ? { uploadId: input.uploadId.toHexString() }
          : { startedBy: input.startedBy ?? '' }),
        commitSha: input.commitSha,
      },
      session,
    );
    return document._id;
  }

  async statusOf(analysisId: ObjectId): Promise<AnalysisStatus> {
    const document = await this.analyses.findOne(
      { _id: analysisId },
      { projection: { status: 1 } },
    );
    if (!document) throw new NotFoundException('Analysis not found');
    return document.status;
  }

  /* ---------- dashboard operations ---------- */

  /** What this deployment provides for analyses; no secret is included. */
  async readiness(
    organizationId: string,
    tenantId: string,
  ): Promise<AnalysisReadinessView> {
    const active = await this.analyses.findOne(
      {
        organizationId: objectId(organizationId),
        tenantId: objectId(tenantId),
        status: { $in: UNFINISHED_STATUSES },
      },
      { projection: { status: 1 } },
    );
    return {
      ai: this.ai.status,
      sandboxConfigured:
        this.config.get('ANALYSIS_SANDBOX', { infer: true }) !== undefined,
      activeAnalysis: active
        ? { id: active._id.toHexString(), status: active.status }
        : null,
    };
  }

  /**
   * Starts an analysis of the head of the bound repository's default branch,
   * without a collector upload. It runs like any other analysis: estimate,
   * budget approval, then the model phase, and it uses the latest environment
   * snapshot when one exists.
   */
  async startFromRepository(
    organizationId: string,
    tenantId: string,
    idempotencyKey: string | undefined,
    actorSubject: string,
  ): Promise<AnalysisSummaryView> {
    assertIdempotencyKey(idempotencyKey);
    const organizationObjectId = objectId(organizationId);
    const tenantObjectId = objectId(tenantId);
    const startKeyHash = this.sha256(`dashboard-start:${idempotencyKey}`);
    const prior = await this.analyses.findOne({
      organizationId: organizationObjectId,
      tenantId: tenantObjectId,
      startKeyHash,
    });
    if (prior) return this.toSummary(prior);

    await this.projects.assertBelongToOrganization(organizationId, [tenantId]);
    const readiness = await this.readiness(organizationId, tenantId);
    if (!readiness.ai.configured) {
      throw new ConflictException({
        message:
          'No AI model is configured for this control plane; set ANTHROPIC_API_KEY or ANALYSIS_AI_BASE_URL',
        errorCode: 'AI_NOT_CONFIGURED',
      });
    }
    if (!readiness.sandboxConfigured) {
      throw new ConflictException({
        message:
          'The analysis sandbox is not configured for this control plane; set ANALYSIS_SANDBOX',
        errorCode: 'SANDBOX_NOT_CONFIGURED',
      });
    }
    if (readiness.activeAnalysis) {
      throw new ConflictException({
        message: 'An analysis of this project is already in progress',
        errorCode: 'ANALYSIS_IN_PROGRESS',
        analysisId: readiness.activeAnalysis.id,
      });
    }
    const head = await this.repositories.resolveHead(
      organizationObjectId,
      tenantObjectId,
    );
    if (!head) {
      throw new ConflictException({
        message: 'Bind a GitHub repository to this project first',
        errorCode: 'REPOSITORY_NOT_BOUND',
      });
    }
    try {
      const analysisId = await this.mongo.transaction(async (session) => {
        const id = await this.enqueue(
          {
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            uploadId: null,
            commitSha: head.commitSha,
            startedBy: actorSubject,
            startKeyHash,
          },
          session,
        );
        await this.audit.append(
          {
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            actorSubject,
            action: 'analysis.started',
            targetType: 'analysis',
            targetId: id.toHexString(),
            metadata: {
              repository: head.source.fullName,
              commitSha: head.commitSha,
            },
          },
          session,
        );
        return id;
      });
      return this.toSummary(
        await this.findOwned(
          organizationId,
          tenantId,
          analysisId.toHexString(),
        ),
      );
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const raced = await this.analyses.findOne({
        organizationId: organizationObjectId,
        tenantId: tenantObjectId,
        startKeyHash,
      });
      if (!raced) throw error;
      return this.toSummary(raced);
    }
  }

  async list(
    organizationId: string,
    tenantId: string,
    pagination: CursorPaginationDto,
  ): Promise<CursorPage<AnalysisSummaryView>> {
    const filter: Record<string, unknown> = {
      organizationId: objectId(organizationId),
      tenantId: objectId(tenantId),
      schemaVersion: ANALYSIS_SCHEMA_V2,
    };
    const cursor = afterCursor(pagination.cursor);
    if (cursor) filter._id = cursor;
    const documents = await this.analyses
      .find(filter, {
        projection: {
          results: 0,
          readManifest: 0,
          dossier: 0,
          routeRules: 0,
          extraction: 0,
        },
      })
      .sort({ _id: 1 })
      .limit(pagination.limit + 1)
      .toArray();
    const hasNextPage = documents.length > pagination.limit;
    const page = documents.slice(0, pagination.limit);
    return {
      items: page.map((document) => this.toSummary(document)),
      nextCursor: hasNextPage ? page.at(-1)!._id.toHexString() : null,
    };
  }

  async get(
    organizationId: string,
    tenantId: string,
    analysisId: string,
  ): Promise<AnalysisView> {
    const document = await this.findOwned(organizationId, tenantId, analysisId);
    return {
      ...this.toSummary(document),
      extraction: document.extraction,
      index: document.index,
      dossier: document.dossier,
      routeRules: document.routeRules,
      readManifest: document.readManifest,
      results: document.results,
    };
  }

  async listWorkItems(
    organizationId: string,
    tenantId: string,
    analysisId: string,
    pagination: CursorPaginationDto,
  ): Promise<CursorPage<WorkItemView>> {
    const analysis = await this.findOwned(organizationId, tenantId, analysisId);
    const filter: Record<string, unknown> = { analysisId: analysis._id };
    const cursor = afterCursor(pagination.cursor);
    if (cursor) filter._id = cursor;
    const items = await this.workItems
      .find(filter, { projection: { result: 0, notes: 0, hints: 0 } })
      .sort({ _id: 1 })
      .limit(pagination.limit + 1)
      .toArray();
    const hasNextPage = items.length > pagination.limit;
    const page = items.slice(0, pagination.limit);
    return {
      items: page.map((item) => ({
        id: item._id.toHexString(),
        key: item.key,
        method: item.method,
        path: item.path,
        sources: item.sources,
        locations: item.locations,
        status: item.status,
        reason: item.reason,
        errorCode: item.errorCode,
        usd: item.usd,
        turns: item.turns,
      })),
      nextCursor: hasNextPage ? page.at(-1)!._id.toHexString() : null,
    };
  }

  /** Approves a spending ceiling and queues the model phase (ADR-0015). */
  async approveBudget(
    organizationId: string,
    tenantId: string,
    analysisId: string,
    ceilingUsd: number,
    policyReviewMode: PolicyReviewMode,
    idempotencyKey: string | undefined,
    actorSubject: string,
  ): Promise<AnalysisSummaryView> {
    assertIdempotencyKey(idempotencyKey);
    const document = await this.findOwned(organizationId, tenantId, analysisId);
    const requestHash = this.sha256(`${idempotencyKey}:${ceilingUsd}`);
    if (document.budget && document.status !== 'awaiting_budget') {
      if (
        document.budget.ceilingUsd === ceilingUsd &&
        document.budget.source === 'manual'
      ) {
        return this.toSummary(document);
      }
      throw new ConflictException('The budget of this analysis is already set');
    }
    if (document.status !== 'awaiting_budget') {
      throw new ConflictException('The analysis is not awaiting a budget');
    }
    if (!(ceilingUsd > 0 && ceilingUsd <= MAX_CEILING_USD)) {
      throw new ConflictException(
        `The ceiling must be above 0 and at most ${MAX_CEILING_USD} USD`,
      );
    }
    if (!this.ai.status.configured) {
      throw new ConflictException(
        'No AI model is configured for this control plane; set ANTHROPIC_API_KEY or ANALYSIS_AI_BASE_URL',
      );
    }
    const now = new Date();
    await this.mongo.transaction(async (session) => {
      const updated = await this.analyses.updateOne(
        { _id: document._id, status: 'awaiting_budget' },
        {
          $set: {
            status: 'queued',
            phase: 'analyze',
            attempts: 0,
            availableAt: now,
            errorCode: null,
            budget: {
              ceilingUsd,
              approvedBy: actorSubject,
              approvedAt: now,
              source: 'manual',
            },
            policyReview: {
              mode: policyReviewMode,
              chosenBy: actorSubject,
              chosenAt: now,
            },
          },
        },
        { session },
      );
      if (updated.matchedCount === 0) {
        throw new ConflictException('The analysis is not awaiting a budget');
      }
      await this.audit.append(
        {
          organizationId: document.organizationId,
          tenantId: document.tenantId,
          actorSubject,
          action: 'analysis.budget-approved',
          targetType: 'analysis',
          targetId: document._id.toHexString(),
          metadata: {
            ceilingUsd: String(ceilingUsd),
            policyReviewMode,
            requestHash,
          },
        },
        session,
      );
      await this.outbox.append(
        'AnalysisBudgetApproved',
        document.organizationId,
        document.tenantId,
        document._id.toHexString(),
        {
          analysisId: document._id.toHexString(),
          ceilingUsd: String(ceilingUsd),
        },
        session,
      );
    });
    return this.toSummary(
      await this.findOwned(organizationId, tenantId, analysisId),
    );
  }

  /** Resumes an analysis paused by exhausted provider credit. */
  async resume(
    organizationId: string,
    tenantId: string,
    analysisId: string,
    actorSubject: string,
  ): Promise<AnalysisSummaryView> {
    const document = await this.findOwned(organizationId, tenantId, analysisId);
    await this.mongo.transaction(async (session) => {
      const updated = await this.analyses.updateOne(
        { _id: document._id, status: 'paused' },
        {
          $set: {
            status: 'queued',
            attempts: 0,
            availableAt: new Date(),
            errorCode: null,
          },
        },
        { session },
      );
      if (updated.matchedCount === 0) {
        throw new ConflictException('The analysis is not paused');
      }
      await this.audit.append(
        {
          organizationId: document.organizationId,
          tenantId: document.tenantId,
          actorSubject,
          action: 'analysis.resumed',
          targetType: 'analysis',
          targetId: document._id.toHexString(),
        },
        session,
      );
    });
    return this.toSummary(
      await this.findOwned(organizationId, tenantId, analysisId),
    );
  }

  async getSettings(
    organizationId: string,
    tenantId: string,
  ): Promise<AnalysisSettingsView> {
    const settings = await this.settings.findOne({
      organizationId: objectId(organizationId),
      tenantId: objectId(tenantId),
    });
    return {
      autoApproveCeilingUsd: settings?.autoApproveCeilingUsd ?? null,
      defaultPolicyReviewMode: settings?.defaultPolicyReviewMode ?? 'review',
    };
  }

  async setSettings(
    organizationId: string,
    tenantId: string,
    autoApproveCeilingUsd: number | null,
    defaultPolicyReviewMode: PolicyReviewMode | undefined,
    actorSubject: string,
  ): Promise<AnalysisSettingsView> {
    if (
      autoApproveCeilingUsd !== null &&
      !(autoApproveCeilingUsd > 0 && autoApproveCeilingUsd <= MAX_CEILING_USD)
    ) {
      throw new ConflictException(
        `The ceiling must be above 0 and at most ${MAX_CEILING_USD} USD`,
      );
    }
    const organizationObjectId = objectId(organizationId);
    const tenantObjectId = objectId(tenantId);
    await this.mongo.transaction(async (session) => {
      await this.projects.assertBelongToOrganization(
        organizationId,
        [tenantId],
        session,
      );
      await this.settings.updateOne(
        { organizationId: organizationObjectId, tenantId: tenantObjectId },
        {
          $set: {
            autoApproveCeilingUsd,
            ...(defaultPolicyReviewMode ? { defaultPolicyReviewMode } : {}),
            updatedBy: actorSubject,
            updatedAt: new Date(),
          },
          $setOnInsert: { _id: new ObjectId() },
        },
        { upsert: true, session },
      );
      await this.audit.append(
        {
          organizationId: organizationObjectId,
          tenantId: tenantObjectId,
          actorSubject,
          action: 'analysis-settings.updated',
          targetType: 'analysisSettings',
          targetId: tenantId,
          metadata: {
            autoApproveCeilingUsd:
              autoApproveCeilingUsd === null
                ? 'none'
                : String(autoApproveCeilingUsd),
            ...(defaultPolicyReviewMode ? { defaultPolicyReviewMode } : {}),
          },
        },
        session,
      );
    });
    return this.getSettings(organizationId, tenantId);
  }

  /* ---------- worker persistence ---------- */

  async autoApproveCeiling(
    organizationId: ObjectId,
    tenantId: ObjectId,
  ): Promise<number | null> {
    const settings = await this.settings.findOne({ organizationId, tenantId });
    return settings?.autoApproveCeilingUsd ?? null;
  }

  /**
   * The review mode for an analysis whose budget was approved automatically:
   * the project default, attributed to whoever last saved the settings.
   */
  async defaultPolicyReview(
    organizationId: ObjectId,
    tenantId: ObjectId,
  ): Promise<PolicyReviewChoice> {
    const settings = await this.settings.findOne({ organizationId, tenantId });
    return {
      mode: settings?.defaultPolicyReviewMode ?? 'review',
      chosenBy: settings?.updatedBy ?? 'system:auto-approve',
      chosenAt: new Date(),
    };
  }

  /** Writes progress only while the worker still holds the lease. */
  async updateLeased(
    analysisId: ObjectId,
    leaseOwner: string,
    set: Partial<AnalysisDocument>,
  ): Promise<void> {
    const result = await this.analyses.updateOne(
      { _id: analysisId, leaseOwner },
      { $set: set },
    );
    if (result.matchedCount === 0) throw new LeaseLostError();
  }

  /** Inserts work items; keys that already exist are kept as they are. */
  async insertWorkItems(items: WorkItemDocument[]): Promise<void> {
    if (items.length === 0) return;
    const operations: AnyBulkWriteOperation<WorkItemDocument>[] = items.map(
      (item) => ({ insertOne: { document: item } }),
    );
    try {
      await this.workItems.bulkWrite(operations, { ordered: false });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }

  findWorkItems(
    analysisId: ObjectId,
    status?: WorkItemDocument['status'],
  ): Promise<WorkItemDocument[]> {
    return this.workItems
      .find({ analysisId, ...(status ? { status } : {}) })
      .sort({ priority: 1, _id: 1 })
      .toArray();
  }

  async countWorkItems(analysisId: ObjectId): Promise<number> {
    return this.workItems.countDocuments({ analysisId });
  }

  async updateWorkItem(
    id: ObjectId,
    set: Partial<WorkItemDocument>,
  ): Promise<void> {
    await this.workItems.updateOne({ _id: id }, { $set: set });
  }

  async markDuplicates(ids: ObjectId[]): Promise<void> {
    if (ids.length === 0) return;
    await this.workItems.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: 'duplicate',
          reason: 'Resolved to the same method and path as another work item',
        },
      },
    );
  }

  /** Content address of a finished analysis. */
  versionOf(document: AnalysisDocument): string {
    return this.sha256(
      canonicalJson(
        JSON.parse(
          JSON.stringify({
            commitSha: document.commitSha,
            sourceHash: document.extraction?.sourceHash ?? null,
            environment: document.environment?.snapshotId ?? null,
            results: document.results,
          }),
        ) as JsonValue,
      ),
    );
  }

  private async findOwned(
    organizationId: string,
    tenantId: string,
    analysisId: string,
  ): Promise<AnalysisDocument> {
    const document = await this.analyses.findOne({
      _id: objectId(analysisId),
      organizationId: objectId(organizationId),
      tenantId: objectId(tenantId),
      schemaVersion: ANALYSIS_SCHEMA_V2,
    });
    if (!document) throw new NotFoundException('Analysis not found');
    return document;
  }

  private toSummary(document: AnalysisDocument): AnalysisSummaryView {
    return {
      id: document._id.toHexString(),
      organizationId: document.organizationId.toHexString(),
      tenantId: document.tenantId.toHexString(),
      uploadId: document.uploadId?.toHexString() ?? null,
      startedBy: document.startedBy ?? null,
      commitSha: document.commitSha,
      status: document.status,
      phase: document.phase,
      version: document.version,
      repository: document.repository,
      estimate: document.estimate,
      budget: document.budget,
      usage: document.usage,
      environment: document.environment,
      steps: document.steps,
      policyReview: document.policyReview ?? null,
      policy: document.policy ?? null,
      errorCode: document.errorCode,
      createdAt: document.createdAt,
      startedAt: document.startedAt,
      finishedAt: document.finishedAt,
    };
  }

  /**
   * An analysis is unique per collector upload; dashboard-started ones have
   * no upload. Earlier versions created a plain unique index, which would
   * reject a second null, so it is replaced by a partial one.
   */
  private async ensureUploadIndex(): Promise<void> {
    try {
      await this.analyses.dropIndex('uploadId_1');
    } catch {
      // Already replaced, or the collection does not exist yet.
    }
    await this.analyses.createIndex(
      { uploadId: 1 },
      {
        name: 'uploadId_unique_when_set',
        unique: true,
        partialFilterExpression: { uploadId: { $type: 'objectId' } },
      },
    );
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  get analyses() {
    return this.mongo.db.collection<AnalysisDocument>('analyses');
  }

  private get workItems() {
    return this.mongo.db.collection<WorkItemDocument>('analysisWorkItems');
  }

  private get settings() {
    return this.mongo.db.collection<AnalysisSettingsDocument>(
      'analysisSettings',
    );
  }
}
