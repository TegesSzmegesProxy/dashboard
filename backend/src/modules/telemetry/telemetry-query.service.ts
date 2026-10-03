import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Document, ObjectId } from 'mongodb';
import { objectId } from '../../common/mongodb.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import type { TelemetryQueryDto } from './telemetry.dto.js';
import {
  TELEMETRY_BUCKET_COLLECTIONS,
  TELEMETRY_COUNTER_FIELDS,
  TelemetryBucketDocument,
  TelemetryCounters,
  TelemetryEndpointSummaryView,
  TelemetryGranularity,
  TelemetrySeriesPointView,
  TelemetrySummaryView,
  TelemetryTotalsView,
  TENANT_SCOPE,
  UNMATCHED_ENDPOINT,
} from './telemetry.types.js';

const HOUR_MS = 60 * 60_000;
const DEFAULT_SPAN_MS: Record<TelemetryGranularity, number> = {
  minute: HOUR_MS,
  hour: 24 * HOUR_MS,
};
const MAX_SPAN_MS: Record<TelemetryGranularity, number> = {
  minute: 48 * HOUR_MS,
  hour: 90 * 24 * HOUR_MS,
};
const TOP_ENDPOINTS = 50;

type GroupedCounters = TelemetryCounters & {
  _id: unknown;
  tenantAttackRateEwmaSum: number;
  tenantAttackRateEwmaCount: number;
};

