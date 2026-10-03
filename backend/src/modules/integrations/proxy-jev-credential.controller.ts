import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { JevCredentialV1 } from '../../contracts/jev-credential/v1/jev-credential.contract.js';
import type { MachinePrincipal } from '../api-keys/api-key.types.js';
import { CurrentMachinePrincipal } from '../api-keys/current-machine-principal.decorator.js';
import { DeploymentKeyGuard } from '../api-keys/machine-key.guard.js';
import { RequireMachineScopes } from '../api-keys/machine-scopes.decorator.js';
import { JevCredentialService } from './jev-credential.service.js';

@ApiTags('proxy distribution')
@ApiBearerAuth()
@Controller('proxy/jev-credential')
@UseGuards(DeploymentKeyGuard)
@RequireMachineScopes('jev-credentials:read')
export class ProxyJevCredentialController {
  constructor(private readonly credentials: JevCredentialService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'tessera.jev-credential/v1' })
  @ApiNotFoundResponse({
    description: 'The organization has no JEV credential',
  })
  get(
    @CurrentMachinePrincipal() principal: MachinePrincipal,
  ): Promise<JevCredentialV1> {
    return this.credentials.getForProxy(principal);
  }
}
