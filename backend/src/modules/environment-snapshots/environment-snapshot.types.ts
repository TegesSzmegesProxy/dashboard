import { ObjectId } from 'mongodb';
import type {
  ENVIRONMENT_SCHEMA_VERSION,
  EnvironmentRuns,
  EnvironmentTool,
} from '../../contracts/environment/v1/environment.contract.js';

export type ToolRunStatus = 'ok' | 'failed' | 'skipped';

/** Shown wherever an analysis has no environment context (ADR-0016). */
export const ENVIRONMENT_MISSING_NOTICE =
  'No environment snapshot exists for this project. Run `tessera -get-environment` ' +
  'to add environment context (httpx, Lynis, nmap, nuclei, Trivy). It can take ' +
  'several minutes because nmap scans are slow. Analyses still run without it.';

/** One immutable, redacted `tessera -get-environment` result. */
export interface EnvironmentSnapshotDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  apiKeyId: ObjectId;
  requestHash: string;
  payloadHash: string;
  schemaVersion: typeof ENVIRONMENT_SCHEMA_VERSION;
  collectionStartedAt: Date;
  collectionCompletedAt: Date;
  receivedAt: Date;
  runs: EnvironmentRuns;
  toolStatus: Record<EnvironmentTool, ToolRunStatus>;
  /** Values the server redacted although the collector should have. */
  redactedValueCount: number;
}

export interface EnvironmentSnapshotSummary {
  id: string;
  tenantId: string;
  collectionCompletedAt: Date;
  receivedAt: Date;
  toolStatus: Record<EnvironmentTool, ToolRunStatus>;
  counts: {
    openPorts: number;
    nucleiFindings: number;
    vulnerabilities: number;
    misconfigurations: number;
    secretFindings: number;
    httpTargets: number;
  };
  redactedValueCount: number;
}

export interface EnvironmentSnapshotView extends EnvironmentSnapshotSummary {
  runs: EnvironmentRuns;
}

export interface ProjectEnvironmentStatus {
  available: boolean;
  latest: EnvironmentSnapshotSummary | null;
  /** Age of the latest snapshot in whole hours. */
  ageHours: number | null;
  notice: string | null;
}

export interface EnvironmentSnapshotReceipt {
  snapshotId: string;
  duplicate: boolean;
}