/** Read models over aggregated telemetry. Telemetry is display state only. */
@Injectable()
export class TelemetryQueryService {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly projects: ProjectsService,
  ) {}

  async summary(
    organizationId: string,
    tenantId: string,
    query: TelemetryQueryDto,
  ): Promise<TelemetrySummaryView> {
    const organizationObjectId = objectId(organizationId);
    const tenantObjectId = objectId(tenantId);
    const tenant = await this.projects.findRuntimeConfiguration(
      organizationObjectId,
      tenantObjectId,
    );
    if (!tenant) throw new NotFoundException('Tenant not found');
    const granularity = query.granularity;
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - DEFAULT_SPAN_MS[granularity]);
    if (from >= to) throw new BadRequestException('from must precede to');
    if (to.getTime() - from.getTime() > MAX_SPAN_MS[granularity]) {
      throw new BadRequestException(
        `A ${granularity} summary may span at most ${MAX_SPAN_MS[granularity] / HOUR_MS} hours`,
      );
    }
    const match = {
      organizationId: organizationObjectId,
      tenantId: tenantObjectId,
      windowStart: { $gte: from, $lt: to },
    };
    const collection = this.collection(granularity);
    const [seriesGroups, endpointGroups] = await Promise.all([
      collection
        .aggregate<GroupedCounters>([
          { $match: match },
          { $group: this.groupStage('$windowStart') },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
      collection
        .aggregate<GroupedCounters>([
          { $match: { ...match, endpoint: { $ne: TENANT_SCOPE } } },
          { $group: this.groupStage('$endpoint') },
          { $sort: { requests: -1, _id: 1 } },
          { $limit: TOP_ENDPOINTS },
        ])
        .toArray(),
    ]);

    const series: TelemetrySeriesPointView[] = seriesGroups.map((group) => ({
      windowStart: group._id as Date,
      ...this.totals(group, 'tenant'),
      events: this.events(group),
    }));
    const overall = this.sum(seriesGroups);
    return {
      tenantId: tenantObjectId.toHexString(),
      granularity,
      from,
      to,
      totals: this.totals(overall, 'tenant'),
      events: this.events(overall),
      series,
      endpoints: endpointGroups.map((group): TelemetryEndpointSummaryView => ({
        endpoint: group._id === UNMATCHED_ENDPOINT ? null : String(group._id),
        ...this.totals(group, 'endpoint'),
      })),
    };
  }

  /** Latest minute that received telemetry, for operations views. */
  async lastReceivedAt(
    organizationId: ObjectId,
    tenantId: ObjectId,
  ): Promise<Date | null> {
    const latest = await this.collection('minute').findOne(
      { organizationId, tenantId },
      { sort: { windowStart: -1 }, projection: { updatedAt: 1 } },
    );
    return latest?.updatedAt ?? null;
  }

  /** Totals for a recent period; used by alerts and the overview. */
  async recentTotals(
    organizationId: ObjectId,
    tenantId: ObjectId,
    since: Date,
  ): Promise<{
    totals: TelemetryTotalsView;
    events: TelemetrySeriesPointView['events'];
  }> {
    const [group] = await this.collection('minute')
      .aggregate<GroupedCounters>([
        {
          $match: { organizationId, tenantId, windowStart: { $gte: since } },
        },
        { $group: this.groupStage(null) },
      ])
      .toArray();
    const counters = group ?? this.sum([]);
    return {
      totals: this.totals(counters, 'tenant'),
      events: this.events(counters),
    };
  }

  private groupStage(id: string | null): Document {
    const stage: Document = { _id: id };
    for (const field of TELEMETRY_COUNTER_FIELDS) {
      stage[field] = { $sum: `$counters.${field}` };
    }
    // The tenant EWMA lives only in the tenant-scope bucket.
    for (const field of ['attackRateEwmaSum', 'attackRateEwmaCount']) {
      stage[`tenant${field[0].toUpperCase()}${field.slice(1)}`] = {
        $sum: {
          $cond: [
            { $eq: ['$endpoint', { $literal: TENANT_SCOPE }] },
            `$counters.${field}`,
            0,
          ],
        },
      };
    }
    return stage;
  }

  private sum(groups: GroupedCounters[]): GroupedCounters {
    const total = {
      _id: null,
      tenantAttackRateEwmaSum: 0,
      tenantAttackRateEwmaCount: 0,
    } as GroupedCounters;
    for (const field of TELEMETRY_COUNTER_FIELDS) total[field] = 0;
    for (const group of groups) {
      for (const field of TELEMETRY_COUNTER_FIELDS) {
        total[field] += group[field];
      }
      total.tenantAttackRateEwmaSum += group.tenantAttackRateEwmaSum;
      total.tenantAttackRateEwmaCount += group.tenantAttackRateEwmaCount;
    }
    return total;
  }

  private totals(
    counters: GroupedCounters,
    ewmaScope: 'tenant' | 'endpoint',
  ): TelemetryTotalsView {
    const ratio = (numerator: number, denominator: number) =>
      denominator > 0 ? numerator / denominator : null;
    const ewma =
      ewmaScope === 'tenant'
        ? ratio(
            counters.tenantAttackRateEwmaSum,
            counters.tenantAttackRateEwmaCount,
          )
        : ratio(counters.attackRateEwmaSum, counters.attackRateEwmaCount);
    return {
      requests: counters.requests,
      decisions: { allow: counters.allow, block: counters.block },
      staticVerdicts: {
        safe: counters.safe,
        suspicious: counters.suspicious,
        policyViolation: counters.policyViolation,
        error: counters.error,
      },
      jev: {
        sampledSafe: counters.sampledSafe,
        attack: counters.jevAttack,
        benign: counters.jevBenign,
        unavailable: counters.jevUnavailable,
      },
      failureBehaviorApplied: counters.failureBehaviorApplied,
      attackRate: ratio(
        counters.jevAttack,
        counters.jevAttack + counters.jevBenign,
      ),
      observedSamplingRate: ratio(counters.sampledSafe, counters.safe),
      reportedSamplingRate: ratio(
        counters.samplingRateSum,
        counters.samplingRateCount,
      ),
      attackRateEwma: ewma,
    };
  }

  private events(
    counters: GroupedCounters,
  ): TelemetrySeriesPointView['events'] {
    return {
      bundleVerificationFailures: counters.bundleVerificationFailures,
      bundlePullFailures: counters.bundlePullFailures,
      droppedWindows: counters.droppedWindows,
    };
  }

  private collection(granularity: TelemetryGranularity) {
    return this.mongo.db.collection<TelemetryBucketDocument>(
      TELEMETRY_BUCKET_COLLECTIONS[granularity],
    );
  }
}
