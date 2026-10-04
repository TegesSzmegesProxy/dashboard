import type { EndpointPolicyV2 } from '../../contracts/policy/v2/policy.contract.js';
import { ObjectId } from 'mongodb';

export type PolicyGenerationKind = 'generate' | 'edit';
export type PolicyGenerationTrigger = 'analysis_completed' | 'dashboard';
export type PolicyGenerationStatus =
  'queued' | 'running' | 'succeeded' | 'failed';

export type PolicyGenerationErrorCode =
  | 'ANALYSIS_UNAVAILABLE'
  | 'BASE_POLICY_UNAVAILABLE'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'REFUSED'
  | 'OUTPUT_TRUNCATED'
  | 'INVALID_OUTPUT'
  | 'SECRET_DETECTED'
  | 'COMPILATION_FAILED'
  | 'UNGROUNDED_OUTPUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'AI_CREDENTIAL_INVALID'
  | 'AI_QUOTA_EXCEEDED'
  | 'INTERNAL_ERROR'
  | 'ATTEMPTS_EXHAUSTED';

export interface StringLengthBounds {
  minLength?: number;
  maxLength?: number;
}

/** Structural change between a base policy and its natural-language edit. */
export interface PolicyDiff {
  addedEndpoints: string[];
  removedEndpoints: string[];
  changedEndpoints: {
    endpoint: string;
    addedTargets: string[];
    removedTargets: string[];
    changedTargets: {
      target: string;
      before: StringLengthBounds;
      after: StringLengthBounds;
    }[];
  }[];
  humanReadableIntentChanged: boolean;
}

/**
 * One request to turn an analysis into a policy, or to edit a policy with a
 * natural-language instruction. It is also the durable job record. A failed
 * attempt never creates a policy version.
 */
export interface PolicyGenerationDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  kind: PolicyGenerationKind;
  trigger: PolicyGenerationTrigger;
  analysisId: ObjectId | null;
  analysisVersion: string | null;
  baseVersion: string | null;
  instruction: string | null;
  /** Dashboard subject or `system:policy-generation`. */
  requestedBy: string;
  /** SHA-256 of the dashboard Idempotency-Key. */
  requestHash?: string;
  payloadHash?: string;
  /** Outbox event that triggered an automatic attempt. */
  sourceEventId?: string;
  status: PolicyGenerationStatus;
  attempts: number;
  availableAt: Date;
  leaseOwner?: string;
  leaseExpiresAt?: Date;
  policyVersion: string | null;
  /** The policy version already existed with identical content. */
  reusedExistingVersion: boolean;
  limitations: string[];
  diff: PolicyDiff | null;
  errorCode: PolicyGenerationErrorCode | null;
  /** Safe message; never contains AI output values or source content. */
  errorMessage: string | null;
  /** Contract paths and rule names only, never offending values. */
  validationIssues: string[];
  provenance: { aiProvider: string | null; aiModel: string | null };
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface PolicyGenerationView {
  id: string;
  organizationId: string;
  tenantId: string;
  kind: PolicyGenerationKind;
  trigger: PolicyGenerationTrigger;
  status: PolicyGenerationStatus;
  analysisId: string | null;
  analysisVersion: string | null;
  baseVersion: string | null;
  instruction: string | null;
  requestedBy: string;
  policyVersion: string | null;
  reusedExistingVersion: boolean;
  limitations: string[];
  diff: PolicyDiff | null;
  errorCode: PolicyGenerationErrorCode | null;
  errorMessage: string | null;
  validationIssues: string[];
  provenance: PolicyGenerationDocument['provenance'];
  precisionWarning: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/**
 * Result of compiling an edited human-readable policy of one endpoint or
 * field. A preview for the policy editor's draft; it creates no version.
 */
export interface CompiledEndpointView {
  endpoint: EndpointPolicyV2;
  /** What the tool registry could not express. */
  limitations: string[];
  /** True while the compiler is a placeholder that does not regenerate tools. */
  mock: boolean;
}
