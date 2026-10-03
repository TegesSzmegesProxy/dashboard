import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TelemetryBatchV1Dto } from '../../contracts/telemetry/v1/telemetry.contract.js';
import type { MachinePrincipal } from '../api-keys/api-key.types.js';
import { CurrentMachinePrincipal } from '../api-keys/current-machine-principal.decorator.js';
import { DeploymentKeyGuard } from '../api-keys/machine-key.guard.js';
import { RequireMachineScopes } from '../api-keys/machine-scopes.decorator.js';
import { TelemetryIngestionService } from './telemetry-ingestion.service.js';

@ApiTags('proxy distribution')
@ApiBearerAuth()
@Controller('proxy/telemetry')
@UseGuards(DeploymentKeyGuard)
@RequireMachineScopes('telemetry:write')
export class ProxyTelemetryController {
  constructor(private readonly ingestion: TelemetryIngestionService) {}

  /**
   * 204 also covers an already-applied batchId. Proxies drop a batch on any
   * other 4xx and may retry 429/5xx later with the same batchId.
   */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  record(
    @Body() dto: TelemetryBatchV1Dto,
    @CurrentMachinePrincipal() principal: MachinePrincipal,
  ): Promise<void> {
    return this.ingestion.record(principal, dto);
  }
}
