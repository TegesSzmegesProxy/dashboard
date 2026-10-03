import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnyBulkWriteOperation, ClientSession, ObjectId } from 'mongodb';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import { Environment } from '../../config/environment.js';
import {
  MAX_TELEMETRY_ENDPOINT_ENTRIES,
  TelemetryBatchV1Dto,
  TelemetryEndpointV1Dto,
  TelemetryWindowV1Dto,
} from '../../contracts/telemetry/v1/telemetry.contract.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import type { MachinePrincipal } from '../api-keys/api-key.types.js';
import { BundlesService } from '../bundles/bundles.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import {
  TELEMETRY_BUCKET_COLLECTIONS,
  TELEMETRY_COUNTER_FIELDS,
  TELEMETRY_QUOTA_COLLECTION,
  TelemetryBatchReceiptDocument,
  TelemetryBucketDocument,
  TelemetryCounters,
  TelemetryGranularity,
  TelemetryQuotaDocument,
  TENANT_SCOPE,
  UNMATCHED_ENDPOINT,
} from './telemetry.types.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
export const MINUTE_BUCKET_RETENTION_MS = 48 * HOUR_MS;
export const HOUR_BUCKET_RETENTION_MS = 90 * 24 * HOUR_MS;
/** Proxies may buffer through an outage for this long. */
const MAX_WINDOW_AGE_MS = 24 * HOUR_MS;
const MAX_CLOCK_SKEW_MS = 2 * MINUTE_MS;

class TelemetryQuotaExceeded extends Error {
  constructor(readonly tenantId: ObjectId) {
    super('Telemetry quota exceeded');
  }
}

interface BucketIncrement {
  tenantId: ObjectId;
  windowStart: Date;
  endpoint: string;
  counters: TelemetryCounters;
}

/**
 * Best-effort intake of redacted proxy counters. It shares nothing with
 * bundle distribution: failures here only lose telemetry. Batches are
 * idempotent per credential and batch id, and every batch is checked against
 * the tenant's hourly quota before anything is stored.
 */
@Injectable()
export class TelemetryIngestionService implements OnModuleInit {
  private readonly quotaPerTenantHour: number;

  constructor(
    private readonly mongo: MongoDatabase,
    private readonly projects: ProjectsService,
    private readonly bundles: BundlesService,
    config: ConfigService<Environment, true>,
  ) {
    this.quotaPerTenantHour = config.get(
      'TELEMETRY_QUOTA_ENTRIES_PER_TENANT_HOUR',
      { infer: true },
    );
  }

