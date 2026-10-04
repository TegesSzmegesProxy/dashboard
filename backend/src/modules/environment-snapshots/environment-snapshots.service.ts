import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { canonicalJson, JsonValue } from '../../common/canonical-json.js';
import { assertIdempotencyKey } from '../../common/idempotency-key.js';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import { redactSecrets } from '../../common/secret-detection.js';
import { Environment } from '../../config/environment.js';
import {
  ENVIRONMENT_SCHEMA_VERSION,
  ENVIRONMENT_TOOLS,
  EnvironmentRuns,
  EnvironmentSnapshotV1Dto,
  EnvironmentTool,
  MAX_HEADER_NAME,
  MAX_HEADER_VALUE,
  MAX_HTTP_HEADERS,
} from '../../contracts/environment/v1/environment.contract.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import type { MachinePrincipal } from '../api-keys/api-key.types.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import {
  ENVIRONMENT_MISSING_NOTICE,
  EnvironmentSnapshotDocument,
  EnvironmentSnapshotReceipt,
  EnvironmentSnapshotSummary,
  EnvironmentSnapshotView,
  ProjectEnvironmentStatus,
  ToolRunStatus,
} from './environment-snapshot.types.js';

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/**
 * Environment snapshots uploaded by `tessera -get-environment` (ADR-0016).
 * The control plane never scans the customer network; it validates, redacts
 * and keeps the latest N snapshots per tenant.
 */
@Injectable()
export class EnvironmentSnapshotsService implements OnModuleInit {
  private readonly retained: number;

