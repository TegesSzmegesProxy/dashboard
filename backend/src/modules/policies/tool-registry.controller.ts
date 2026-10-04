import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  TOOL_DEFINITIONS,
  TOOL_REGISTRY_V2,
  ToolDefinition,
} from '../../contracts/tools/v2/tool-registry.js';
import { DashboardAuthGuard } from '../auth/dashboard-auth.guard.js';

export interface ToolRegistryView {
  toolRegistryVersion: typeof TOOL_REGISTRY_V2;
  tools: ToolDefinition[];
}

/** The tools a policy may select, with names and summaries for people. */
@ApiTags('policies')
@ApiBearerAuth()
@Controller('tool-registries')
@UseGuards(DashboardAuthGuard)
export class ToolRegistryController {
  @Get('tessera.tools/v2')
  v2(): ToolRegistryView {
    return {
      toolRegistryVersion: TOOL_REGISTRY_V2,
      tools: [...TOOL_DEFINITIONS],
    };
  }
}
