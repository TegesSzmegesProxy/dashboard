import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ClientSession, ObjectId } from 'mongodb';
import { canonicalJson, JsonValue } from '../../common/canonical-json.js';
import {
  afterCursor,
  CursorPage,
  CursorPaginationDto,
} from '../../common/cursor-pagination.js';
import { assertIdempotencyKey } from '../../common/idempotency-key.js';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import { detectSecrets } from '../../common/secret-detection.js';
import { NATURAL_LANGUAGE_PRECISION_WARNING } from '../../contracts/policy-generation/v1/ai-policy.contract.js';
import {
  StructuredPolicyV1Dto,
  TOOL_REGISTRY_VERSION,
} from '../../contracts/policy/v1/policy.contract.js';
import {
  EndpointPolicyV2,
  jevContextReadsAsInstruction,
  POLICY_SCHEMA_V2,
  StructuredPolicyV2,
} from '../../contracts/policy/v2/policy.contract.js';
import { TOOL_REGISTRY_V2 } from '../../contracts/tools/v2/tool-registry.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { BundlesService } from '../bundles/bundles.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { PolicyCompilerService } from '../policy-compiler/policy-compiler.service.js';
import type { CompiledPolicyV1 } from '../policy-compiler/policy-compiler.types.js';
import { ProjectsService } from '../projects/projects.service.js';
import { ImportPolicyDto, SavePolicyDraftDto } from './policy.dto.js';
import {
  ActivePolicyPointerDocument,
  PolicyVersionDocument,
  PolicyVersionOrigin,
  PolicyVersionV1Document,
  PolicyVersionV2Document,
  PolicyVersionV2View,
  PolicyVersionView,
  ReviewWarning,
} from './policy.types.js';

/** A pending `tessera.policy/v2` proposal committed with its analysis. */
export interface AnalysisPolicyVersionInput {
  organizationId: ObjectId;
  tenantId: ObjectId;
  analysisId: ObjectId;
  aiModel: string | null;
  structuredPolicy: StructuredPolicyV2;
  /** Reconciliation warnings, confidence and inferred tools (kind `analysis`). */
  analysisWarnings: ReviewWarning[];
  /**
   * Set when the analysis was started with `auto_apply` (ADR-0018): the
   * subject who chose it. The version is approved only when it compiled and
   * has no review warning.
   */
  autoApplyBy: string | null;
}

export interface AnalysisPolicyVersionResult {
  version: string;
  created: boolean;
  approved: boolean;
  /** Why a requested automatic approval did not happen. */
  autoApplySkipped: string | null;
}

/** Endpoint key used in diffs, warnings and telemetry. */
const endpointKey = (endpoint: { method: string; path: string }) =>
  `${endpoint.method} ${endpoint.path}`;

export interface GeneratedPolicyVersionInput {
  organizationId: ObjectId;
  tenantId: ObjectId;
  humanReadableIntent: string;
  structuredPolicy: StructuredPolicyV1Dto;
  /** Output of a successful compilation of `structuredPolicy`. */
  compiledPolicy: CompiledPolicyV1;
  origin: Exclude<PolicyVersionOrigin, { kind: 'import' }>;
  actorSubject: string;
}

/** Read-only policy content used as the base of a natural-language edit. */
export interface PolicyContent {
  version: string;
  humanReadableIntent: string;
  structuredPolicy: StructuredPolicyV1Dto;
  origin: PolicyVersionOrigin;
}

type ApprovalDecision = 'approve' | 'reject';
type LifecycleOperation = ApprovalDecision | 'activate';

interface LifecycleIdempotencyDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  policyVersion: string;
  operation: LifecycleOperation;
  requestHash: string;
  payloadHash: string;
  createdAt: Date;
}

