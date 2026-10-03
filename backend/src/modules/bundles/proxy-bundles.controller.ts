import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiNotAcceptableResponse,
  ApiNotModifiedResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import type { Response } from 'express';
import {
  BUNDLE_SCHEMA_RESPONSE_HEADER,
  BUNDLE_SCHEMAS_HEADER,
  TOOL_REGISTRIES_HEADER,
} from '../../contracts/bundle/v1/bundle.contract.js';
import type { MachinePrincipal } from '../api-keys/api-key.types.js';
import { CurrentMachinePrincipal } from '../api-keys/current-machine-principal.decorator.js';
import { DeploymentKeyGuard } from '../api-keys/machine-key.guard.js';
import { RequireMachineScopes } from '../api-keys/machine-scopes.decorator.js';
import { BundlesService } from './bundles.service.js';

class ProxyTenantParamsDto {
  @IsMongoId()
  tenantId!: string;
}

const CONTRACT_ID_PATTERN = /^[a-z0-9.-]+\/v[0-9]+$/;

function parseContractList(value: string | undefined, header: string) {
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (
    entries.length === 0 ||
    entries.length > 20 ||
    !entries.every((entry) => CONTRACT_ID_PATTERN.test(entry))
  ) {
    throw new BadRequestException(
      `${header} must list supported contract versions`,
    );
  }
  return entries;
}

function matchesIfNoneMatch(header: string | undefined, etag: string) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  // If-None-Match uses weak comparison (RFC 9110 section 13.1.2).
  return header
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .includes(etag);
}

@ApiTags('proxy distribution')
@ApiBearerAuth()
@Controller('tenants/:tenantId/active-bundle')
@UseGuards(DeploymentKeyGuard)
@RequireMachineScopes('bundles:read')
export class ProxyBundlesController {
  constructor(private readonly bundles: BundlesService) {}

  @Get()
  @ApiHeader({ name: BUNDLE_SCHEMAS_HEADER, required: true })
  @ApiHeader({ name: TOOL_REGISTRIES_HEADER, required: true })
  @ApiHeader({ name: 'If-None-Match', required: false })
  @ApiNotModifiedResponse()
  @ApiNotAcceptableResponse()
  async get(
    @Param() params: ProxyTenantParamsDto,
    @Headers(BUNDLE_SCHEMAS_HEADER) bundleSchemas: string | undefined,
    @Headers(TOOL_REGISTRIES_HEADER) toolRegistries: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @CurrentMachinePrincipal() principal: MachinePrincipal,
    @Res() response: Response,
  ): Promise<void> {
    const bundle = await this.bundles.getForProxy(principal, params.tenantId, {
      bundleSchemas: parseContractList(bundleSchemas, BUNDLE_SCHEMAS_HEADER),
      toolRegistries: parseContractList(toolRegistries, TOOL_REGISTRIES_HEADER),
    });
    const etag = `"${bundle.version}"`;
    response.setHeader('ETag', etag);
    response.setHeader('Cache-Control', 'private, no-cache');
    response.setHeader(
      'Vary',
      `Authorization, ${BUNDLE_SCHEMAS_HEADER}, ${TOOL_REGISTRIES_HEADER}`,
    );
    response.setHeader(BUNDLE_SCHEMA_RESPONSE_HEADER, bundle.schemaVersion);
    if (matchesIfNoneMatch(ifNoneMatch, etag)) {
      response.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }
    response.status(HttpStatus.OK).json(bundle);
  }
}
