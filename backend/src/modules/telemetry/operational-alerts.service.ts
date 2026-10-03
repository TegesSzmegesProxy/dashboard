import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import type { AlertSettingsDto } from './telemetry.dto.js';
import {
  AlertSettingsDocument,
  AlertSettingsView,
  OperationalAlertDetails,
  OperationalAlertDocument,
  OperationalAlertSeverity,
  OperationalAlertStatus,
  OperationalAlertType,
  OperationalAlertView,
} from './operational-alert.types.js';
import { ProxyHeartbeatsService } from './proxy-heartbeats.service.js';
import { TelemetryQueryService } from './telemetry-query.service.js';
import {
  TELEMETRY_QUOTA_COLLECTION,
  TelemetryQuotaDocument,
} from './telemetry.types.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** Telemetry events count towards an alert for this long. */
const EVENT_WINDOW_MS = 15 * MINUTE_MS;
const RESOLVED_RETENTION_MS = 90 * 24 * HOUR_MS;
const MAX_LISTED_ALERTS = 200;

interface DesiredAlert {
  type: OperationalAlertType;
  subject: string;
  severity: OperationalAlertSeverity;
  details: OperationalAlertDetails;
}

@Injectable()
export class OperationalAlertsService implements OnModuleInit {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly projects: ProjectsService,
    private readonly heartbeats: ProxyHeartbeatsService,
    private readonly telemetry: TelemetryQueryService,
  ) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.alerts.createIndex(
        { organizationId: 1, tenantId: 1, type: 1, subject: 1 },
        { unique: true, partialFilterExpression: { status: 'open' } },
      ),
      this.alerts.createIndex({
        organizationId: 1,
        tenantId: 1,
        status: 1,
        openedAt: -1,
      }),
      this.alerts.createIndex({ status: 1 }),
      this.alerts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.settings.createIndex(
        { organizationId: 1, tenantId: 1 },
        { unique: true },
      ),
    ]);
  }

  async list(
    organizationId: string,
    tenantId: string,
    status: OperationalAlertStatus,
  ): Promise<OperationalAlertView[]> {
    const documents = await this.alerts
      .find({
        organizationId: objectId(organizationId),
        tenantId: objectId(tenantId),
        status,
      })
      .sort({ openedAt: -1 })
      .limit(MAX_LISTED_ALERTS)
      .toArray();
    return documents.map((document) => this.toView(document));
  }

  async countOpen(
    organizationId: ObjectId,
    tenantId: ObjectId,
  ): Promise<Record<OperationalAlertSeverity, number>> {
    const groups = await this.alerts
      .aggregate<{ _id: OperationalAlertSeverity; count: number }>([
        { $match: { organizationId, tenantId, status: 'open' } },
        { $group: { _id: '$severity', count: { $sum: 1 } } },
      ])
      .toArray();
    const counts = { info: 0, warning: 0, critical: 0 };
    for (const group of groups) counts[group._id] = group.count;
    return counts;
  }

  async acknowledge(
    organizationId: string,
    tenantId: string,
    alertId: string,
    actorSubject: string,
  ): Promise<OperationalAlertView> {
    const organizationObjectId = objectId(organizationId);
    const tenantObjectId = objectId(tenantId);
    const alertObjectId = objectId(alertId);
    return this.mongo.transaction(async (session) => {
      const alert = await this.alerts.findOne(
        {
          _id: alertObjectId,
          organizationId: organizationObjectId,
          tenantId: tenantObjectId,
        },
        { session },
      );
      if (!alert) throw new NotFoundException('Alert not found');
      if (alert.status !== 'open') {
        throw new ConflictException('Only open alerts can be acknowledged');
      }
      if (alert.acknowledgedAt) return this.toView(alert);
      const updated = await this.alerts.findOneAndUpdate(
        { _id: alert._id, status: 'open' },
        {
          $set: { acknowledgedAt: new Date(), acknowledgedBy: actorSubject },
        },
        { session, returnDocument: 'after' },
      );
      if (!updated) throw new ConflictException('Alert state changed');
      await this.audit.append(
        {
          organizationId: organizationObjectId,
          tenantId: tenantObjectId,
          actorSubject,
          action: 'operational-alert.acknowledged',
          targetType: 'operationalAlert',
          targetId: alert._id.toHexString(),
          metadata: { type: alert.type },
        },
        session,
      );
      return this.toView(updated);
    });
  }

  async getSettings(
    organizationId: string,
    tenantId: string,
  ): Promise<AlertSettingsView> {
    const organizationObjectId = objectId(organizationId);
    const tenantObjectId = objectId(tenantId);
    await this.assertTenant(organizationObjectId, tenantObjectId);
    const document = await this.settings.findOne({
      organizationId: organizationObjectId,
      tenantId: tenantObjectId,
    });
    return this.toSettingsView(tenantObjectId, document);
  }

  async updateSettings(
    organizationId: string,
    tenantId: string,
    dto: AlertSettingsDto,
    actorSubject: string,
  ): Promise<AlertSettingsView> {
    if (
      (dto.attackRateThreshold === null) !==
      (dto.attackRateMinClassified === null)
    ) {
      throw new BadRequestException(
        'attackRateThreshold and attackRateMinClassified are set or cleared together',
      );
    }
    const organizationObjectId = objectId(organizationId);
    const tenantObjectId = objectId(tenantId);
    return this.mongo.transaction(async (session) => {
      await this.projects.assertBelongToOrganization(
        organizationId,
        [tenantId],
        session,
      );
      const now = new Date();
      const document = await this.settings.findOneAndUpdate(
        { organizationId: organizationObjectId, tenantId: tenantObjectId },
        {
          $set: {
            attackRateThreshold: dto.attackRateThreshold,
            attackRateMinClassified: dto.attackRateMinClassified,
            updatedBy: actorSubject,
            updatedAt: now,
          },
          $setOnInsert: { _id: new ObjectId() },
        },
        { upsert: true, returnDocument: 'after', session },
      );
      await this.audit.append(
        {
          organizationId: organizationObjectId,
          tenantId: tenantObjectId,
          actorSubject,
          action: 'alert-settings.updated',
          targetType: 'alertSettings',
          targetId: tenantObjectId.toHexString(),
          metadata: {
            attackRateThreshold: String(dto.attackRateThreshold),
            attackRateMinClassified: String(dto.attackRateMinClassified),
          },
        },
        session,
      );
      return this.toSettingsView(tenantObjectId, document);
    });
  }

  /** Tenants that may need alert state changes. */
  async tenantsToEvaluate(): Promise<
    { organizationId: ObjectId; tenantId: ObjectId }[]
  > {
    const since = new Date(Date.now() - HOUR_MS);
    const pairs = async (
      collection: string,
      match: Record<string, unknown>,
    ): Promise<{ organizationId: ObjectId; tenantId: ObjectId }[]> => {
      const groups = await this.mongo.db
        .collection(collection)
        .aggregate<{
          _id: { organizationId: ObjectId; tenantId: ObjectId };
        }>([
          { $match: match },
          {
            $group: {
              _id: { organizationId: '$organizationId', tenantId: '$tenantId' },
            },
          },
        ])
        .toArray();
      return groups.map((group) => group._id);
    };
    const all = (
      await Promise.all([
        pairs('proxyHeartbeats', {}),
        pairs('operationalAlerts', { status: 'open' }),
        pairs('telemetryMinuteBuckets', { updatedAt: { $gte: since } }),
        pairs(TELEMETRY_QUOTA_COLLECTION, { rejectedBatches: { $gt: 0 } }),
      ])
    ).flat();
    const unique = new Map<
      string,
      { organizationId: ObjectId; tenantId: ObjectId }
    >();
    for (const pair of all) {
      unique.set(
        `${pair.organizationId.toHexString()}:${pair.tenantId.toHexString()}`,
        pair,
      );
    }
    return [...unique.values()];
  }

  /** Reconciles one tenant's open alerts with its current state. */
  async evaluateTenant(
    organizationId: ObjectId,
    tenantId: ObjectId,
  ): Promise<void> {
    const tenantExists = await this.projects.findRuntimeConfiguration(
      organizationId,
      tenantId,
    );
    // A deleted tenant keeps no open alerts.
    const desired = tenantExists
      ? await this.desiredAlerts(organizationId, tenantId)
      : [];
    const open = await this.alerts
      .find({ organizationId, tenantId, status: 'open' })
      .toArray();
    const key = (type: string, subject: string) => `${type}|${subject}`;
    const openByKey = new Map(
      open.map((alert) => [key(alert.type, alert.subject), alert]),
    );
    const now = new Date();
    for (const alert of desired) {
      const existing = openByKey.get(key(alert.type, alert.subject));
      openByKey.delete(key(alert.type, alert.subject));
      if (existing) {
        await this.alerts.updateOne(
          { _id: existing._id, status: 'open' },
          {
            $set: {
              severity: alert.severity,
              details: alert.details,
              lastObservedAt: now,
            },
          },
        );
        continue;
      }
      await this.open(organizationId, tenantId, alert, now);
    }
    for (const stale of openByKey.values()) {
      await this.resolve(stale, now);
    }
  }

  private async desiredAlerts(
    organizationId: ObjectId,
    tenantId: ObjectId,
  ): Promise<DesiredAlert[]> {
    const desired: DesiredAlert[] = [];
    const instances = await this.heartbeats.instanceStates(
      organizationId,
      tenantId,
    );
    for (const instance of instances) {
      const subject = instance.instanceId;
      if (instance.stale) {
        desired.push({
          type: 'proxy_stale',
          subject,
          severity: 'warning',
          details: { lastSeenAt: instance.lastSeenAt.toISOString() },
        });
      }
      if (instance.bundleSource === 'none') {
        desired.push({
          type: 'proxy_degraded',
          subject,
          severity: 'critical',
          details: { reason: 'no_bundle' },
        });
      } else if (instance.bundleSource === 'last_known_good') {
        desired.push({
          type: 'proxy_degraded',
          subject,
          severity: 'warning',
          details: { reason: 'running_last_known_good' },
        });
      } else if (instance.health === 'degraded') {
        desired.push({
          type: 'proxy_degraded',
          subject,
          severity: 'warning',
          details: { reason: 'health_degraded' },
        });
      }
      if (instance.bundleState === 'incompatible') {
        desired.push({
          type: 'proxy_incompatible',
          subject,
          severity: 'critical',
          details: {
            proxyVersion: instance.proxyVersion,
            activeBundleVersion: instance.activeBundleVersion ?? '',
          },
        });
      }
    }

    const now = Date.now();
    const recent = await this.telemetry.recentTotals(
      organizationId,
      tenantId,
      new Date(now - EVENT_WINDOW_MS),
    );
    if (recent.events.bundleVerificationFailures > 0) {
      desired.push({
        type: 'bundle_verification_failures',
        subject: '',
        severity: 'critical',
        details: {
          failures: recent.events.bundleVerificationFailures,
          windowMinutes: EVENT_WINDOW_MS / MINUTE_MS,
        },
      });
    }
    if (recent.totals.jev.unavailable > 0) {
      desired.push({
        type: 'jev_unavailable',
        subject: '',
        severity: 'warning',
        details: {
          requests: recent.totals.jev.unavailable,
          windowMinutes: EVENT_WINDOW_MS / MINUTE_MS,
        },
      });
    }

    const hourStart = new Date(Math.floor(now / HOUR_MS) * HOUR_MS);
    const quota = await this.quotas.findOne({
      organizationId,
      tenantId,
      hourStart,
    });
    if (quota && quota.rejectedBatches > 0) {
      desired.push({
        type: 'telemetry_quota_exceeded',
        subject: '',
        severity: 'warning',
        details: { rejectedBatches: quota.rejectedBatches },
      });
    }

    const settings = await this.settings.findOne({ organizationId, tenantId });
    if (
      settings?.attackRateThreshold !== null &&
      settings?.attackRateThreshold !== undefined &&
      settings.attackRateMinClassified !== null
    ) {
      const lastHour = await this.telemetry.recentTotals(
        organizationId,
        tenantId,
        new Date(now - HOUR_MS),
      );
      const classified =
        lastHour.totals.jev.attack + lastHour.totals.jev.benign;
      const rate = lastHour.totals.attackRate;
      if (
        rate !== null &&
        classified >= settings.attackRateMinClassified &&
        rate > settings.attackRateThreshold
      ) {
        desired.push({
          type: 'attack_rate_high',
          subject: '',
          severity: 'warning',
          details: {
            attackRate: rate,
            threshold: settings.attackRateThreshold,
            classified,
          },
        });
      }
    }
    return desired;
  }

  private async open(
    organizationId: ObjectId,
    tenantId: ObjectId,
    alert: DesiredAlert,
    now: Date,
  ): Promise<void> {
    try {
      await this.mongo.transaction(async (session) => {
        const document: OperationalAlertDocument = {
          _id: new ObjectId(),
          organizationId,
          tenantId,
          type: alert.type,
          subject: alert.subject,
          severity: alert.severity,
          status: 'open',
          details: alert.details,
          openedAt: now,
          lastObservedAt: now,
          resolvedAt: null,
          acknowledgedAt: null,
          acknowledgedBy: null,
          expiresAt: null,
        };
        await this.alerts.insertOne(document, { session });
        await this.outbox.append(
          'OperationalAlertOpened',
          organizationId,
          tenantId,
          document._id.toHexString(),
          {
            alertId: document._id.toHexString(),
            type: alert.type,
            severity: alert.severity,
            ...(alert.subject ? { subject: alert.subject } : {}),
          },
          session,
        );
      });
    } catch (error) {
      // Another instance opened the same alert concurrently.
      if (!isDuplicateKey(error)) throw error;
    }
  }

  private async resolve(
    alert: OperationalAlertDocument,
    now: Date,
  ): Promise<void> {
    await this.mongo.transaction(async (session) => {
      const updated = await this.alerts.updateOne(
        { _id: alert._id, status: 'open' },
        {
          $set: {
            status: 'resolved',
            resolvedAt: now,
            expiresAt: new Date(now.getTime() + RESOLVED_RETENTION_MS),
          },
        },
        { session },
      );
      if (updated.modifiedCount === 0) return;
      await this.outbox.append(
        'OperationalAlertResolved',
        alert.organizationId,
        alert.tenantId,
        alert._id.toHexString(),
        { alertId: alert._id.toHexString(), type: alert.type },
        session,
      );
    });
  }

  private async assertTenant(
    organizationId: ObjectId,
    tenantId: ObjectId,
  ): Promise<void> {
    const tenant = await this.projects.findRuntimeConfiguration(
      organizationId,
      tenantId,
    );
    if (!tenant) throw new NotFoundException('Tenant not found');
  }

  private toView(document: OperationalAlertDocument): OperationalAlertView {
    return {
      id: document._id.toHexString(),
      organizationId: document.organizationId.toHexString(),
      tenantId: document.tenantId.toHexString(),
      type: document.type,
      subject: document.subject || null,
      severity: document.severity,
      status: document.status,
      details: document.details,
      openedAt: document.openedAt,
      lastObservedAt: document.lastObservedAt,
      resolvedAt: document.resolvedAt,
      acknowledgedAt: document.acknowledgedAt,
      acknowledgedBy: document.acknowledgedBy,
    };
  }

  private toSettingsView(
    tenantId: ObjectId,
    document: AlertSettingsDocument | null,
  ): AlertSettingsView {
    return {
      tenantId: tenantId.toHexString(),
      attackRateThreshold: document?.attackRateThreshold ?? null,
      attackRateMinClassified: document?.attackRateMinClassified ?? null,
      updatedBy: document?.updatedBy ?? null,
      updatedAt: document?.updatedAt ?? null,
    };
  }

  private get alerts() {
    return this.mongo.db.collection<OperationalAlertDocument>(
      'operationalAlerts',
    );
  }

  private get settings() {
    return this.mongo.db.collection<AlertSettingsDocument>('alertSettings');
  }

  private get quotas() {
    return this.mongo.db.collection<TelemetryQuotaDocument>(
      TELEMETRY_QUOTA_COLLECTION,
    );
  }
}
