import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { BundlesModule } from '../bundles/bundles.module.js';
import { EventsModule } from '../events/events.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { OperationalAlertEvaluator } from './operational-alert-evaluator.service.js';
import { OperationalAlertsService } from './operational-alerts.service.js';
import { OperationsController } from './operations.controller.js';
import { OperationsOverviewService } from './operations-overview.service.js';
import { ProxyHeartbeatsController } from './proxy-heartbeats.controller.js';
import { ProxyHeartbeatsService } from './proxy-heartbeats.service.js';
import { ProxyStatusController } from './proxy-status.controller.js';
import { ProxyTelemetryController } from './proxy-telemetry.controller.js';
import { TelemetryIngestionService } from './telemetry-ingestion.service.js';
import { TelemetryQueryService } from './telemetry-query.service.js';

@Module({
  imports: [
    ApiKeysModule,
    AuditModule,
    AuthModule,
    BundlesModule,
    EventsModule,
    OrganizationsModule,
    ProjectsModule,
  ],
  controllers: [
    ProxyHeartbeatsController,
    ProxyStatusController,
    ProxyTelemetryController,
    OperationsController,
  ],
  providers: [
    ProxyHeartbeatsService,
    TelemetryIngestionService,
    TelemetryQueryService,
    OperationalAlertsService,
    OperationalAlertEvaluator,
    OperationsOverviewService,
  ],
})
export class TelemetryModule {}
