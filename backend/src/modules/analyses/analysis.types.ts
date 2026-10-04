import { ObjectId } from 'mongodb';
import type {
  ANALYSIS_SCHEMA_V2,
  AUTH_REQUIRED,
  CONFIDENCES,
  DossierDto,
  EvidenceBasis,
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  SINK_KINDS,
} from '../../contracts/analysis/v2/analysis-agent.contract.js';
import type { PolicyHttpMethod } from '../../contracts/policy/v1/policy.contract.js';
import type {
  FieldLocationV2,
  StructuredPolicyV2,
} from '../../contracts/policy/v2/policy.contract.js';
import type { ToolId } from '../../contracts/tools/v2/tool-registry.js';
import type { TokenUsage } from '../../infrastructure/ai/pricing.js';
import type {
  CandidateLocation,
  ExtractionSummary,
  LanguageTier,
  RouteCandidate,
  RouteRule,
} from '../../repo-host/protocol.js';

export type AnalysisStatus =
  | 'queued'
  | 'running'
  | 'awaiting_budget'
  | 'paused'
  | 'completed'
  | 'partial'
  | 'failed';

/** `estimate` runs without any model call; `analyze` spends the budget. */
export type AnalysisPhase = 'estimate' | 'analyze';

export type AnalysisStepName =
  | 'source_fetch'
  | 'index'
  | 'environment'
  | 'estimate'
  | 'recon'
  | 'route_rules'
  | 'endpoints'
  | 'sweep'
  | 'reconcile';

export interface AnalysisStep {
  name: AnalysisStepName;
  status: 'succeeded' | 'failed' | 'skipped';
  errorCode?: string;
  message?: string;
  startedAt: Date;
  finishedAt: Date;
}

export interface RangeEstimate {
  low: number;
  expected: number;
  high: number;
}

/** Computed from the index alone, before any model call (ADR-0015). */
export interface AnalysisEstimate {
  model: string;
  workItems: RangeEstimate;
  inputTokens: RangeEstimate;
  outputTokens: RangeEstimate;
  usd: RangeEstimate;
  /** Smallest ceiling expected to cover every work item. */
  suggestedCeilingUsd: number;
  assumptions: string[];
  aiCredentialConfigured: boolean;
}

export interface AnalysisBudget {
  ceilingUsd: number;
  approvedBy: string;
  approvedAt: Date;
  source: 'manual' | 'auto';
}

export interface AnalysisUsage {
  usd: number;
  tokens: TokenUsage;
  byStep: Partial<Record<'recon' | 'endpoints' | 'sweep', number>>;
  models: string[];
}

export interface IndexSummary {
  files: number;
  bytes: number;
  languages: Record<string, number>;
  tiers: Record<LanguageTier, number>;
  frameworkGuesses: string[];
  dependencyManifests: string[];
  specFiles: string[];
  symbols: number;
  strongCandidates: number;
  heuristicCandidates: number;
  candidatesTruncated: boolean;
}

export interface AnalysisEnvironmentInfo {
  snapshotId: string | null;
  collectedAt: Date | null;
  ageHours: number | null;
  /** The `tessera -get-environment` notice when no snapshot exists. */
  notice: string | null;
}

/** Exactly which source the AI provider received, per file. */
export interface AiReadManifest {
  files: { path: string; ranges: [number, number][]; redactions: number }[];
  searchPreviews: number;
  totalLinesSent: number;
}

export interface Evidence {
  path: string;
  startLine: number;
  endLine: number;
}

export interface ToolChoice {
  toolId: ToolId;
  basis: EvidenceBasis;
  rationale: string;
}

export interface EndpointField {
  name: string;
  location: FieldLocationV2;
  type: string;
  required: boolean;
  constraints: string[];
  evidence: Evidence[];
  tools: ToolChoice[];
  jevContext: string | null;
}

export interface EndpointFinding {
  category: (typeof FINDING_CATEGORIES)[number];
  severity: (typeof FINDING_SEVERITIES)[number];
  title: string;
  description: string;
  basis: EvidenceBasis;
  evidence: Evidence[];
}

