import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { canonicalJson, JsonValue } from '../../common/canonical-json.js';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import { detectSecrets } from '../../common/secret-detection.js';
import { AnalysisUploadV1Dto } from '../../contracts/analysis-upload/v1/analysis-upload.contract.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { AnalysesService } from '../analyses/analyses.service.js';
import type { MachinePrincipal } from '../api-keys/api-key.types.js';
import { AuditService } from '../audit/audit.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { SourceRepositoriesService } from '../source-repositories/source-repositories.service.js';
import {
  AnalysisUploadDocument,
  AnalysisUploadReceipt,
  AnalysisUploadView,
} from './analysis-upload.types.js';

const MAX_REPORTED_FINDINGS = 50;

@Injectable()
export class AnalysisUploadsService implements OnModuleInit {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly audit: AuditService,
    private readonly projects: ProjectsService,
    private readonly repositories: SourceRepositoriesService,
    private readonly analyses: AnalysesService,
  ) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.collection.createIndex(
        { organizationId: 1, tenantId: 1, requestHash: 1 },
        { unique: true },
      ),
      // Content-identical uploads are one upload.
      this.collection.createIndex(
        { organizationId: 1, tenantId: 1, payloadHash: 1 },
        { unique: true },
      ),
    ]);
  }

  async receive(
    principal: MachinePrincipal,
    tenantId: string,
    dto: AnalysisUploadV1Dto,
    idempotencyKey: string | undefined,
  ): Promise<AnalysisUploadReceipt> {
    this.validateIdempotencyKey(idempotencyKey);
    const organizationObjectId = objectId(principal.organizationId);
    const tenantObjectId = objectId(tenantId);
    if (
      !(await this.projects.findRuntimeConfiguration(
        organizationObjectId,
        tenantObjectId,
      ))
    ) {
      throw new NotFoundException('Tenant not found');
    }
    this.rejectSecrets(dto);

    const payload = JSON.parse(JSON.stringify(dto)) as JsonValue;
    const payloadHash = this.sha256(canonicalJson(payload));
    const requestHash = this.sha256(idempotencyKey!);
    const prior = await this.findPrior(
      organizationObjectId,
      tenantObjectId,
      requestHash,
      payloadHash,
    );
    if (prior) return prior;

    if (
      !(await this.repositories.findSource(
        organizationObjectId,
        tenantObjectId,
      ))
    ) {
      throw new UnprocessableEntityException(
        'Bind a source repository to this project before uploading',
      );
    }

    // Environment context now comes from environment snapshots (ADR-0012);
    // the upload's environment section is summarized, not stored.
    try {
      return await this.mongo.transaction(async (session) => {
        const uploadId = new ObjectId();
        const analysisId = await this.analyses.enqueue(
          {
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            uploadId,
            commitSha: dto.sourceRevision.commitSha,
          },
          session,
        );
        const document: AnalysisUploadDocument = {
          _id: uploadId,
          organizationId: organizationObjectId,
          tenantId: tenantObjectId,
          apiKeyId: objectId(principal.apiKeyId),
          requestHash,
          payloadHash,
          schemaVersion: dto.schemaVersion,
          commitSha: dto.sourceRevision.commitSha,
          collector: {
            name: dto.collector.name,
            version: dto.collector.version,
          },
          redaction: {
            tool: dto.redaction.tool,
            rules: dto.redaction.rules,
            redactedValueCount: dto.redaction.redactedValueCount,
          },
          environmentSummary: {
            tools: dto.environment.tools.map((tool) => ({
              name: tool.name,
              version: tool.version,
              status: tool.status,
            })),
            dependencyCount: dto.environment.dependencies.length,
            vulnerabilityCount: dto.environment.vulnerabilities.length,
          },
          analysisId,
          receivedAt: new Date(),
        };
        await this.collection.insertOne(document, { session });
        await this.audit.append(
          {
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            actorSubject: `machine:${principal.apiKeyId}`,
            action: 'analysis-upload.received',
            targetType: 'analysisUpload',
            targetId: uploadId.toHexString(),
            metadata: {
              commitSha: document.commitSha,
              analysisId: analysisId.toHexString(),
            },
          },
          session,
        );
        return {
          uploadId: uploadId.toHexString(),
          analysisId: analysisId.toHexString(),
          status: 'queued' as const,
          duplicate: false,
        };
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        const raced = await this.findPrior(
          organizationObjectId,
          tenantObjectId,
          requestHash,
          payloadHash,
        );
        if (raced) return raced;
      }
      throw error;
    }
  }

  async getForCollector(
    principal: MachinePrincipal,
    tenantId: string,
    uploadId: string,
  ): Promise<AnalysisUploadView> {
    return this.get(principal.organizationId, tenantId, uploadId);
  }

  async get(
    organizationId: string,
    tenantId: string,
    uploadId: string,
  ): Promise<AnalysisUploadView> {
    const document = await this.collection.findOne({
      _id: objectId(uploadId),
      organizationId: objectId(organizationId),
      tenantId: objectId(tenantId),
    });
    if (!document) throw new NotFoundException('Upload not found');
    return {
      id: document._id.toHexString(),
      tenantId: document.tenantId.toHexString(),
      analysisId: document.analysisId.toHexString(),
      analysisStatus: await this.analyses.statusOf(document.analysisId),
      commitSha: document.commitSha,
      collector: document.collector,
      redaction: document.redaction,
      environmentSummary: document.environmentSummary,
      receivedAt: document.receivedAt,
    };
  }

  private async findPrior(
    organizationId: ObjectId,
    tenantId: ObjectId,
    requestHash: string,
    payloadHash: string,
  ): Promise<AnalysisUploadReceipt | null> {
    const byKey = await this.collection.findOne({
      organizationId,
      tenantId,
      requestHash,
    });
    if (byKey && byKey.payloadHash !== payloadHash) {
      throw new ConflictException(
        'Idempotency-Key was reused with a different payload',
      );
    }
    const prior =
      byKey ??
      (await this.collection.findOne({
        organizationId,
        tenantId,
        payloadHash,
      }));
    if (!prior) return null;
    return {
      uploadId: prior._id.toHexString(),
      analysisId: prior.analysisId.toHexString(),
      status: await this.analyses.statusOf(prior.analysisId),
      duplicate: true,
    };
  }

  /** Rejects the whole upload; nothing is stored and values are not echoed. */
  private rejectSecrets(dto: AnalysisUploadV1Dto): void {
    const findings: { path: string; ruleId: string }[] = [];
    const visit = (value: unknown, path: string) => {
      if (findings.length >= MAX_REPORTED_FINDINGS) return;
      if (typeof value === 'string') {
        for (const finding of detectSecrets(value)) {
          findings.push({ path, ruleId: finding.ruleId });
        }
      } else if (Array.isArray(value)) {
        value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      } else if (value && typeof value === 'object') {
        for (const [key, entry] of Object.entries(value)) {
          visit(entry, path ? `${path}.${key}` : key);
        }
      }
    };
    visit(dto, '');
    if (findings.length > 0) {
      throw new UnprocessableEntityException({
        message:
          'Upload rejected: values look like unredacted credentials. Redact them in the collector and retry.',
        findings: findings.slice(0, MAX_REPORTED_FINDINGS),
      });
    }
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

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private get collection() {
    return this.mongo.db.collection<AnalysisUploadDocument>('analysisUploads');
  }
}