  constructor(
    private readonly mongo: MongoDatabase,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly projects: ProjectsService,
    config: ConfigService<Environment, true>,
  ) {
    this.retained = config.get('ENVIRONMENT_SNAPSHOTS_RETAINED', {
      infer: true,
    });
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({
        organizationId: 1,
        tenantId: 1,
        receivedAt: -1,
      }),
      this.collection.createIndex(
        { organizationId: 1, tenantId: 1, requestHash: 1 },
        { unique: true },
      ),
    ]);
  }

  async receive(
    principal: MachinePrincipal,
    tenantId: string,
    dto: EnvironmentSnapshotV1Dto,
    idempotencyKey: string | undefined,
  ): Promise<EnvironmentSnapshotReceipt> {
    assertIdempotencyKey(idempotencyKey);
    if (dto.tenantId !== tenantId) {
      throw new UnprocessableEntityException(
        'The snapshot tenantId does not match the route tenant',
      );
    }
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
    const runs = this.normalizeRuns(dto);
    const redacted = this.redact(runs);
    const payloadHash = this.sha256(
      canonicalJson(JSON.parse(JSON.stringify(redacted.runs)) as JsonValue),
    );
    const requestHash = this.sha256(idempotencyKey);
    const prior = await this.findPrior(
      organizationObjectId,
      tenantObjectId,
      requestHash,
      payloadHash,
    );
    if (prior) return prior;

    const document: EnvironmentSnapshotDocument = {
      _id: new ObjectId(),
      organizationId: organizationObjectId,
      tenantId: tenantObjectId,
      apiKeyId: objectId(principal.apiKeyId),
      requestHash,
      payloadHash,
      schemaVersion: ENVIRONMENT_SCHEMA_VERSION,
      collectionStartedAt: new Date(dto.startedAt),
      collectionCompletedAt: new Date(dto.completedAt),
      receivedAt: new Date(),
      runs: redacted.runs,
      toolStatus: this.toolStatus(redacted.runs),
      redactedValueCount: redacted.count,
    };
    try {
      await this.mongo.transaction(async (session) => {
        await this.collection.insertOne(document, { session });
        const snapshotId = document._id.toHexString();
        await this.audit.append(
          {
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            actorSubject: `machine:${principal.apiKeyId}`,
            action: 'environment-snapshot.received',
            targetType: 'environmentSnapshot',
            targetId: snapshotId,
            metadata: { redactedValueCount: String(redacted.count) },
          },
          session,
        );
        await this.outbox.append(
          'EnvironmentSnapshotReceived',
          organizationObjectId,
          tenantObjectId,
          snapshotId,
          { snapshotId },
          session,
        );
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
    await this.enforceRetention(organizationObjectId, tenantObjectId);
    return { snapshotId: document._id.toHexString(), duplicate: false };
  }

  /** The snapshot an analysis uses, or null when none was collected. */
  findLatest(
    organizationId: ObjectId,
    tenantId: ObjectId,
  ): Promise<EnvironmentSnapshotDocument | null> {
    return this.collection.findOne(
      { organizationId, tenantId },
      { sort: { receivedAt: -1 } },
    );
  }

  async status(
    organizationId: string,
    tenantId: string,
  ): Promise<ProjectEnvironmentStatus> {
    const latest = await this.findLatest(
      objectId(organizationId),
      objectId(tenantId),
    );
    if (!latest) {
      return {
        available: false,
        latest: null,
        ageHours: null,
        notice: ENVIRONMENT_MISSING_NOTICE,
      };
    }
    return {
      available: true,
      latest: this.toSummary(latest),
      ageHours: Math.floor(
        (Date.now() - latest.collectionCompletedAt.getTime()) / 3_600_000,
      ),
      notice: null,
    };
  }

  async get(
    organizationId: string,
    tenantId: string,
    snapshotId: string,
  ): Promise<EnvironmentSnapshotView> {
    const document = await this.collection.findOne({
      _id: objectId(snapshotId),
      organizationId: objectId(organizationId),
      tenantId: objectId(tenantId),
    });
    if (!document) throw new NotFoundException('Snapshot not found');
    return { ...this.toSummary(document), runs: document.runs };
  }

  toSummary(document: EnvironmentSnapshotDocument): EnvironmentSnapshotSummary {
    const { runs } = document;
    const ok = <T>(run: { status: string; result?: T }): T | null =>
      run.status === 'ok' && run.result ? run.result : null;
    return {
      id: document._id.toHexString(),
      tenantId: document.tenantId.toHexString(),
      collectionCompletedAt: document.collectionCompletedAt,
      receivedAt: document.receivedAt,
      toolStatus: document.toolStatus,
      counts: {
        openPorts:
          ok(runs.nmap)?.hosts.reduce(
            (sum, host) =>
              sum + host.ports.filter((port) => port.state === 'open').length,
            0,
          ) ?? 0,
        nucleiFindings: ok(runs.nuclei)?.findings.length ?? 0,
        vulnerabilities: ok(runs.trivy)?.vulnerabilities.length ?? 0,
        misconfigurations: ok(runs.trivy)?.misconfigurations.length ?? 0,
        secretFindings: ok(runs.trivy)?.secrets.length ?? 0,
        httpTargets: ok(runs.httpx)?.targets.length ?? 0,
      },
      redactedValueCount: document.redactedValueCount,
    };
  }

  /** Keeps only the fields valid for each run status, as plain JSON. */
  private normalizeRuns(dto: EnvironmentSnapshotV1Dto): EnvironmentRuns {
    const runs = {} as Record<EnvironmentTool, unknown>;
    for (const tool of ENVIRONMENT_TOOLS) {
      const run = dto[tool];
      if (run.tool !== tool) {
        throw new UnprocessableEntityException(
          `Run ${tool} reports tool ${run.tool}`,
        );
      }
      const base = {
        tool,
        startedAt: run.startedAt,
        durationMs: run.durationMs,
      };
      runs[tool] =
        run.status === 'ok'
          ? { ...base, status: 'ok', result: run.result }
          : run.status === 'failed'
            ? { ...base, status: 'failed', error: run.error }
            : { ...base, status: 'skipped', reason: run.reason };
    }
    const plain = JSON.parse(JSON.stringify(runs)) as EnvironmentRuns;
    if (plain.httpx.status === 'ok') {
      for (const target of plain.httpx.result.targets) {
        this.assertHeaders(target.headers);
      }
    }
    return plain;
  }

  private assertHeaders(headers: unknown): void {
    if (headers === undefined) return;
    const entries =
      headers && typeof headers === 'object' && !Array.isArray(headers)
        ? Object.entries(headers)
        : null;
    if (
      !entries ||
      entries.length > MAX_HTTP_HEADERS ||
      entries.some(
        ([name, value]) =>
          name.length > MAX_HEADER_NAME ||
          !HEADER_NAME.test(name) ||
          typeof value !== 'string' ||
          value.length > MAX_HEADER_VALUE,
      )
    ) {
      throw new UnprocessableEntityException(
        'httpx headers must be at most 100 string headers',
      );
    }
  }

  /** Redacts every string, keys included, before anything is stored. */
  private redact(runs: EnvironmentRuns): {
    runs: EnvironmentRuns;
    count: number;
  } {
    let count = 0;
    const visit = (value: unknown): unknown => {
      if (typeof value === 'string') {
        const result = redactSecrets(value);
        count += Object.values(result.counts).reduce(
          (sum, current) => sum + current,
          0,
        );
        return result.text;
      }
      if (Array.isArray(value)) return value.map(visit);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [
            visit(key) as string,
            visit(entry),
          ]),
        );
      }
      return value;
    };
    return { runs: visit(runs) as EnvironmentRuns, count };
  }

  private toolStatus(
    runs: EnvironmentRuns,
  ): Record<EnvironmentTool, ToolRunStatus> {
    return Object.fromEntries(
      ENVIRONMENT_TOOLS.map((tool) => [tool, runs[tool].status]),
    ) as Record<EnvironmentTool, ToolRunStatus>;
  }

  private async findPrior(
    organizationId: ObjectId,
    tenantId: ObjectId,
    requestHash: string,
    payloadHash: string,
  ): Promise<EnvironmentSnapshotReceipt | null> {
    const prior = await this.collection.findOne(
      { organizationId, tenantId, requestHash },
      { projection: { payloadHash: 1 } },
    );
    if (!prior) return null;
    if (prior.payloadHash !== payloadHash) {
      throw new ConflictException(
        'Idempotency-Key was reused with a different payload',
      );
    }
    return { snapshotId: prior._id.toHexString(), duplicate: true };
  }

  private async enforceRetention(
    organizationId: ObjectId,
    tenantId: ObjectId,
  ): Promise<void> {
    const stale = await this.collection
      .find(
        { organizationId, tenantId },
        { projection: { _id: 1 }, sort: { receivedAt: -1 } },
      )
      .skip(this.retained)
      .toArray();
    if (stale.length > 0) {
      await this.collection.deleteMany({
        _id: { $in: stale.map((document) => document._id) },
      });
    }
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private get collection() {
    return this.mongo.db.collection<EnvironmentSnapshotDocument>(
      'environmentSnapshots',
    );
  }
}