/** One reconciled endpoint with its facts and proposed endpoint policy. */
export interface EndpointRecord {
  method: PolicyHttpMethod;
  path: string;
  handler: Evidence | null;
  confidence: (typeof CONFIDENCES)[number];
  auth: {
    required: (typeof AUTH_REQUIRED)[number];
    mechanism: string;
    evidence: Evidence[];
  };
  contentTypes: string[];
  observedLimits: { subject: string; limit: string; evidence: Evidence[] }[];
  sinks: {
    kind: (typeof SINK_KINDS)[number];
    field: string | null;
    evidence: Evidence[];
  }[];
  fields: EndpointField[];
  requestTools: ToolChoice[];
  jevContext: string | null;
  humanReadablePolicy: string;
  limitations: string[];
  findings: EndpointFinding[];
  /** Review warnings from reconciliation (JEV context lint, dropped evidence). */
  warnings: string[];
  workItemIds: string[];
}

export interface CoverageSummary {
  workItems: number;
  endpoints: number;
  notAnEndpoint: number;
  duplicate: number;
  unresolved: number;
  overflow: number;
  /** Heuristic hits that no work item explained. */
  heuristicUnexplained: number;
  heuristicReviewedBySweep: number;
}

export interface AnalysisResults {
  endpoints: EndpointRecord[];
  policyProposal: StructuredPolicyV2;
  coverage: CoverageSummary;
  attribution: { discardedEvidence: number; downgradedFindings: number };
}

export interface AnalysisDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  uploadId: ObjectId;
  commitSha: string;
  schemaVersion: typeof ANALYSIS_SCHEMA_V2;
  status: AnalysisStatus;
  phase: AnalysisPhase;
  attempts: number;
  availableAt: Date;
  leaseOwner?: string;
  leaseExpiresAt?: Date;
  repository: {
    provider: 'github';
    repositoryId: number;
    fullName: string;
  } | null;
  extraction: ExtractionSummary | null;
  index: IndexSummary | null;
  environment: AnalysisEnvironmentInfo | null;
  estimate: AnalysisEstimate | null;
  budget: AnalysisBudget | null;
  usage: AnalysisUsage;
  dossier: DossierDto | null;
  routeRules: RouteRule[] | null;
  steps: AnalysisStep[];
  readManifest: AiReadManifest | null;
  results: AnalysisResults | null;
  version: string | null;
  errorCode: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export type WorkItemStatus =
  'pending' | 'endpoint' | 'not_an_endpoint' | 'duplicate' | 'unresolved';

/** One candidate the coverage gate requires to be resolved explicitly. */
export interface WorkItemDocument {
  _id: ObjectId;
  analysisId: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  key: string;
  method: string | null;
  path: string | null;
  sources: RouteCandidate['sources'];
  locations: CandidateLocation[];
  hints: string[];
  /** Lower runs first. */
  priority: number;
  status: WorkItemStatus;
  reason: string | null;
  errorCode: string | null;
  notes: string[];
  result: EndpointRecord | null;
  usd: number;
  turns: number;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface AnalysisSettingsDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  /** Explicit; analyses wait for approval when null (ADR-0015). */
  autoApproveCeilingUsd: number | null;
  updatedBy: string;
  updatedAt: Date;
}

export interface AnalysisSummaryView {
  id: string;
  organizationId: string;
  tenantId: string;
  uploadId: string;
  commitSha: string;
  status: AnalysisStatus;
  phase: AnalysisPhase;
  version: string | null;
  repository: AnalysisDocument['repository'];
  estimate: AnalysisEstimate | null;
  budget: AnalysisBudget | null;
  usage: AnalysisUsage;
  environment: AnalysisEnvironmentInfo | null;
  steps: AnalysisStep[];
  errorCode: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface AnalysisView extends AnalysisSummaryView {
  extraction: ExtractionSummary | null;
  index: IndexSummary | null;
  dossier: DossierDto | null;
  routeRules: RouteRule[] | null;
  readManifest: AiReadManifest | null;
  results: AnalysisResults | null;
}

export interface WorkItemView {
  id: string;
  key: string;
  method: string | null;
  path: string | null;
  sources: RouteCandidate['sources'];
  locations: CandidateLocation[];
  status: WorkItemStatus;
  reason: string | null;
  errorCode: string | null;
  usd: number;
  turns: number;
}
