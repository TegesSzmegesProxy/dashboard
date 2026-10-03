import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ClientSession, ObjectId } from 'mongodb';
import { canonicalJson, JsonValue } from '../../common/canonical-json.js';
import {
  afterCursor,
  CursorPage,
  CursorPaginationDto,
} from '../../common/cursor-pagination.js';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import { TOOL_REGISTRY_VERSION } from '../../contracts/policy/v1/policy.contract.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { PolicyCompilerService } from '../policy-compiler/policy-compiler.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { ImportPolicyDto } from './policy.dto.js';
import {
  ActivePolicyPointerDocument,
  PolicyVersionDocument,
  PolicyVersionView,
} from './policy.types.js';

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
    const version = this.contentHash({
      schemaVersion: dto.structuredPolicy.schemaVersion,
      toolRegistryVersion: TOOL_REGISTRY_VERSION,
      humanReadableIntent: normalizedIntent,
      structuredPolicy: dto.structuredPolicy,
    } as unknown as JsonValue);
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
        await this.outbox.appendPolicyEvent(
          'PolicyImported',
          organizationObjectId,
          tenantObjectId,
          version,
          { version },
          session,
        );
        await this.outbox.appendPolicyEvent(
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
    this.validateIdempotencyKey(idempotencyKey);
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
      idempotencyKey!,
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
        } = {
          approvalStatus: desiredStatus,
          lifecycleUpdatedAt: now,
        };
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
        await this.outbox.appendPolicyEvent(
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
    this.validateIdempotencyKey(idempotencyKey);
    return this.runIdempotent(
      organizationId,
      tenantId,
      version,
      'activate',
      idempotencyKey!,
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
        await this.outbox.appendPolicyEvent(
          'PolicyActivated',
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
            action: 'policy-version.activated',
            targetType: 'policySelection',
            targetId: tenantObjectId.toHexString(),
            metadata: { version },
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
    const state = isActive
      ? 'ACTIVE'
      : document.compilationStatus === 'failed'
        ? 'COMPILATION_FAILED'
        : document.approvalStatus === 'approved'
          ? 'APPROVED'
          : document.approvalStatus === 'rejected'
            ? 'REJECTED'
            : 'PENDING_APPROVAL';
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
      createdBy: document.createdBy,
      createdAt: document.createdAt,
      lifecycleUpdatedAt: document.lifecycleUpdatedAt,
    };
  }

  private validateIdempotencyKey(value: string | undefined): void {
    if (
      !value ||
      value.length < 16 ||
      value.length > 200 ||
      !/^[-\w.]+$/.test(value)
    ) {
      throw new BadRequestException(
        'Idempotency-Key must contain 16-200 safe characters',
      );
    }
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
