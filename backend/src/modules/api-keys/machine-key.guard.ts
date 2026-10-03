import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ApiKeyScope, ApiKeyType } from './api-key.constants.js';
import { ApiKeysService } from './api-keys.service.js';
import { MACHINE_SCOPES_KEY } from './machine-scopes.decorator.js';
import { MachineRateLimiter } from './machine-rate-limiter.service.js';

abstract class MachineKeyGuard implements CanActivate {
  protected abstract readonly expectedType: ApiKeyType;

  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly rateLimiter: MachineRateLimiter,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.header('authorization');
    const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? '');
    if (!match) {
      throw new UnauthorizedException('Machine bearer credential is required');
    }
    const plaintext = match[1];
    const source =
      request.ip ?? request.socket.remoteAddress ?? 'unknown-client';
    const credentialId = this.apiKeys.parseIdentifier(plaintext);
    const identifier = credentialId ? `${credentialId}:${source}` : source;
    await this.rateLimiter.consume(identifier);

    const scopes = this.reflector.getAllAndOverride<ApiKeyScope[]>(
      MACHINE_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!scopes?.length) {
      throw new InternalServerErrorException(
        'Machine endpoint has no declared credential scope',
      );
    }
    const rawTenantId = request.params.tenantId;
    const tenantId = Array.isArray(rawTenantId) ? rawTenantId[0] : rawTenantId;
    request.machinePrincipal = await this.apiKeys.authenticate(
      plaintext,
      this.expectedType,
      scopes,
      tenantId,
    );
    return true;
  }
}

@Injectable()
export class CollectorKeyGuard extends MachineKeyGuard {
  protected readonly expectedType = 'collector' as const;

  constructor(
    apiKeys: ApiKeysService,
    rateLimiter: MachineRateLimiter,
    reflector: Reflector,
  ) {
    super(apiKeys, rateLimiter, reflector);
  }
}

@Injectable()
export class DeploymentKeyGuard extends MachineKeyGuard {
  protected readonly expectedType = 'deployment' as const;

  constructor(
    apiKeys: ApiKeysService,
    rateLimiter: MachineRateLimiter,
    reflector: Reflector,
  ) {
    super(apiKeys, rateLimiter, reflector);
  }
}
