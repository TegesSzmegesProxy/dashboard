import { SetMetadata } from '@nestjs/common';
import { ApiKeyScope } from './api-key.constants.js';

export const MACHINE_SCOPES_KEY = 'machineScopes';

export const RequireMachineScopes = (...scopes: ApiKeyScope[]) =>
  SetMetadata(MACHINE_SCOPES_KEY, scopes);
