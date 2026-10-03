import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { AnalysesModule } from './modules/analyses/analyses.module.js';
import { AnalysisUploadsModule } from './modules/analysis-uploads/analysis-uploads.module.js';
import { ApiKeysModule } from './modules/api-keys/api-keys.module.js';
import { ApprovalsModule } from './modules/approvals/approvals.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BundlesModule } from './modules/bundles/bundles.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { PoliciesModule } from './modules/policies/policies.module.js';
import { PolicyCompilerModule } from './modules/policy-compiler/policy-compiler.module.js';
import { PolicyGenerationModule } from './modules/policy-generation/policy-generation.module.js';
import { PolicyLifecycleModule } from './modules/policy-lifecycle/policy-lifecycle.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { SourceRepositoriesModule } from './modules/source-repositories/source-repositories.module.js';
import { TelemetryModule } from './modules/telemetry/telemetry.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    RedisModule,
    AuthModule,
    AuditModule,
    OrganizationsModule,
    ProjectsModule,
    ApiKeysModule,
    EventsModule,
    PolicyCompilerModule,
    PoliciesModule,
    ApprovalsModule,
    PolicyLifecycleModule,
    BundlesModule,
    TelemetryModule,
    SourceRepositoriesModule,
    IntegrationsModule,
    AnalysesModule,
    AnalysisUploadsModule,
    PolicyGenerationModule,
    HealthModule,
  ],
})
export class AppModule {}
