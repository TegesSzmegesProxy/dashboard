import { useAuth0 } from '@auth0/auth0-react';
import { useCallback, useEffect, useState } from 'react';

// Wire types mirror backend `*View` interfaces (backend/src/modules/**/*.types.ts).
// openapi.yaml has request schemas only; dates arrive as ISO strings.

export type Role = 'owner' | 'admin' | 'viewer';
export type Behavior = 'allow' | 'block';
export type ApiKeyType = 'collector' | 'deployment';
export type ApiKeyScope =
  | 'analysis-uploads:write'
  | 'bundles:read'
  | 'heartbeats:write'
  | 'telemetry:write';
export const SCOPES_BY_TYPE: Record<ApiKeyType, ApiKeyScope[]> = {
  collector: ['analysis-uploads:write'],
  deployment: ['bundles:read', 'heartbeats:write', 'telemetry:write'],
};

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Organization {
  id: string;
  name: string;
  status: 'active';
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface Membership {
  id: string;
  subject: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeConfiguration {
  upstreamUrl: string;
  failureBehavior: Behavior;
  unknownEndpointBehavior: Behavior;
  routing: { pathPrefix: string };
  thresholds: { requestTimeoutMs: number; maxRequestBodyBytes: number };
  samplingRate: number;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  runtimeConfiguration: RuntimeConfiguration;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  organizationId: string;
  name: string;
  type: ApiKeyType;
  scopes: ApiKeyScope[];
  allowedTenantIds: string[];
  displayPrefix: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Returned once by create/rotate. `plaintext` is never stored or logged. */
export interface RevealedApiKey {
  apiKey: ApiKey;
  plaintext: string;
}

export type HttpMethod =
  'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT';

export interface StructuredPolicy {
  schemaVersion: 'tessera.policy/v1';
  endpoints: {
    method: HttpMethod;
    path: string;
    tools: {
      toolId: string;
      target: string;
      config: { minLength?: number; maxLength?: number };
    }[];
  }[];
}

export type PolicyState =
  | 'ACTIVE'
  | 'APPROVED'
  | 'COMPILATION_FAILED'
  | 'PENDING_APPROVAL'
  | 'REJECTED';

export interface PolicyVersion {
  id: string;
  version: string;
  schemaVersion: 'tessera.policy/v1';
  toolRegistryVersion: string;
  humanReadableIntent: string;
  structuredPolicy: StructuredPolicy;
  compilationStatus: 'compiled' | 'failed';
  compilationError: { code: string; message: string } | null;
  approvalStatus: 'approved' | 'not_applicable' | 'pending' | 'rejected';
  rejectionReason: string | null;
  state: PolicyState;
  createdBy: string;
  createdAt: string;
  lifecycleUpdatedAt: string;
}

export interface ActiveBundle {
  version: string;
  schemaVersion: string;
  policyVersion: string;
  toolRegistryVersion: string;
  signingKeyId: string;
  issuedAt: string;
  activatedAt: string;
  activatedBy: string;
  runtimeConfigurationPending: boolean;
}

export interface ProxyInstance {
  instanceId: string;
  apiKeyId: string;
  proxyVersion: string;
  health: 'ok' | 'degraded';
  bundleSource: 'remote' | 'last_known_good' | 'none';
  loadedBundleVersion: string | null;
  activeBundleVersion: string | null;
  bundleState:
    'no_active_bundle' | 'up_to_date' | 'restart_required' | 'incompatible';
  restartRequired: boolean;
  stale: boolean;
  supportedBundleSchemas: string[];
  supportedToolRegistries: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface GitHubInstallation {
  installationId: number;
  accountLogin: string;
  linkedBy: string;
  linkedAt: string;
}

export interface RepositoryBinding {
  tenantId: string;
  provider: 'github';
  installationId: number;
  repositoryId: number;
  fullName: string;
  private: boolean;
  boundBy: string;
  boundAt: string;
}

export type AnalysisStatus =
  'queued' | 'running' | 'completed' | 'partial' | 'failed';
export type Severity = 'unknown' | 'low' | 'medium' | 'high' | 'critical';

export interface AnalysisSummary {
  id: string;
  uploadId: string;
  commitSha: string;
  status: AnalysisStatus;
  version: string | null;
  repository: { fullName: string } | null;
  steps: {
    name: string;
    status: 'succeeded' | 'failed' | 'skipped';
    errorCode?: string;
    message?: string;
  }[];
  errorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Analysis extends AnalysisSummary {
  manifest: {
    repository: string;
    totals: {
      entriesScanned: number;
      includedFiles: number;
      includedBytes: number;
      redactions: number;
    };
    excludedCounts: Record<string, number>;
    truncated: boolean;
  } | null;
  results: {
    environmentTools: { name: string; version: string; status: string; error: string | null }[];
    dependencies: { name: string; version: string; ecosystem: string }[];
    vulnerabilities: {
      id: string;
      packageName: string;
      installedVersion: string;
      fixedVersion: string | null;
      severity: Severity;
      matchedDependency: boolean;
    }[];
    apiSurface: { method: HttpMethod; path: string; description: string }[];
    findings: {
      category: string;
      severity: string;
      title: string;
      description: string;
      basis: string;
    }[];
  } | null;
  provenance: { aiProvider: string | null; aiModel: string | null };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const BASE = `${import.meta.env.VITE_API_URL}/api/v1`;

/** Returns a fetcher bound to the signed-in user's Auth0 access token. */
export function useApi() {
  const { getAccessTokenSilently } = useAuth0();
  return useCallback(
    async <T>(
      path: string,
      init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
    ): Promise<T> => {
      const token = await getAccessTokenSilently();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (init.body !== undefined) headers['Content-Type'] = 'application/json';
      if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
      const res = await fetch(BASE + path, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      if (!res.ok) {
        // Nest default error body: { statusCode, message: string | string[], error }
        const data = (await res.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        const m = data?.message;
        throw new ApiError(
          res.status,
          Array.isArray(m) ? m.join('; ') : (m ?? res.statusText),
        );
      }
      return (res.status === 204 ? undefined : await res.json()) as T;
    },
    [getAccessTokenSilently],
  );
}

export type Fetcher = ReturnType<typeof useApi>;

/** GET a resource; `reload` refetches. 404 yields `data: null` when `allow404`. */
export function useResource<T>(path: string | null, allow404 = false) {
  const api = useApi();
  const [state, setState] = useState<{
    data: T | null;
    error: string | null;
    loading: boolean;
  }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    api<T>(path).then(
      (data) => live && setState({ data, error: null, loading: false }),
      (e: unknown) => {
        if (!live) return;
        if (allow404 && e instanceof ApiError && e.status === 404)
          setState({ data: null, error: null, loading: false });
        else setState({ data: null, error: errorText(e), loading: false });
      },
    );
    return () => {
      live = false;
    };
  }, [api, path, allow404, tick]);

  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/** Cursor-paginated list with "load more". */
export function usePaged<T>(path: string | null) {
  const api = useApi();
  const first = useResource<Page<T>>(path);
  const empty = { items: [] as T[], cursor: null as string | null, loaded: false };
  const [more, setMore] = useState(empty);
  useEffect(() => setMore(empty), [first.data]);

  const nextCursor = more.loaded ? more.cursor : (first.data?.nextCursor ?? null);
  const loadMore = async () => {
    if (!path || !nextCursor) return;
    const sep = path.includes('?') ? '&' : '?';
    const page = await api<Page<T>>(`${path}${sep}cursor=${nextCursor}`);
    setMore((m) => ({
      items: [...m.items, ...page.items],
      cursor: page.nextCursor,
      loaded: true,
    }));
  };
  const items = first.data ? [...first.data.items, ...more.items] : [];
  return {
    items,
    loading: first.loading,
    error: first.error,
    reload: first.reload,
    hasMore: nextCursor !== null,
    loadMore,
  };
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Request failed';
}
