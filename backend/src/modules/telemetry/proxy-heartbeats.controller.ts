import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProxyHeartbeatV1Dto } from '../../contracts/heartbeat/v1/heartbeat.contract.js';
import type { MachinePrincipal } from '../api-keys/api-key.types.js';
import { CurrentMachinePrincipal } from '../api-keys/current-machine-principal.decorator.js';
import { DeploymentKeyGuard } from '../api-keys/machine-key.guard.js';
import { RequireMachineScopes } from '../api-keys/machine-scopes.decorator.js';
import { ProxyHeartbeatsService } from './proxy-heartbeats.service.js';

@ApiTags('proxy distribution')
@ApiBearerAuth()
@Controller('proxy/heartbeats')
@UseGuards(DeploymentKeyGuard)
@RequireMachineScopes('heartbeats:write')
export class ProxyHeartbeatsController {
  constructor(private readonly heartbeats: ProxyHeartbeatsService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  record(
    @Body() dto: ProxyHeartbeatV1Dto,
    @CurrentMachinePrincipal() principal: MachinePrincipal,
  ): Promise<void> {
    return this.heartbeats.record(principal, dto);
  }
}
