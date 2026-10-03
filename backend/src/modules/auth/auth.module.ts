import { Module } from '@nestjs/common';
import { DashboardAuthGuard } from './dashboard-auth.guard.js';
import { OidcTokenVerifier } from './oidc-token-verifier.service.js';

@Module({
  providers: [OidcTokenVerifier, DashboardAuthGuard],
  exports: [DashboardAuthGuard, OidcTokenVerifier],
})
export class AuthModule {}
