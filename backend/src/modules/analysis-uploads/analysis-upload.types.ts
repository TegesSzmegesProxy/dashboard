import { ObjectId } from 'mongodb';
import type { AnalysisStatus } from '../analyses/analysis.types.js';

export interface AnalysisUploadDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  apiKeyId: ObjectId;
  requestHash: string;
  payloadHash: string;
  schemaVersion: 'tessera.analysis-upload/v1';
  commitSha: string;
  collector: { name: string; version: string };
  redaction: { tool: string; rules: string[]; redactedValueCount: number };
  environmentSummary: {
    tools: { name: string; version: string; status: 'succeeded' | 'failed' }[];
    dependencyCount: number;
    vulnerabilityCount: number;
  };
  analysisId: ObjectId;
  receivedAt: Date;
}

/** Customer-visible manifest of what the collector sent. */
export interface AnalysisUploadView {
  id: string;
  tenantId: string;
  analysisId: string;
  analysisStatus: AnalysisStatus;
  commitSha: string;
  collector: AnalysisUploadDocument['collector'];
  redaction: AnalysisUploadDocument['redaction'];
  environmentSummary: AnalysisUploadDocument['environmentSummary'];
  receivedAt: Date;
}

export interface AnalysisUploadReceipt {
  uploadId: string;
  analysisId: string;
  status: AnalysisStatus;
  duplicate: boolean;
}
