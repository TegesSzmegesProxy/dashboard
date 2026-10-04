import { useAuth0 } from '@auth0/auth0-react';
import { useCallback, useEffect, useState } from 'react';

// Wire types mirror backend `*View` interfaces (backend/src/modules/**/*.types.ts).
// openapi.yaml has request schemas only; dates arrive as ISO strings.

export type Role = 'owner' | 'admin' | 'viewer';
export type Behavior = 'allow' | 'block';
export type ApiKeyType = 'collector' | 'deployment';
export type ApiKeyScope =
  | 'analysis-uploads:write'
  | 'environment-snapshots:write'
  | 'bundles:read'
  | 'heartbeats:write'
  | 'telemetry:write'
  | 'jev-credentials:read';
export const SCOPES_BY_TYPE: Record<ApiKeyType, ApiKeyScope[]> = {
  collector: ['analysis-uploads:write', 'environment-snapshots:write'],
  deployment: ['bundles:read', 'heartbeats:write', 'telemetry:write', 'jev-credentials:read'],
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
  decision: DecisionSettings;
}

/** Bundle v2 decision settings (ADR-0012); always chosen explicitly. */
export interface DecisionSettings {
  sampling: { minN: number; maxN: number };
  jev: { attackProbabilityThreshold: number; attackProbabilityFloor: number; locked: boolean };
  onStaticAnalysisError: Behavior;
  onSuspiciousJevUnavailable: Behavior;
  onSampledJevUnavailable: Behavior;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  /** Projects stored before ADR-0012 have no decision settings yet. */
  runtimeConfiguration: Omit<RuntimeConfiguration, 'decision'> & { decision?: DecisionSettings };
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

export interface PolicyVersionV1 {
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

// ---------- Endpoint policies (tessera.policy/v2, ADR-0014) ----------

export type ToolScope = 'field' | 'file' | 'full';
export type ToolCategory =
  | 'schema' | 'injection' | 'url' | 'resource' | 'anomaly' | 'auth' | 'bot' | 'data_leakage' | 'protocol';
/** One entry of `tessera.tools/v2` or `tessera.tools/v3`, served by the backend registry. */
export interface ToolDefinition {
  id: string;
  label: string;
  summary: string;
  category: ToolCategory;
  scope: ToolScope;
  /** Needs runtime state; chosen from purpose rather than code, so review it. */
  stateful: boolean;
  useWhen: string;
  /** v3: false for tools operators configure with the proxy (secrets, data feeds). */
  aiSelectable?: boolean;
  /** v3: settings the tool cannot run without. */
  requiredSettings?: string[];
  /** v3: JSON Schema of the tool's configuration. */
  configSchema?: Record<string, unknown>;
}
export interface ToolRegistry { toolRegistryVersion: 'tessera.tools/v2' | 'tessera.tools/v3'; tools: ToolDefinition[] }

/** A selected check; v3 checks carry the tool's configuration (ADR-0021). */
export interface PolicyTool { toolId: string; config?: Record<string, unknown> }

export type FieldLocation = 'body' | 'query' | 'path' | 'header' | 'cookie' | 'file';
export interface FieldPolicyV2 {
  name: string;
  location: FieldLocation;
  type: string;
  required: boolean;
  humanReadablePolicy: string;
  tools: PolicyTool[];
  jevContext: string | null;
}
export interface EndpointPolicyV2 {
  method: HttpMethod;
  path: string;
  humanReadablePolicy: string;
  requestTools: PolicyTool[];
  jevContext: string | null;
  fields: FieldPolicyV2[];
}
export interface StructuredPolicyV2 {
  schemaVersion: 'tessera.policy/v2';
  toolRegistryVersion: 'tessera.tools/v2';
  endpoints: EndpointPolicyV2[];
}
/** Policies that apply to every request (ADR-0021). */
export interface ScopePolicyV3 {
  humanReadablePolicy: string;
  requestTools: PolicyTool[];
  /** Field tools run on every field of the listed locations. */
  fieldTools: (PolicyTool & { locations: ('body' | 'query')[] })[];
  jevContext: string | null;
}
/** `tessera.policy/v3`: v2-shaped endpoints plus global and environment scopes. */
export interface StructuredPolicyV3 {
  schemaVersion: 'tessera.policy/v3';
  toolRegistryVersion: 'tessera.tools/v3';
  global: ScopePolicyV3;
  environment: ScopePolicyV3 & { environmentSnapshotId: string | null };
  endpoints: EndpointPolicyV2[];
}
/** The policies the endpoint editor works on. */
export type EndpointStructuredPolicy = StructuredPolicyV2 | StructuredPolicyV3;
/** Length limits of the v2 contract (backend contracts/policy/v2). */
export const POLICY_V2_LIMITS = { endpointText: 2000, fieldText: 500, endpointJev: 1500, fieldJev: 500 } as const;

export interface ReviewWarning {
  kind: 'analysis' | 'jev_context' | 'scope_override';
  /** `METHOD path`, or `global` / `environment` for a scope */
  endpoint: string;
  /** `location:name`, or null for the endpoint */
  field: string | null;
  message: string;
}
export type PolicyVersionV2Origin =
  | { kind: 'analysis'; analysisId: string; aiModel: string | null }
  | { kind: 'draft'; parentVersion: string; analysisId: string | null; changedEndpoints: string[] };

export interface PolicyVersionV2 {
  id: string;
  version: string;
  schemaVersion: 'tessera.policy/v2';
  toolRegistryVersion: 'tessera.tools/v2';
  structuredPolicy: StructuredPolicyV2;
  compilationStatus: 'compiled' | 'failed';
  compilationIssues: string[];
  reviewWarnings: ReviewWarning[];
  approvalStatus: 'approved' | 'not_applicable' | 'pending' | 'rejected';
  approvalSource: 'manual' | 'auto_apply' | null;
  rejectionReason: string | null;
  state: PolicyState;
  origin: PolicyVersionV2Origin;
  precisionWarning: string | null;
  /** False until proxies accept a bundle schema that carries policy v2. */
  activatable: boolean;
  createdBy: string;
  createdAt: string;
  lifecycleUpdatedAt: string;
}

export interface PolicyVersionV3 extends Omit<PolicyVersionV2, 'schemaVersion' | 'toolRegistryVersion' | 'structuredPolicy'> {
  schemaVersion: 'tessera.policy/v3';
  toolRegistryVersion: 'tessera.tools/v3';
  structuredPolicy: StructuredPolicyV3;
  /** The steps and JEV context a `tessera.bundle/v3` carries. */
  compiledPolicy: unknown | null;
}
/** Versions the endpoint policy editor opens. */
export type EndpointPolicyVersion = PolicyVersionV2 | PolicyVersionV3;

export type PolicyVersion = PolicyVersionV1 | PolicyVersionV2 | PolicyVersionV3;

/** Preview from `POST policies/v2/compile`; it creates no version. */
export interface CompiledEndpoint {
  endpoint: EndpointPolicyV2;
  limitations: string[];
  /** The compiler is still a placeholder that leaves the checks unchanged. */
  mock: boolean;
}

/** Chosen before generation: review the policy, or apply it automatically (ADR-0018). */
export type PolicyReviewMode = 'review' | 'auto_apply';

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
  | 'queued'
  | 'running'
  | 'awaiting_budget'
  | 'paused'
  | 'completed'
  | 'partial'
  | 'failed';
export type Severity = 'unknown' | 'low' | 'medium' | 'high' | 'critical';

interface Range3 { low: number; expected: number; high: number }

/** Cost estimate computed from the repository index, before any model call (ADR-0015). */
export interface AnalysisEstimate {
  model: string;
  workItems: Range3;
  usd: Range3;
  suggestedCeilingUsd: number;
  assumptions: string[];
  aiCredentialConfigured: boolean;
}

/** What this deployment provides for analyses; the model is chosen in the control plane's `.env` (ADR-0019). */
export interface AnalysisReadiness {
  ai: { configured: boolean; model: string; mode: 'anthropic' | 'local' | null };
  /** False when the control plane has no analysis sandbox, so source cannot be fetched. */
  sandboxConfigured: boolean;
  /** An analysis of this project that has not finished; only one runs at a time. */
  activeAnalysis: { id: string; status: AnalysisStatus } | null;
}

/** Result of a live check that the deployment's AI model answers; the message never holds a key or URL. */
export interface AiModelCheck {
  ok: boolean;
  model: string;
  mode: 'anthropic' | 'local' | null;
  latencyMs: number | null;
  error: { code: string; message: string } | null;
}

/** Latest environment snapshot of a project (`tessera -get-environment`, ADR-0016). */
export interface EnvironmentStatus {
  available: boolean;
  latest: {
    id: string;
    collectionCompletedAt: string;
    toolStatus: Record<string, 'ok' | 'failed' | 'skipped'>;
    counts: { openPorts: number; nucleiFindings: number; vulnerabilities: number; misconfigurations: number; secretFindings: number; httpTargets: number };
  } | null;
  ageHours: number | null;
  /** Tells the user to run `tessera -get-environment` when no snapshot exists. */
  notice: string | null;
}

export interface AnalysisSummary {
  id: string;
  /** Null when the dashboard started the analysis rather than a collector. */
  uploadId: string | null;
  startedBy: string | null;
  commitSha: string;
  status: AnalysisStatus;
  phase: 'estimate' | 'analyze';
  version: string | null;
  repository: { fullName: string } | null;
  estimate: AnalysisEstimate | null;
  budget: { ceilingUsd: number; approvedBy: string; approvedAt: string; source: 'manual' | 'auto' } | null;
  usage: { usd: number; models: string[] };
  /** `notice` tells the user to run `tessera -get-environment` when no snapshot exists. */
  environment: { snapshotId: string | null; ageHours: number | null; notice: string | null } | null;
  steps: {
    name: string;
    status: 'succeeded' | 'failed' | 'skipped';
    errorCode?: string;
    message?: string;
  }[];
  policyReview: { mode: PolicyReviewMode; chosenBy: string; chosenAt: string } | null;
  /** The pending policy version committed with the analysis. */
  policy: { version: string; approved: boolean; autoApplySkipped: string | null } | null;
  errorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Why the analysis chose a tool; `inferred` goes beyond what the code shows. */
export interface ToolChoice { toolId: string; basis: 'observed' | 'inferred' | 'environment'; rationale: string; config?: Record<string, unknown> }

export interface AnalysisEndpoint {
  method: HttpMethod;
  path: string;
  confidence: 'high' | 'medium' | 'low';
  auth: { required: 'yes' | 'no' | 'unknown'; mechanism: string };
  humanReadablePolicy: string;
  jevContext: string | null;
  requestTools: ToolChoice[];
  fields: {
    name: string;
    location: string;
    type: string;
    required: boolean;
    constraints: string[];
    tools: ToolChoice[];
    humanReadablePolicy?: string;
  }[];
  observedLimits: { subject: string; limit: string }[];
  findings: { category: string; severity: string; title: string; description: string; basis: string }[];
  limitations: string[];
  warnings: string[];
}

export interface Analysis extends AnalysisSummary {
  extraction: {
    entriesScanned: number;
    includedFiles: number;
    includedBytes: number;
    excludedCounts: Record<string, number>;
    truncated: boolean;
  } | null;
  index: {
    files: number;
    languages: Record<string, number>;
    frameworkGuesses: string[];
    strongCandidates: number;
    heuristicCandidates: number;
  } | null;
  readManifest: { files: { path: string }[]; totalLinesSent: number } | null;
  results: {
    endpoints: AnalysisEndpoint[];
    coverage: {
      workItems: number;
      endpoints: number;
      notAnEndpoint: number;
      duplicate: number;
      unresolved: number;
    };
  } | null;
}

// ---------- Operations, telemetry, alerts (backend: modules/telemetry) ----------

export interface TelemetryTotals {
  requests: number;
  decisions: { allow: number; block: number };
  staticVerdicts: { safe: number; suspicious: number; policyViolation: number; error: number };
  jev: { sampledSafe: number; attack: number; benign: number; unavailable: number };
  failureBehaviorApplied: number;
  attackRate: number | null;
  observedSamplingRate: number | null;
  reportedSamplingRate: number | null;
  attackRateEwma: number | null;
}
export interface TelemetryEvents {
  bundleVerificationFailures: number;
  bundlePullFailures: number;
  droppedWindows: number;
}
export type TelemetryGranularity = 'minute' | 'hour';
export interface TelemetrySummary {
  tenantId: string;
  granularity: TelemetryGranularity;
  from: string;
  to: string;
  totals: TelemetryTotals;
  events: TelemetryEvents;
  series: (TelemetryTotals & { windowStart: string; events: TelemetryEvents })[];
  endpoints: (TelemetryTotals & { endpoint: string | null })[];
}

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertType =
  | 'proxy_stale' | 'proxy_degraded' | 'proxy_incompatible'
  | 'bundle_verification_failures' | 'jev_unavailable'
  | 'telemetry_quota_exceeded' | 'attack_rate_high';
export interface OperationalAlert {
  id: string;
  type: AlertType;
  subject: string | null;
  severity: AlertSeverity;
  status: 'open' | 'resolved';
  details: Record<string, string | number>;
  openedAt: string;
  lastObservedAt: string;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}
export interface AlertSettings {
  tenantId: string;
  attackRateThreshold: number | null;
  attackRateMinClassified: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
}
export interface OperationsOverview {
  tenantId: string;
  activeBundle: { version: string } | null;
  proxies: {
    total: number; upToDate: number; restartRequired: number; incompatible: number;
    stale: number; degraded: number; runningLastKnownGood: number; withoutBundle: number;
  };
  lastTelemetryAt: string | null;
  lastHour: TelemetryTotals;
  openAlerts: Record<AlertSeverity, number>;
}

// ---------- AI policy generation (backend: modules/policy-generation) ----------

export interface PolicyDiff {
  addedEndpoints: string[];
  removedEndpoints: string[];
  changedEndpoints: {
    endpoint: string;
    addedTargets: string[];
    removedTargets: string[];
    changedTargets: { target: string; before: { minLength?: number; maxLength?: number }; after: { minLength?: number; maxLength?: number } }[];
  }[];
  humanReadableIntentChanged: boolean;
}
export interface PolicyGeneration {
  id: string;
  kind: 'generate' | 'edit';
  trigger: 'analysis_completed' | 'dashboard';
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  analysisId: string | null;
  analysisVersion: string | null;
  baseVersion: string | null;
  instruction: string | null;
  requestedBy: string;
  policyVersion: string | null;
  reusedExistingVersion: boolean;
  limitations: string[];
  diff: PolicyDiff | null;
  errorCode: string | null;
  errorMessage: string | null;
  validationIssues: string[];
  provenance: { aiProvider: string | null; aiModel: string | null };
  precisionWarning: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Organization JEV credential (ADR-0009). The key itself is write-only. */
export interface JevIntegration { connected: boolean; version: number | null; updatedAt: string | null }


/** Customer-visible manifest of one collector upload. */
export interface AnalysisUpload {
  id: string;
  analysisId: string;
  analysisStatus: AnalysisStatus;
  commitSha: string;
  collector: { name: string; version: string };
  redaction: { tool: string; rules: string[]; redactedValueCount: number };
  environmentSummary: {
    tools: { name: string; version: string; status: 'succeeded' | 'failed' }[];
    dependencyCount: number;
    vulnerabilityCount: number;
  };
  receivedAt: string;
}

// Project tuning settings (ADR-0011): stored inputs that change no policy version or bundle.
// PUT bodies use the plain types; GET returns the `*View` with every value null until first saved.

interface TuningMeta { tenantId: string; version: number | null; updatedBy: string | null; updatedAt: string | null }
export interface ModelSettings { contextLength: number; temperature: number; topP: number; maxTokens: number }
export type ModelSettingsView = TuningMeta & { [K in keyof ModelSettings]: ModelSettings[K] | null };
export type PolicyAction = 'allow' | 'review' | 'block';
export interface PolicyDefaults { defaultAction: PolicyAction; customConstraints: string; threshold: number }
export type PolicyDefaultsView = TuningMeta & { [K in keyof PolicyDefaults]: PolicyDefaults[K] | null };
export type FieldRule = 'allow' | 'require' | 'mask' | 'review' | 'block';
export interface EndpointOverride {
  method: HttpMethod;
  path: string;
  requestPolicy: PolicyAction | null;
  threshold: number | null;
  fields: { name: string; rule: FieldRule; constraints: string }[];
}
export type EndpointOverridesView = TuningMeta & { endpoints: EndpointOverride[] };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Contract paths of a 422, e.g. `endpoints.3.jevContext: credential`. */
    readonly issues: string[] = [],
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
          issues?: string[];
        } | null;
        const m = data?.message;
        throw new ApiError(
          res.status,
          Array.isArray(m) ? m.join('; ') : (m ?? res.statusText),
          data?.issues ?? [],
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

/**
 * GET an endpoint that is proposed but may not exist yet. 404/405 → `missing`
 * (the form renders empty and explains it); other failures → `error`.
 */
export function useProposed<T>(path: string) {
  const api = useApi();
  const [state, setState] = useState<{ data: T | null; status: 'loading' | 'ready' | 'missing' | 'error'; error: string | null }>(
    { data: null, status: 'loading', error: null },
  );
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    api<T>(path).then(
      (data) => live && setState({ data, status: 'ready', error: null }),
      (e: unknown) => {
        if (!live) return;
        const gone = e instanceof ApiError && (e.status === 404 || e.status === 405);
        setState({ data: null, status: gone ? 'missing' : 'error', error: gone ? null : errorText(e) });
      },
    );
    return () => { live = false; };
  }, [api, path, tick]);
  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) };
}