  async onModuleInit(): Promise<void> {
    const bucketIndexes = (granularity: TelemetryGranularity) => {
      const collection = this.bucketCollection(granularity);
      return [
        collection.createIndex(
          { organizationId: 1, tenantId: 1, windowStart: 1, endpoint: 1 },
          { unique: true },
        ),
        collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      ];
    };
    await Promise.all([
      ...bucketIndexes('minute'),
      ...bucketIndexes('hour'),
      this.receipts.createIndex({ apiKeyId: 1, batchId: 1 }, { unique: true }),
      this.receipts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.quotas.createIndex(
        { organizationId: 1, tenantId: 1, hourStart: 1 },
        { unique: true },
      ),
      this.quotas.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
  }

  async record(
    principal: MachinePrincipal,
    dto: TelemetryBatchV1Dto,
  ): Promise<void> {
    const organizationId = objectId(principal.organizationId);
    const apiKeyId = objectId(principal.apiKeyId);
    const tenantIds = [
      ...new Set(dto.windows.map((window) => window.tenantId)),
    ];
    if (
      !tenantIds.every((tenantId) =>
        principal.allowedTenantIds.includes(tenantId),
      ) ||
      !(await this.projects.allBelongToOrganization(
        principal.organizationId,
        tenantIds,
      ))
    ) {
      throw new ForbiddenException('Machine credential tenant access denied');
    }
    const entryCount = dto.windows.reduce(
      (sum, window) => sum + window.endpoints.length,
      0,
    );
    if (entryCount > MAX_TELEMETRY_ENDPOINT_ENTRIES) {
      throw new UnprocessableEntityException(
        `A batch may contain at most ${MAX_TELEMETRY_ENDPOINT_ENTRIES} endpoint entries`,
      );
    }
    const now = Date.now();
    for (const [index, window] of dto.windows.entries()) {
      await this.validateWindow(organizationId, window, index, now);
    }

    const minute = this.aggregate(dto.windows, MINUTE_MS);
    const hour = this.aggregate(dto.windows, HOUR_MS);
    const quotaEntries = new Map<string, number>();
    for (const window of dto.windows) {
      // The tenant-scope bucket counts as one entry per window.
      quotaEntries.set(
        window.tenantId,
        (quotaEntries.get(window.tenantId) ?? 0) + window.endpoints.length + 1,
      );
    }

    const apply = () =>
      this.mongo.transaction(async (session) => {
        const receipt = await this.receipts.findOne(
          { apiKeyId, batchId: dto.batchId },
          { session, projection: { _id: 1 } },
        );
        if (receipt) return;
        await this.receipts.insertOne(
          {
            _id: new ObjectId(),
            apiKeyId,
            batchId: dto.batchId,
            receivedAt: new Date(now),
            expiresAt: new Date(now + MINUTE_BUCKET_RETENTION_MS),
          },
          { session },
        );
        const hourStart = new Date(Math.floor(now / HOUR_MS) * HOUR_MS);
        for (const [tenantId, entries] of quotaEntries) {
          await this.consumeQuota(
            organizationId,
            new ObjectId(tenantId),
            hourStart,
            entries,
            session,
          );
        }
        await this.write('minute', organizationId, minute, session);
        await this.write('hour', organizationId, hour, session);
      });

    try {
      try {
        await apply();
      } catch (error) {
        // Concurrent first writes race on upserts; the retry updates.
        if (!isDuplicateKey(error)) throw error;
        await apply();
      }
    } catch (error) {
      if (!(error instanceof TelemetryQuotaExceeded)) throw error;
      await this.recordRejectedBatch(organizationId, error.tenantId, now);
      throw new HttpException(
        'Telemetry quota exceeded for this hour; drop or retry later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async validateWindow(
    organizationId: ObjectId,
    window: TelemetryWindowV1Dto,
    index: number,
    now: number,
  ): Promise<void> {
    const reject = (reason: string): never => {
      throw new UnprocessableEntityException(`windows.${index}: ${reason}`);
    };
    const start = Date.parse(window.windowStart);
    if (start % MINUTE_MS !== 0) {
      reject('windowStart must be aligned to a UTC minute');
    }
    if (start < now - MAX_WINDOW_AGE_MS) {
      reject('window is older than 24 hours; drop it');
    }
    if (start > now + MAX_CLOCK_SKEW_MS) reject('window starts in the future');

    const allowed = window.bundleVersion
      ? await this.bundles.findPolicyEndpoints(
          organizationId,
          objectId(window.tenantId),
          window.bundleVersion,
        )
      : new Set<string>();
    if (!allowed) reject('bundleVersion is not a bundle of this tenant');
    const seen = new Set<string | null>();
    for (const [entryIndex, entry] of window.endpoints.entries()) {
      const at = `endpoints.${entryIndex}`;
      if (seen.has(entry.endpoint)) reject(`${at}: duplicate endpoint`);
      seen.add(entry.endpoint);
      // Only policy endpoint keys are stored; raw request paths never are.
      if (entry.endpoint !== null && !allowed!.has(entry.endpoint)) {
        reject(`${at}: endpoint is not in the loaded bundle's policy`);
      }
      this.validateCounts(entry, at, reject);
    }
  }

  private validateCounts(
    entry: TelemetryEndpointV1Dto,
    at: string,
    reject: (reason: string) => never,
  ): void {
    const requests = entry.decisions.allow + entry.decisions.block;
    const { safe, suspicious, policyViolation, error } = entry.staticVerdicts;
    const { sampledSafe, attack, benign, unavailable } = entry.jev;
    if (safe + suspicious + policyViolation + error > requests) {
      reject(`${at}: static verdicts exceed decisions`);
    }
    if (sampledSafe > safe) reject(`${at}: sampledSafe exceeds safe`);
    if (attack + benign + unavailable > requests) {
      reject(`${at}: JEV results exceed decisions`);
    }
    if (entry.failureBehaviorApplied > requests) {
      reject(`${at}: failureBehaviorApplied exceeds decisions`);
    }
  }

  private aggregate(
    windows: TelemetryWindowV1Dto[],
    granularityMs: number,
  ): BucketIncrement[] {
    const buckets = new Map<string, BucketIncrement>();
    const add = (
      tenantId: string,
      windowStart: Date,
      endpoint: string,
      counters: Partial<TelemetryCounters>,
    ): void => {
      const key = `${tenantId}|${windowStart.getTime()}|${endpoint}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          tenantId: new ObjectId(tenantId),
          windowStart,
          endpoint,
          counters: this.zeroCounters(),
        };
        buckets.set(key, bucket);
      }
      for (const field of TELEMETRY_COUNTER_FIELDS) {
        bucket.counters[field] += counters[field] ?? 0;
      }
    };
    for (const window of windows) {
      const start = Date.parse(window.windowStart);
      const windowStart = new Date(
        Math.floor(start / granularityMs) * granularityMs,
      );
      add(window.tenantId, windowStart, TENANT_SCOPE, {
        bundleVerificationFailures: window.events.bundleVerificationFailures,
        bundlePullFailures: window.events.bundlePullFailures,
        droppedWindows: window.events.droppedWindows,
        ...this.gauge('attackRateEwma', window.attackRateEwma),
      });
      for (const entry of window.endpoints) {
        add(
          window.tenantId,
          windowStart,
          entry.endpoint ?? UNMATCHED_ENDPOINT,
          {
            requests: entry.decisions.allow + entry.decisions.block,
            allow: entry.decisions.allow,
            block: entry.decisions.block,
            safe: entry.staticVerdicts.safe,
            suspicious: entry.staticVerdicts.suspicious,
            policyViolation: entry.staticVerdicts.policyViolation,
            error: entry.staticVerdicts.error,
            sampledSafe: entry.jev.sampledSafe,
            jevAttack: entry.jev.attack,
            jevBenign: entry.jev.benign,
            jevUnavailable: entry.jev.unavailable,
            failureBehaviorApplied: entry.failureBehaviorApplied,
            ...this.gauge('samplingRate', entry.samplingRate),
            ...this.gauge('attackRateEwma', entry.attackRateEwma),
          },
        );
      }
    }
    return [...buckets.values()];
  }

  private gauge(
    name: 'samplingRate' | 'attackRateEwma',
    value: number | null | undefined,
  ): Partial<TelemetryCounters> {
    if (value === null || value === undefined) return {};
    return { [`${name}Sum`]: value, [`${name}Count`]: 1 };
  }

  private async consumeQuota(
    organizationId: ObjectId,
    tenantId: ObjectId,
    hourStart: Date,
    entries: number,
    session: ClientSession,
  ): Promise<void> {
    if (entries > this.quotaPerTenantHour) {
      throw new TelemetryQuotaExceeded(tenantId);
    }
    const key = { organizationId, tenantId, hourStart };
    const updated = await this.quotas.updateOne(
      { ...key, entries: { $lte: this.quotaPerTenantHour - entries } },
      { $inc: { entries } },
      { session },
    );
    if (updated.matchedCount === 1) return;
    const existing = await this.quotas.findOne(key, {
      session,
      projection: { _id: 1 },
    });
    if (existing) throw new TelemetryQuotaExceeded(tenantId);
    await this.quotas.insertOne(
      {
        _id: new ObjectId(),
        ...key,
        entries,
        rejectedBatches: 0,
        expiresAt: new Date(hourStart.getTime() + 2 * HOUR_MS),
      },
      { session },
    );
  }

  private async recordRejectedBatch(
    organizationId: ObjectId,
    tenantId: ObjectId,
    now: number,
  ): Promise<void> {
    const hourStart = new Date(Math.floor(now / HOUR_MS) * HOUR_MS);
    try {
      await this.quotas.updateOne(
        { organizationId, tenantId, hourStart },
        {
          $inc: { rejectedBatches: 1 },
          $setOnInsert: {
            entries: 0,
            expiresAt: new Date(hourStart.getTime() + 2 * HOUR_MS),
          },
        },
        { upsert: true },
      );
    } catch {
      // Best-effort bookkeeping for the quota alert.
    }
  }

  private async write(
    granularity: TelemetryGranularity,
    organizationId: ObjectId,
    increments: BucketIncrement[],
    session: ClientSession,
  ): Promise<void> {
    const retention =
      granularity === 'minute'
        ? MINUTE_BUCKET_RETENTION_MS
        : HOUR_BUCKET_RETENTION_MS;
    const now = new Date();
    const operations: AnyBulkWriteOperation<TelemetryBucketDocument>[] =
      increments.map((increment) => ({
        updateOne: {
          filter: {
            organizationId,
            tenantId: increment.tenantId,
            windowStart: increment.windowStart,
            endpoint: increment.endpoint,
          },
          update: {
            $inc: Object.fromEntries(
              TELEMETRY_COUNTER_FIELDS.map((field) => [
                `counters.${field}`,
                increment.counters[field],
              ]),
            ),
            $set: {
              updatedAt: now,
              expiresAt: new Date(increment.windowStart.getTime() + retention),
            },
          },
          upsert: true,
        },
      }));
    if (operations.length > 0) {
      await this.bucketCollection(granularity).bulkWrite(operations, {
        session,
        ordered: false,
      });
    }
  }

  private zeroCounters(): TelemetryCounters {
    return Object.fromEntries(
      TELEMETRY_COUNTER_FIELDS.map((field) => [field, 0]),
    ) as unknown as TelemetryCounters;
  }

  private bucketCollection(granularity: TelemetryGranularity) {
    return this.mongo.db.collection<TelemetryBucketDocument>(
      TELEMETRY_BUCKET_COLLECTIONS[granularity],
    );
  }

  private get receipts() {
    return this.mongo.db.collection<TelemetryBatchReceiptDocument>(
      'telemetryBatchReceipts',
    );
  }

  private get quotas() {
    return this.mongo.db.collection<TelemetryQuotaDocument>(
      TELEMETRY_QUOTA_COLLECTION,
    );
  }
}
