import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ClientSession, ObjectId } from 'mongodb';
import { canonicalJson } from '../../common/canonical-json.js';
import {
  afterCursor,
  CursorPage,
  CursorPaginationDto,
} from '../../common/cursor-pagination.js';
import { assertIdempotencyKey } from '../../common/idempotency-key.js';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import { detectSecrets } from '../../common/secret-detection.js';
import { NATURAL_LANGUAGE_PRECISION_WARNING } from '../../contracts/policy-generation/v1/ai-policy.contract.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { PoliciesService } from '../policies/policies.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { CompileHumanReadablePolicyDto } from '../policies/policy.dto.js';
import {
  CompiledEndpointView,
  PolicyGenerationDocument,
  PolicyGenerationKind,
  PolicyGenerationView,
} from './policy-generation.types.js';

export const POLICY_GENERATION_ACTOR = 'system:policy-generation';

type NewAttempt = Pick<
  PolicyGenerationDocument,
  | 'organizationId'
  | 'tenantId'
  | 'kind'
  | 'trigger'
  | 'analysisId'
  | 'analysisVersion'
  | 'baseVersion'
  | 'instruction'
  | 'requestedBy'
  | 'requestHash'
  | 'payloadHash'
  | 'sourceEventId'
>;

@Injectable()
export class PolicyGenerationService implements OnModuleInit {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly projects: ProjectsService,
    private readonly policies: PoliciesService,
  ) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ organizationId: 1, tenantId: 1, _id: 1 }),
      this.collection.createIndex({ status: 1, availableAt: 1 }),
      this.collection.createIndex(
        { organizationId: 1, tenantId: 1, requestHash: 1 },
        {
          unique: true,
          partialFilterExpression: { requestHash: { $type: 'string' } },
        },
      ),
      this.collection.createIndex(
        { sourceEventId: 1 },
        {
          unique: true,
          partialFilterExpression: { sourceEventId: { $type: 'string' } },
        },
      ),
    ]);
  }

  /** Requests a natural-language edit; the result is a new version. */
  async requestEdit(
    organizationId: string,
    tenantId: string,
    baseVersion: string,
    instruction: string,
    idempotencyKey: string | undefined,
    actorSubject: string,
  ): Promise<PolicyGenerationView> {
    assertIdempotencyKey(idempotencyKey);
    const normalized = instruction.trim();
    const secretRules = [
      ...new Set(detectSecrets(normalized).map((finding) => finding.ruleId)),
    ];
    if (secretRules.length > 0) {
      // Rule ids only; the instruction itself is neither stored nor echoed.
      throw new UnprocessableEntityException(
        `Instruction contains a detectable credential (${secretRules.join(', ')})`,
      );
    }
    const organizationObjectId = objectId(organizationId);
    const tenantObjectId = objectId(tenantId);
    return this.createRequested(
      'edit',
      organizationObjectId,
      tenantObjectId,
      idempotencyKey,
      { baseVersion, instruction: normalized },
      async () => {
        const base = await this.policies.findContent(
          organizationObjectId,
          tenantObjectId,
          baseVersion,
        );
        if (!base) throw new NotFoundException('Policy version not found');
        return {
          organizationId: organizationObjectId,
          tenantId: tenantObjectId,
          kind: 'edit',
          trigger: 'dashboard',
          analysisId: null,
          analysisVersion: null,
          baseVersion,
          instruction: normalized,
          requestedBy: actorSubject,
        };
      },
    );
  }

  /**
   * Compiles the edited human-readable policy of one endpoint, or of one of
   * its fields, into the endpoint's tools and JEV context (ADR-0014). The
   * result is a preview for the editor's draft and creates nothing.
   */
  async compileHumanReadablePolicy(
    organizationId: string,
    tenantId: string,
    dto: CompileHumanReadablePolicyDto,
  ): Promise<CompiledEndpointView> {
    const parent = await this.policies.get(
      organizationId,
      tenantId,
      dto.parentVersion,
    );
    if (parent.schemaVersion !== 'tessera.policy/v2') {
      throw new ConflictException('Only tessera.policy/v2 endpoints compile');
    }
    const endpoint = dto.endpoint;
    const known = parent.structuredPolicy.endpoints.some(
      (candidate) =>
        candidate.method === endpoint.method &&
        candidate.path === endpoint.path,
    );
    if (!known) throw new NotFoundException('Endpoint not in this policy');
    if (
      dto.target.kind === 'field' &&
      !endpoint.fields.some(
        (field) =>
          field.location === dto.target.location &&
          field.name === dto.target.name,
      )
    ) {
      throw new NotFoundException('Field not in this endpoint');
    }
    const secrets = this.policies.endpointSecretPaths(endpoint);
    if (secrets.length > 0) {
      throw new UnprocessableEntityException({
        message: 'The text contains something that looks like a credential',
        issues: secrets,
      });
    }

    // TODO(M7): run an `endpoint_edit` policy generation attempt through the
    // PolicyGenerationProvider, grounded in the analysis facts of
    // `parent.origin.analysisId`, and validate its output with
    // `PolicyCompilerService.compileV2` before returning it. Until then the
    // tools and JEV context are returned unchanged with the edited text.
    return {
      endpoint,
      limitations: [
        'The plain-language compiler is not available yet, so the checks were not regenerated from your text. Adjust the checks yourself so they match it.',
      ],
      mock: true,
    };
  }

  async list(
    organizationId: string,
    tenantId: string,
    pagination: CursorPaginationDto,
  ): Promise<CursorPage<PolicyGenerationView>> {
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
      .find(filter)
      .sort({ _id: 1 })
      .limit(pagination.limit + 1)
      .toArray();
    const hasNextPage = documents.length > pagination.limit;
    const pageDocuments = documents.slice(0, pagination.limit);
    return {
      items: pageDocuments.map((document) => this.toView(document)),
      nextCursor: hasNextPage ? pageDocuments.at(-1)!._id.toHexString() : null,
    };
  }

  async get(
    organizationId: string,
    tenantId: string,
    attemptId: string,
  ): Promise<PolicyGenerationView> {
    const document = await this.collection.findOne({
      _id: objectId(attemptId),
      organizationId: objectId(organizationId),
      tenantId: objectId(tenantId),
    });
    if (!document) throw new NotFoundException('Policy generation not found');
    return this.toView(document);
  }

  toView(document: PolicyGenerationDocument): PolicyGenerationView {
    return {
      id: document._id.toHexString(),
      organizationId: document.organizationId.toHexString(),
      tenantId: document.tenantId.toHexString(),
      kind: document.kind,
      trigger: document.trigger,
      status: document.status,
      analysisId: document.analysisId?.toHexString() ?? null,
      analysisVersion: document.analysisVersion,
      baseVersion: document.baseVersion,
      instruction: document.instruction,
      requestedBy: document.requestedBy,
      policyVersion: document.policyVersion,
      reusedExistingVersion: document.reusedExistingVersion,
      limitations: document.limitations,
      diff: document.diff,
      errorCode: document.errorCode,
      errorMessage: document.errorMessage,
      validationIssues: document.validationIssues,
      provenance: document.provenance,
      precisionWarning: NATURAL_LANGUAGE_PRECISION_WARNING,
      createdAt: document.createdAt,
      startedAt: document.startedAt,
      finishedAt: document.finishedAt,
    };
  }

  private async createRequested(
    kind: PolicyGenerationKind,
    organizationId: ObjectId,
    tenantId: ObjectId,
    idempotencyKey: string,
    payload: Record<string, string>,
    prepare: (session: ClientSession) => Promise<NewAttempt>,
  ): Promise<PolicyGenerationView> {
    const requestHash = this.hash({ idempotencyKey });
    const payloadHash = this.hash({ kind, ...payload });
    try {
      return await this.mongo.transaction(async (session) => {
        await this.projects.assertBelongToOrganization(
          organizationId.toHexString(),
          [tenantId.toHexString()],
          session,
        );
        const prior = await this.collection.findOne(
          { organizationId, tenantId, requestHash },
          { session },
        );
        if (prior) return this.replay(prior, payloadHash);
        const attempt = await prepare(session);
        const document = await this.insertAttempt(
          { ...attempt, requestHash, payloadHash },
          session,
        );
        return this.toView(document);
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const prior = await this.collection.findOne({
        organizationId,
        tenantId,
        requestHash,
      });
      if (!prior) throw error;
      return this.replay(prior, payloadHash);
    }
  }

  private replay(
    prior: PolicyGenerationDocument,
    payloadHash: string,
  ): PolicyGenerationView {
    if (prior.payloadHash !== payloadHash) {
      throw new ConflictException(
        'Idempotency-Key was reused with a different payload',
      );
    }
    return this.toView(prior);
  }

  private async insertAttempt(
    attempt: NewAttempt,
    session: ClientSession,
  ): Promise<PolicyGenerationDocument> {
    const now = new Date();
    const document: PolicyGenerationDocument = {
      _id: new ObjectId(),
      ...attempt,
      status: 'queued',
      attempts: 0,
      availableAt: now,
      policyVersion: null,
      reusedExistingVersion: false,
      limitations: [],
      diff: null,
      errorCode: null,
      errorMessage: null,
      validationIssues: [],
      provenance: { aiProvider: null, aiModel: null },
      createdAt: now,
      startedAt: null,
      finishedAt: null,
    };
    // Optional keys must be absent, not null, for the partial unique indexes.
    if (document.requestHash === undefined) delete document.requestHash;
    if (document.payloadHash === undefined) delete document.payloadHash;
    if (document.sourceEventId === undefined) delete document.sourceEventId;
    await this.collection.insertOne(document, { session });
    const attemptId = document._id.toHexString();
    await this.outbox.append(
      'PolicyGenerationRequested',
      document.organizationId,
      document.tenantId,
      attemptId,
      {
        attemptId,
        kind: document.kind,
        ...(document.analysisId
          ? { analysisId: document.analysisId.toHexString() }
          : {}),
        ...(document.baseVersion ? { baseVersion: document.baseVersion } : {}),
      },
      session,
    );
    await this.audit.append(
      {
        organizationId: document.organizationId,
        tenantId: document.tenantId,
        actorSubject: document.requestedBy,
        action:
          document.kind === 'edit'
            ? 'policy-edit.requested'
            : 'policy-generation.requested',
        targetType: 'policyGeneration',
        targetId: attemptId,
        metadata: {
          trigger: document.trigger,
          ...(document.analysisId
            ? { analysisId: document.analysisId.toHexString() }
            : {}),
          ...(document.baseVersion
            ? { baseVersion: document.baseVersion }
            : {}),
        },
      },
      session,
    );
    return document;
  }

  private hash(value: Record<string, string>): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
  }

  private get collection() {
    return this.mongo.db.collection<PolicyGenerationDocument>(
      'policyGenerations',
    );
  }
}