@Injectable()
export class PoliciesService implements OnModuleInit {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly compiler: PolicyCompilerService,
    private readonly projects: ProjectsService,
    private readonly bundles: BundlesService,
  ) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.versions.createIndex(
        { organizationId: 1, tenantId: 1, version: 1 },
        { unique: true },
      ),
      this.versions.createIndex({ organizationId: 1, tenantId: 1, _id: 1 }),
      this.activePointers.createIndex(
        { organizationId: 1, tenantId: 1 },
        { unique: true },
      ),
      this.idempotency.createIndex(
        {
          organizationId: 1,
          tenantId: 1,
          policyVersion: 1,
          operation: 1,
          requestHash: 1,
        },
        { unique: true },
      ),
    ]);
  }

  async import(
    organizationId: string,
    tenantId: string,
    dto: ImportPolicyDto,
    actorSubject: string,
  ): Promise<PolicyVersionView> {
    const normalizedIntent = dto.humanReadableIntent.trim();
    const version = this.versionHash(normalizedIntent, dto.structuredPolicy);
    const compilation = this.compiler.compile(dto.structuredPolicy);

    try {
      return await this.mongo.transaction(async (session) => {
        const organizationObjectId = objectId(organizationId);
        const tenantObjectId = objectId(tenantId);
        await this.projects.assertBelongToOrganization(
          organizationId,
          [tenantId],
          session,
        );
        const existing = await this.versions.findOne(
          {
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            version,
          },
          { session },
        );
        if (existing) return this.toView(existing, session);

        const now = new Date();
        const document: PolicyVersionDocument = {
          _id: new ObjectId(),
          organizationId: organizationObjectId,
          tenantId: tenantObjectId,
          version,
          schemaVersion: dto.structuredPolicy.schemaVersion,
          toolRegistryVersion: TOOL_REGISTRY_VERSION,
          humanReadableIntent: normalizedIntent,
          structuredPolicy: dto.structuredPolicy,
          compiledPolicy: compilation.ok
            ? compilation.compiledPolicy
            : undefined,
          compilationStatus: compilation.ok ? 'compiled' : 'failed',
          compilationError: compilation.ok ? undefined : compilation.error,
          approvalStatus: compilation.ok ? 'pending' : 'not_applicable',
          origin: { kind: 'import' },
          createdBy: actorSubject,
          createdAt: now,
          lifecycleUpdatedAt: now,
        };
        await this.versions.insertOne(document, { session });
        await this.audit.append(
          {
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            actorSubject,
            action: 'policy-version.imported',
            targetType: 'policyVersion',
            targetId: version,
            metadata: { compilationStatus: document.compilationStatus },
          },
          session,
        );
        await this.outbox.append(
          'PolicyImported',
          organizationObjectId,
          tenantObjectId,
          version,
          { version },
          session,
        );
        await this.outbox.append(
          compilation.ok ? 'PolicyCompiled' : 'PolicyCompilationFailed',
          organizationObjectId,
          tenantObjectId,
          version,
          compilation.ok
            ? { version }
            : { version, errorCode: compilation.error.code },
          session,
        );
        return this.toView(document, session);
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        return this.get(organizationId, tenantId, version);
      }
      throw error;
    }
  }

  /**
   * Stores an AI-produced, already compiled policy as a pending version
   * inside the caller's transaction. Content-identical versions are reused.
   * Callers must never pass output that failed validation or compilation.
   */
  async createGeneratedVersion(
    input: GeneratedPolicyVersionInput,
    session: ClientSession,
  ): Promise<{ version: string; created: boolean }> {
    const humanReadableIntent = input.humanReadableIntent.trim();
    const version = this.versionHash(
      humanReadableIntent,
      input.structuredPolicy,
    );
    const existing = await this.versions.findOne(
      {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        version,
      },
      { session, projection: { _id: 1 } },
    );
    if (existing) return { version, created: false };

    const now = new Date();
    await this.versions.insertOne(
      {
        _id: new ObjectId(),
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        version,
        schemaVersion: input.structuredPolicy.schemaVersion,
        toolRegistryVersion: TOOL_REGISTRY_VERSION,
        humanReadableIntent,
        structuredPolicy: input.structuredPolicy,
        compiledPolicy: input.compiledPolicy,
        compilationStatus: 'compiled',
        approvalStatus: 'pending',
        origin: input.origin,
        createdBy: input.actorSubject,
        createdAt: now,
        lifecycleUpdatedAt: now,
      },
      { session },
    );
    await this.audit.append(
      {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        actorSubject: input.actorSubject,
        action:
          input.origin.kind === 'edit'
            ? 'policy-version.edited'
            : 'policy-version.generated',
        targetType: 'policyVersion',
        targetId: version,
        metadata: { attemptId: input.origin.attemptId },
      },
      session,
    );
    await this.outbox.append(
      'PolicyGenerated',
      input.organizationId,
      input.tenantId,
      version,
      { version, attemptId: input.origin.attemptId, kind: input.origin.kind },
      session,
    );
    await this.outbox.append(
      'PolicyCompiled',
      input.organizationId,
      input.tenantId,
      version,
      { version },
      session,
    );
    return { version, created: true };
  }

  async findContent(
    organizationId: ObjectId,
    tenantId: ObjectId,
    version: string,
  ): Promise<PolicyContent | null> {
    const document = await this.versions.findOne(
      { organizationId, tenantId, version },
      {
        projection: {
          version: 1,
          schemaVersion: 1,
          humanReadableIntent: 1,
          structuredPolicy: 1,
          origin: 1,
        },
      },
    );
    // Natural-language edits of whole policies exist only for v1.
    if (!document || document.schemaVersion !== 'tessera.policy/v1')
      return null;
    return {
      version: document.version,
      humanReadableIntent: document.humanReadableIntent,
      structuredPolicy: document.structuredPolicy,
      origin: document.origin ?? { kind: 'import' },
    };
  }

  /**
   * Stores the analysis proposal as a pending v2 version inside the
   * analysis' own transaction, and applies a standing approval when one was
   * chosen and nothing needs review (ADR-0018).
   */
  async createV2FromAnalysis(
    input: AnalysisPolicyVersionInput,
    session: ClientSession,
  ): Promise<AnalysisPolicyVersionResult> {
    const policy = input.structuredPolicy;
    const version = this.versionHashV2(policy);
    const existing = await this.versions.findOne(
      {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        version,
      },
      { session, projection: { _id: 1, approvalStatus: 1 } },
    );
    if (existing) {
      return {
        version,
        created: false,
        approved: existing.approvalStatus === 'approved',
        autoApplySkipped: input.autoApplyBy
          ? 'An identical policy version already exists.'
          : null,
      };
    }
    const compilation = this.compiler.compileV2(policy);
    const reviewWarnings = [
      ...input.analysisWarnings,
      ...this.jevContextWarnings(policy),
    ];
    const autoApplySkipped = !input.autoApplyBy
      ? null
      : !compilation.ok
        ? 'The proposal did not compile.'
        : this.containsSecret(policy)
          ? 'The proposal contains text that looks like a credential.'
          : reviewWarnings.length > 0
            ? `${reviewWarnings.length} review warning(s) need a reviewer.`
            : null;
    const approve = input.autoApplyBy !== null && autoApplySkipped === null;
    const now = new Date();
    const document: PolicyVersionV2Document = {
      _id: new ObjectId(),
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      version,
      schemaVersion: POLICY_SCHEMA_V2,
      toolRegistryVersion: TOOL_REGISTRY_V2,
      structuredPolicy: policy,
      compilationStatus: compilation.ok ? 'compiled' : 'failed',
      compilationIssues: compilation.issues,
      reviewWarnings,
      aiWritten: true,
      approvalStatus: !compilation.ok
        ? 'not_applicable'
        : approve
          ? 'approved'
          : 'pending',
      ...(approve ? { approvalSource: 'auto_apply' as const } : {}),
      origin: {
        kind: 'analysis',
        analysisId: input.analysisId.toHexString(),
        aiModel: input.aiModel,
      },
      createdBy: 'system:analysis',
      createdAt: now,
      lifecycleUpdatedAt: now,
    };
    await this.versions.insertOne(document, { session });
    await this.audit.append(
      {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        actorSubject: 'system:analysis',
        action: 'policy-version.proposed',
        targetType: 'policyVersion',
        targetId: version,
        metadata: {
          analysisId: input.analysisId.toHexString(),
          compilationStatus: document.compilationStatus,
        },
      },
      session,
    );
    await this.outbox.append(
      'PolicyProposed',
      input.organizationId,
      input.tenantId,
      version,
      { version, analysisId: input.analysisId.toHexString() },
      session,
    );
    await this.outbox.append(
      compilation.ok ? 'PolicyCompiled' : 'PolicyCompilationFailed',
      input.organizationId,
      input.tenantId,
      version,
      compilation.ok ? { version } : { version, errorCode: 'INVALID_POLICY' },
      session,
    );
    if (approve) {
      await this.audit.append(
        {
          organizationId: input.organizationId,
          tenantId: input.tenantId,
          actorSubject: input.autoApplyBy!,
          action: 'policy-version.approved',
          targetType: 'policyVersion',
          targetId: version,
          metadata: { approvalSource: 'auto_apply' },
        },
        session,
      );
      await this.outbox.append(
        'PolicyApproved',
        input.organizationId,
        input.tenantId,
        version,
        { version },
        session,
      );
      // TODO(ADR-0018): also activate once a bundle schema carries policy v2.
    }
    return { version, created: true, approved: approve, autoApplySkipped };
  }

  /**
   * Saves a policy editor draft as a new pending version. A draft may change
   * human-readable text, tools and JEV context; the endpoints and fields
   * themselves come from the analysis and cannot be added or removed.
   */
  async saveDraft(
    organizationId: string,
    tenantId: string,
    dto: SavePolicyDraftDto,
    actorSubject: string,
  ): Promise<PolicyVersionView> {
    const organizationObjectId = objectId(organizationId);
    const tenantObjectId = objectId(tenantId);
    const parent = await this.versions.findOne({
      organizationId: organizationObjectId,
      tenantId: tenantObjectId,
      version: dto.parentVersion,
    });
    if (!parent) throw new NotFoundException('Parent policy version not found');
    if (parent.schemaVersion !== POLICY_SCHEMA_V2) {
      throw new ConflictException(
        'Only tessera.policy/v2 versions can be edited here',
      );
    }
    const policy = this.normalizeV2(dto.structuredPolicy);
    const shapeIssues = this.shapeChanges(parent.structuredPolicy, policy);
    const secretPaths = this.secretPaths(policy);
    const compilation = this.compiler.compileV2(policy);
    const issues = [...shapeIssues, ...secretPaths, ...compilation.issues];
    if (issues.length > 0) {
      throw new UnprocessableEntityException({
        message: 'The draft cannot be saved',
        issues,
      });
    }
    const version = this.versionHashV2(policy);
    const parentByKey = new Map(
      parent.structuredPolicy.endpoints.map((endpoint) => [
        endpointKey(endpoint),
        canonicalJson(endpoint as unknown as JsonValue),
      ]),
    );
    const changedEndpoints = policy.endpoints
      .filter(
        (endpoint) =>
          parentByKey.get(endpointKey(endpoint)) !==
          canonicalJson(endpoint as unknown as JsonValue),
      )
      .map(endpointKey);
    const textChanged = policy.endpoints.some((endpoint, index) => {
      const before = parent.structuredPolicy.endpoints[index];
      return (
        endpoint.humanReadablePolicy !== before.humanReadablePolicy ||
        endpoint.fields.some(
          (field, fieldIndex) =>
            field.humanReadablePolicy !==
            before.fields[fieldIndex].humanReadablePolicy,
        )
      );
    });

    try {
      return await this.mongo.transaction(async (session) => {
        const existing = await this.versions.findOne(
          {
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            version,
          },
          { session },
        );
        if (existing) return this.toView(existing, session);
        const now = new Date();
        const document: PolicyVersionV2Document = {
          _id: new ObjectId(),
          organizationId: organizationObjectId,
          tenantId: tenantObjectId,
          version,
          schemaVersion: POLICY_SCHEMA_V2,
          toolRegistryVersion: TOOL_REGISTRY_V2,
          structuredPolicy: policy,
          compilationStatus: 'compiled',
          compilationIssues: [],
          reviewWarnings: [
            ...parent.reviewWarnings.filter(
              (warning) => warning.kind === 'analysis',
            ),
            ...this.jevContextWarnings(policy),
          ],
          aiWritten: parent.aiWritten || textChanged,
          approvalStatus: 'pending',
          origin: {
            kind: 'draft',
            parentVersion: parent.version,
            analysisId: parent.origin.analysisId,
            changedEndpoints,
          },
          createdBy: actorSubject,
          createdAt: now,
          lifecycleUpdatedAt: now,
        };
        await this.versions.insertOne(document, { session });
        await this.audit.append(
          {
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            actorSubject,
            action: 'policy-version.drafted',
            targetType: 'policyVersion',
            targetId: version,
            metadata: {
              parentVersion: parent.version,
              changedEndpoints: String(changedEndpoints.length),
            },
          },
          session,
        );
        await this.outbox.append(
          'PolicyDrafted',
          organizationObjectId,
          tenantObjectId,
          version,
          { version, parentVersion: parent.version },
          session,
        );
        await this.outbox.append(
          'PolicyCompiled',
          organizationObjectId,
          tenantObjectId,
          version,
          { version },
          session,
        );
        return this.toView(document, session);
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        return this.get(organizationId, tenantId, version);
      }
      throw error;
    }
  }

  /** Paths of free text in an endpoint that look like a credential. */
  endpointSecretPaths(
    endpoint: EndpointPolicyV2,
    prefix = 'endpoint',
  ): string[] {
    const paths: string[] = [];
    const check = (text: string | null, path: string) => {
      if (text && detectSecrets(text).length > 0)
        paths.push(`${path}: credential`);
    };
    check(endpoint.humanReadablePolicy, `${prefix}.humanReadablePolicy`);
    check(endpoint.jevContext, `${prefix}.jevContext`);
    endpoint.fields.forEach((field, index) => {
      check(
        field.humanReadablePolicy,
        `${prefix}.fields.${index}.humanReadablePolicy`,
      );
      check(field.jevContext, `${prefix}.fields.${index}.jevContext`);
    });
    return paths;
  }

  async list(
    organizationId: string,
    tenantId: string,
    pagination: CursorPaginationDto,
  ): Promise<CursorPage<PolicyVersionView>> {
    const organizationObjectId = objectId(organizationId);
    const tenantObjectId = objectId(tenantId);
    const filter: {
      organizationId: ObjectId;
      tenantId: ObjectId;
      _id?: { $gt: ObjectId };
    } = { organizationId: organizationObjectId, tenantId: tenantObjectId };
    const cursor = afterCursor(pagination.cursor);
    if (cursor) filter._id = cursor;
    const documents = await this.versions
      .find(filter)
      .sort({ _id: 1 })
      .limit(pagination.limit + 1)
      .toArray();
    const active = await this.activePointers.findOne({
      organizationId: organizationObjectId,
      tenantId: tenantObjectId,
    });
    const hasNextPage = documents.length > pagination.limit;
    const pageDocuments = documents.slice(0, pagination.limit);
    return {
      items: pageDocuments.map((document) =>
        this.mapView(document, active?.policyVersion === document.version),
      ),
      nextCursor: hasNextPage ? pageDocuments.at(-1)!._id.toHexString() : null,
    };
  }

  async get(
    organizationId: string,
    tenantId: string,
    version: string,
  ): Promise<PolicyVersionView> {
    const document = await this.versions.findOne({
      organizationId: objectId(organizationId),
      tenantId: objectId(tenantId),
      version,
    });
    if (!document) throw new NotFoundException('Policy version not found');
    return this.toView(document);
  }

  async decideApproval(
    organizationId: string,
    tenantId: string,
    version: string,
    decision: ApprovalDecision,
    reason: string | undefined,
    idempotencyKey: string | undefined,
    actorSubject: string,
  ): Promise<PolicyVersionView> {
    assertIdempotencyKey(idempotencyKey);
    if (decision === 'reject' && !reason?.trim()) {
      throw new BadRequestException('Rejection reason is required');
    }
    const payloadHash = this.contentHash({
      decision,
      reason: reason?.trim() ?? null,
    });
    return this.runIdempotent(
      organizationId,
      tenantId,
      version,
      decision,
      idempotencyKey,
      payloadHash,
      async (document, organizationObjectId, tenantObjectId, session) => {
        if (document.compilationStatus !== 'compiled') {
          throw new ConflictException('Only compiled policies can be reviewed');
        }
        const desiredStatus = decision === 'approve' ? 'approved' : 'rejected';
        if (document.approvalStatus === desiredStatus) return document;
        if (document.approvalStatus !== 'pending') {
          throw new ConflictException('Policy review is already final');
        }
        const now = new Date();
        const lifecycleChanges: {
          approvalStatus: 'approved' | 'rejected';
          lifecycleUpdatedAt: Date;
          rejectionReason?: string;
          approvalSource?: 'manual';
        } = {
          approvalStatus: desiredStatus,
          lifecycleUpdatedAt: now,
        };
        if (
          decision === 'approve' &&
          document.schemaVersion === POLICY_SCHEMA_V2
        ) {
          lifecycleChanges.approvalSource = 'manual';
        }
        if (decision === 'reject') {
          lifecycleChanges.rejectionReason = reason!.trim();
        }
        const updated = await this.versions.findOneAndUpdate(
          {
            _id: document._id,
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            approvalStatus: 'pending',
          },
          { $set: lifecycleChanges },
          { returnDocument: 'after', session },
        );
        if (!updated) throw new ConflictException('Policy state changed');
        const eventType =
          decision === 'approve' ? 'PolicyApproved' : 'PolicyRejected';
        await this.outbox.append(
          eventType,
          organizationObjectId,
          tenantObjectId,
          version,
          { version },
          session,
        );
        await this.audit.append(
          {
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            actorSubject,
            action:
              decision === 'approve'
                ? 'policy-version.approved'
                : 'policy-version.rejected',
            targetType: 'policyVersion',
            targetId: version,
          },
          session,
        );
        return updated;
      },
    );
  }

  async activate(
    organizationId: string,
    tenantId: string,
    version: string,
    idempotencyKey: string | undefined,
    actorSubject: string,
  ): Promise<PolicyVersionView> {
    assertIdempotencyKey(idempotencyKey);
    return this.runIdempotent(
      organizationId,
      tenantId,
      version,
      'activate',
      idempotencyKey,
      this.contentHash({ version }),
      async (document, organizationObjectId, tenantObjectId, session) => {
        if (
          document.compilationStatus !== 'compiled' ||
          document.approvalStatus !== 'approved'
        ) {
          throw new ConflictException(
            'Only approved, compiled policies can be activated',
          );
        }
        if (document.schemaVersion === POLICY_SCHEMA_V2) {
          // ADR-0014: a later bundle schema must carry policy v2 first.
          throw new ConflictException({
            message:
              'BUNDLE_SCHEMA_UNAVAILABLE: tessera.policy/v2 cannot be activated until proxies accept a bundle schema that carries it',
            errorCode: 'BUNDLE_SCHEMA_UNAVAILABLE',
          });
        }
        // Re-activating the selected policy rebuilds its bundle, which is how
        // edited runtime configuration reaches proxies.
        const bundle = await this.bundles.activate(
          {
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            policyVersion: version,
            compiledPolicy: document.compiledPolicy!,
            actorSubject,
          },
          session,
        );
        const current = await this.activePointers.findOne(
          { organizationId: organizationObjectId, tenantId: tenantObjectId },
          { session },
        );
        if (current?.policyVersion === version) return document;
        const now = new Date();
        await this.activePointers.updateOne(
          { organizationId: organizationObjectId, tenantId: tenantObjectId },
          {
            $set: {
              policyVersion: version,
              activatedBy: actorSubject,
              activatedAt: now,
            },
            $setOnInsert: {
              _id: new ObjectId(),
              organizationId: organizationObjectId,
              tenantId: tenantObjectId,
            },
          },
          { upsert: true, session },
        );
        await this.outbox.append(
          'PolicyActivated',
          organizationObjectId,
          tenantObjectId,
          version,
          { version, bundleVersion: bundle.bundleVersion },
          session,
        );
        await this.audit.append(
          {
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            actorSubject,
            action: 'policy-version.activated',
            targetType: 'policySelection',
            targetId: tenantObjectId.toHexString(),
            metadata: { version, bundleVersion: bundle.bundleVersion },
          },
          session,
        );
        return document;
      },
    );
  }

  private async runIdempotent(
    organizationId: string,
    tenantId: string,
    version: string,
    operation: LifecycleOperation,
    idempotencyKey: string,
    payloadHash: string,
    mutation: (
      document: PolicyVersionDocument,
      organizationObjectId: ObjectId,
      tenantObjectId: ObjectId,
      session: ClientSession,
    ) => Promise<PolicyVersionDocument>,
  ): Promise<PolicyVersionView> {
    const requestHash = this.contentHash({ idempotencyKey });
    try {
      return await this.mongo.transaction(async (session) => {
        const organizationObjectId = objectId(organizationId);
        const tenantObjectId = objectId(tenantId);
        const document = await this.versions.findOne(
          {
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            version,
          },
          { session },
        );
        if (!document) throw new NotFoundException('Policy version not found');
        const prior = await this.idempotency.findOne(
          {
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            policyVersion: version,
            operation,
            requestHash,
          },
          { session },
        );
        if (prior) {
          if (prior.payloadHash !== payloadHash) {
            throw new ConflictException(
              'Idempotency-Key was reused with a different payload',
            );
          }
          return this.toView(document, session);
        }
        const updated = await mutation(
          document,
          organizationObjectId,
          tenantObjectId,
          session,
        );
        await this.idempotency.insertOne(
          {
            _id: new ObjectId(),
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            policyVersion: version,
            operation,
            requestHash,
            payloadHash,
            createdAt: new Date(),
          },
          { session },
        );
        return this.toView(updated, session);
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        return this.runIdempotent(
          organizationId,
          tenantId,
          version,
          operation,
          idempotencyKey,
          payloadHash,
          mutation,
        );
      }
      throw error;
    }
  }

  private async toView(
    document: PolicyVersionDocument,
    session?: ClientSession,
  ): Promise<PolicyVersionView> {
    const active = await this.activePointers.findOne(
      {
        organizationId: document.organizationId,
        tenantId: document.tenantId,
      },
      { session },
    );
    return this.mapView(document, active?.policyVersion === document.version);
  }

  private mapView(
    document: PolicyVersionDocument,
    isActive: boolean,
  ): PolicyVersionView {
    return document.schemaVersion === POLICY_SCHEMA_V2
      ? this.mapViewV2(document, isActive)
      : this.mapViewV1(document, isActive);
  }

  private lifecycleState(
    document: PolicyVersionDocument,
    isActive: boolean,
  ): PolicyVersionView['state'] {
    return isActive
      ? 'ACTIVE'
      : document.compilationStatus === 'failed'
        ? 'COMPILATION_FAILED'
        : document.approvalStatus === 'approved'
          ? 'APPROVED'
          : document.approvalStatus === 'rejected'
            ? 'REJECTED'
            : 'PENDING_APPROVAL';
  }

  private mapViewV2(
    document: PolicyVersionV2Document,
    isActive: boolean,
  ): PolicyVersionV2View {
    return {
      id: document._id.toHexString(),
      organizationId: document.organizationId.toHexString(),
      tenantId: document.tenantId.toHexString(),
      version: document.version,
      schemaVersion: document.schemaVersion,
      toolRegistryVersion: document.toolRegistryVersion,
      structuredPolicy: document.structuredPolicy,
      compilationStatus: document.compilationStatus,
      compilationIssues: document.compilationIssues,
      reviewWarnings: document.reviewWarnings,
      approvalStatus: document.approvalStatus,
      approvalSource: document.approvalSource ?? null,
      rejectionReason: document.rejectionReason ?? null,
      state: this.lifecycleState(document, isActive),
      origin: document.origin,
      precisionWarning: document.aiWritten
        ? NATURAL_LANGUAGE_PRECISION_WARNING
        : null,
      activatable: false,
      createdBy: document.createdBy,
      createdAt: document.createdAt,
      lifecycleUpdatedAt: document.lifecycleUpdatedAt,
    };
  }

  private mapViewV1(
    document: PolicyVersionV1Document,
    isActive: boolean,
  ): PolicyVersionView {
    const state = this.lifecycleState(document, isActive);
    const origin = document.origin ?? { kind: 'import' };
    return {
      id: document._id.toHexString(),
      organizationId: document.organizationId.toHexString(),
      tenantId: document.tenantId.toHexString(),
      version: document.version,
      schemaVersion: document.schemaVersion,
      toolRegistryVersion: document.toolRegistryVersion,
      humanReadableIntent: document.humanReadableIntent,
      structuredPolicy: document.structuredPolicy,
      compiledPolicy: document.compiledPolicy ?? null,
      compilationStatus: document.compilationStatus,
      compilationError: document.compilationError ?? null,
      approvalStatus: document.approvalStatus,
      rejectionReason: document.rejectionReason ?? null,
      state,
      origin,
      precisionWarning:
        origin.kind === 'import' ? null : NATURAL_LANGUAGE_PRECISION_WARNING,
      createdBy: document.createdBy,
      createdAt: document.createdAt,
      lifecycleUpdatedAt: document.lifecycleUpdatedAt,
    };
  }

  private versionHash(
    humanReadableIntent: string,
    structuredPolicy: StructuredPolicyV1Dto,
  ): string {
    return this.contentHash({
      schemaVersion: structuredPolicy.schemaVersion,
      toolRegistryVersion: TOOL_REGISTRY_VERSION,
      humanReadableIntent,
      structuredPolicy,
    } as unknown as JsonValue);
  }

  private versionHashV2(policy: StructuredPolicyV2): string {
    return this.contentHash({
      schemaVersion: policy.schemaVersion,
      toolRegistryVersion: policy.toolRegistryVersion,
      structuredPolicy: policy,
    } as unknown as JsonValue);
  }

  /** Copies only contract properties and trims free text. */
  private normalizeV2(policy: StructuredPolicyV2): StructuredPolicyV2 {
    const text = (value: string | null) => {
      const trimmed = value?.trim() ?? '';
      return trimmed === '' ? null : trimmed;
    };
    return {
      schemaVersion: policy.schemaVersion,
      toolRegistryVersion: policy.toolRegistryVersion,
      endpoints: policy.endpoints.map((endpoint) => ({
        method: endpoint.method,
        path: endpoint.path,
        humanReadablePolicy: endpoint.humanReadablePolicy.trim(),
        requestTools: endpoint.requestTools.map((tool) => ({
          toolId: tool.toolId,
        })),
        jevContext: text(endpoint.jevContext),
        fields: endpoint.fields.map((field) => ({
          name: field.name,
          location: field.location,
          type: field.type,
          required: field.required,
          humanReadablePolicy: field.humanReadablePolicy.trim(),
          tools: field.tools.map((tool) => ({ toolId: tool.toolId })),
          jevContext: text(field.jevContext),
        })),
      })),
    };
  }

  /** A draft keeps its parent's endpoints and fields, in the same order. */
  private shapeChanges(
    parent: StructuredPolicyV2,
    draft: StructuredPolicyV2,
  ): string[] {
    if (parent.endpoints.length !== draft.endpoints.length) {
      return ['endpoints: added or removed'];
    }
    return draft.endpoints.flatMap((endpoint, index) => {
      const before = parent.endpoints[index];
      if (endpointKey(endpoint) !== endpointKey(before)) {
        return [`endpoints.${index}: changed endpoint`];
      }
      if (endpoint.fields.length !== before.fields.length) {
        return [`endpoints.${index}.fields: added or removed`];
      }
      return endpoint.fields.flatMap((field, fieldIndex) => {
        const old = before.fields[fieldIndex];
        return field.name !== old.name ||
          field.location !== old.location ||
          field.type !== old.type ||
          field.required !== old.required
          ? [`endpoints.${index}.fields.${fieldIndex}: changed field`]
          : [];
      });
    });
  }

  private secretPaths(policy: StructuredPolicyV2): string[] {
    return policy.endpoints.flatMap((endpoint, index) =>
      this.endpointSecretPaths(endpoint, `endpoints.${index}`),
    );
  }

  private containsSecret(policy: StructuredPolicyV2): boolean {
    return this.secretPaths(policy).length > 0;
  }

  private jevContextWarnings(policy: StructuredPolicyV2): ReviewWarning[] {
    const message =
      'JEV context reads like an instruction or verdict; review it before approval.';
    return policy.endpoints.flatMap((endpoint) => [
      ...(endpoint.jevContext &&
      jevContextReadsAsInstruction(endpoint.jevContext)
        ? [
            {
              kind: 'jev_context' as const,
              endpoint: endpointKey(endpoint),
              field: null,
              message,
            },
          ]
        : []),
      ...endpoint.fields
        .filter(
          (field) =>
            field.jevContext && jevContextReadsAsInstruction(field.jevContext),
        )
        .map((field) => ({
          kind: 'jev_context' as const,
          endpoint: endpointKey(endpoint),
          field: `${field.location}:${field.name}`,
          message,
        })),
    ]);
  }

  private contentHash(value: JsonValue): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
  }

  private get versions() {
    return this.mongo.db.collection<PolicyVersionDocument>('policyVersions');
  }

  private get activePointers() {
    return this.mongo.db.collection<ActivePolicyPointerDocument>(
      'activePolicyPointers',
    );
  }

  private get idempotency() {
    return this.mongo.db.collection<LifecycleIdempotencyDocument>(
      'policyLifecycleIdempotency',
    );
  }
}
