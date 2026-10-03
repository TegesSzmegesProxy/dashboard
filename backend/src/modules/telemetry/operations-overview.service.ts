import { Injectable, NotFoundException } from '@nestjs/common';
import { objectId } from '../../common/mongodb.js';
import type { ActiveBundleSummary } from '../bundles/bundle.types.js';
import { BundlesService } from '../bundles/bundles.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import type { OperationalAlertSeverity } from './operational-alert.types.js';
import { OperationalAlertsService } from './operational-alerts.service.js';
import { ProxyHeartbeatsService } from './proxy-heartbeats.service.js';
import { TelemetryQueryService } from './telemetry-query.service.js';
import type { TelemetryTotalsView } from './telemetry.types.js';

const HOUR_MS = 60 * 60_000;

export interface OperationsOverviewView {
  tenantId: string;
  activeBundle: ActiveBundleSummary | null;
  proxies: {
    total: number;
    upToDate: number;
    restartRequired: number;
    incompatible: number;
    stale: number;
    degraded: number;
    runningLastKnownGood: number;
    withoutBundle: number;
  };
  lastTelemetryAt: Date | null;
  lastHour: TelemetryTotalsView;
  openAlerts: Record<OperationalAlertSeverity, number>;
}

/** One dashboard read combining active-versus-loaded state and telemetry. */
@Injectable()
export class OperationsOverviewService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly bundles: BundlesService,
    private readonly heartbeats: ProxyHeartbeatsService,
    private readonly telemetry: TelemetryQueryService,
    private readonly alerts: OperationalAlertsService,
  ) {}

  async overview(
    organizationId: string,
    tenantId: string,
  ): Promise<OperationsOverviewView> {
    const organizationObjectId = objectId(organizationId);
    const tenantObjectId = objectId(tenantId);
    const tenant = await this.projects.findRuntimeConfiguration(
      organizationObjectId,
      tenantObjectId,
    );
    if (!tenant) throw new NotFoundException('Tenant not found');
    const [activeBundle, instances, lastTelemetryAt, lastHour, openAlerts] =
      await Promise.all([
        this.bundles.findActiveSummary(organizationObjectId, tenantObjectId),
        this.heartbeats.instanceStates(organizationObjectId, tenantObjectId),
        this.telemetry.lastReceivedAt(organizationObjectId, tenantObjectId),
        this.telemetry.recentTotals(
          organizationObjectId,
          tenantObjectId,
          new Date(Date.now() - HOUR_MS),
        ),
        this.alerts.countOpen(organizationObjectId, tenantObjectId),
      ]);
    const count = (
      predicate: (instance: (typeof instances)[number]) => boolean,
    ) => instances.filter(predicate).length;
    return {
      tenantId: tenantObjectId.toHexString(),
      activeBundle,
      proxies: {
        total: instances.length,
        upToDate: count((instance) => instance.bundleState === 'up_to_date'),
        restartRequired: count((instance) => instance.restartRequired),
        incompatible: count(
          (instance) => instance.bundleState === 'incompatible',
        ),
        stale: count((instance) => instance.stale),
        degraded: count((instance) => instance.health === 'degraded'),
        runningLastKnownGood: count(
          (instance) => instance.bundleSource === 'last_known_good',
        ),
        withoutBundle: count((instance) => instance.bundleSource === 'none'),
      },
      lastTelemetryAt,
      lastHour: lastHour.totals,
      openAlerts,
    };
  }
}
