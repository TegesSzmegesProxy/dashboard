import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { OidcTokenVerifier } from './oidc-token-verifier.service.js';

@Injectable()
export class DashboardAuthGuard implements CanActivate {
  constructor(private readonly verifier: OidcTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.header('authorization');
    const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? '');
    if (!match) {
      throw new UnauthorizedException('Bearer access token is required');
    }

    const payload = await this.verifier.verify(match[1]);
    request.dashboardPrincipal = { subject: payload.sub };
    return true;
  }
}
