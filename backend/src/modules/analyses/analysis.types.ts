import { ObjectId } from 'mongodb';
import type {
  AiConfigurationItemDto,
  AiEndpointDto,
  AiFindingDto,
} from '../../contracts/analysis/v1/ai-analysis.contract.js';
import type { VulnerabilitySeverity } from '../../contracts/analysis-upload/v1/analysis-upload.contract.js';
import type { StoredObject } from '../../infrastructure/object-storage/object-storage.js';

export type AnalysisStatus =
  'queued' | 'running' | 'completed' | 'partial' | 'failed';

export type AnalysisStepName =
  | 'source_fetch'
  | 'source_redaction'
  | 'dependencies'
  | 'vulnerabilities'
  | 'ai_analysis';

export interface AnalysisStep {
  name: AnalysisStepName;
  status: 'succeeded' | 'failed' | 'skipped';
  errorCode?: string;
  message?: string;
  startedAt: Date;
  finishedAt: Date;
}

export type ExclusionReason =
  | 'excluded_directory'
  | 'denied_file'
  | 'unsupported_type'
  | 'file_too_large'
  | 'binary_content'
  | 'private_key_material'
  | 'file_count_limit'
  | 'total_size_limit';

/** Customer-visible record of exactly which source left GitHub for analysis. */
export interface SourceManifest {
  repository: string;
  commitSha: string;
  includedFiles: {
    path: string;
    sizeBytes: number;
    sha256: string;
    redactions: Record<string, number>;
  }[];
  excludedCounts: Partial<Record<ExclusionReason, number>>;
  /** First excluded paths, capped; counts above are complete. */
  excludedSamples: { path: string; reason: ExclusionReason }[];
  totals: {
    entriesScanned: number;
    includedFiles: number;
    includedBytes: number;
    redactions: number;
  };
  truncated: boolean;
  limits: {
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
  };
}

export interface AnalyzedDependency {
  name: string;
  version: string;
  ecosystem: string;
  purl: string | null;
  sources: string[];
}

export interface AnalyzedVulnerability {
  id: string;
  packageName: string;
  installedVersion: string;
  fixedVersion: string | null;
  severity: VulnerabilitySeverity;
  sources: string[];
  /** The affected package version appears in the dependency inventory. */
  matchedDependency: boolean;
}

export interface EnvironmentToolRun {
  name: string;
  version: string;
  status: 'succeeded' | 'failed';
  error: string | null;
}

export interface AnalysisResults {
  environmentTools: EnvironmentToolRun[];
  dependencies: AnalyzedDependency[];
  vulnerabilities: AnalyzedVulnerability[];
  apiSurface: AiEndpointDto[];
  configuration: AiConfigurationItemDto[];
  findings: AiFindingDto[];
  attribution: {
    discardedEvidence: number;
    downgradedFindings: number;
  };
}

export interface AnalysisDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  uploadId: ObjectId;
  commitSha: string;
  status: AnalysisStatus;
  attempts: number;
  availableAt: Date;
  leaseOwner?: string;
  leaseExpiresAt?: Date;
  environmentObject: StoredObject | null;
  /** Object keys still to delete; retried until empty. */
  pendingObjectKeys: string[];
  repository: {
    provider: 'github';
    repositoryId: number;
    fullName: string;
  } | null;
  manifest: SourceManifest | null;
  steps: AnalysisStep[];
  results: AnalysisResults | null;
  version: string | null;
  provenance: { aiProvider: string | null; aiModel: string | null };
  errorCode: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  rawDeletedAt: Date | null;
}

export interface AnalysisSummaryView {
  id: string;
  organizationId: string;
  tenantId: string;
  uploadId: string;
  commitSha: string;
  status: AnalysisStatus;
  version: string | null;
  repository: AnalysisDocument['repository'];
  steps: AnalysisStep[];
  errorCode: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  rawDeletedAt: Date | null;
}

export interface AnalysisView extends AnalysisSummaryView {
  manifest: SourceManifest | null;
  results: AnalysisResults | null;
  provenance: AnalysisDocument['provenance'];
}
