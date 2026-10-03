import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { environmentSchema } from './config/environment.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { ApiKeysModule } from './modules/api-keys/api-keys.module.js';
import { ApprovalsModule } from './modules/approvals/approvals.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { PoliciesModule } from './modules/policies/policies.module.js';
import { PolicyCompilerModule } from './modules/policy-compiler/policy-compiler.module.js';
import { PolicyLifecycleModule } from './modules/policy-lifecycle/policy-lifecycle.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validationSchema: environmentSchema,
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
    HealthModule,
  ],
})
export class AppModule {}
