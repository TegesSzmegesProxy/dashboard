export const API_KEY_TYPES = ['collector', 'deployment'] as const;
export type ApiKeyType = (typeof API_KEY_TYPES)[number];

export const COLLECTOR_SCOPES = [
  'analysis-uploads:write',
  'environment-snapshots:write',
] as const;
export const DEPLOYMENT_SCOPES = [
  'bundles:read',
  'heartbeats:write',
  'telemetry:write',
] as const;

export const API_KEY_SCOPES = [
  ...COLLECTOR_SCOPES,
  ...DEPLOYMENT_SCOPES,
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
