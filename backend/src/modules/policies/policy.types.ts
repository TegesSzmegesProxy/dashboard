import { ObjectId } from 'mongodb';
import type { StructuredPolicyV1Dto } from '../../contracts/policy/v1/policy.contract.js';
import type { StructuredPolicyV2 } from '../../contracts/policy/v2/policy.contract.js';
import type { StructuredPolicyV3 } from '../../contracts/policy/v3/policy.contract.js';
import type {
  CompiledPolicyV1,
  CompiledPolicyV3,
} from '../policy-compiler/policy-compiler.types.js';

export type CompilationStatus = 'compiled' | 'failed';
export type ApprovalStatus =
  'approved' | 'not_applicable' | 'pending' | 'rejected';
export type PolicyLifecycleState =
  | 'ACTIVE'
  | 'APPROVED'
  | 'COMPILATION_FAILED'
  | 'PENDING_APPROVAL'
  | 'REJECTED';

/** How a policy version was produced. Documents without one were imported. */
export type PolicyVersionOrigin =
  | { kind: 'import' }
  | {
      kind: 'generation';
      attemptId: string;
      analysisId: string;
      aiProvider: string;
      aiModel: string;
    }
  | {
      kind: 'edit';
      attemptId: string;
      parentVersion: string;
      analysisId: string | null;
      aiProvider: string;
      aiModel: string;
    };

/** How a `tessera.policy/v2` version was produced (ADR-0014). */
export type PolicyVersionV2Origin =
  | {
      kind: 'analysis';
      analysisId: string;
      aiModel: string | null;
    }
  | {
      /** Saved from the policy editor; `changedEndpoints` are `METHOD path`. */
      kind: 'draft';
      parentVersion: string;
      analysisId: string | null;
      changedEndpoints: string[];
    };

/** Who approved a version: a reviewer, or the standing approval of ADR-0018. */
export type ApprovalSource = 'manual' | 'auto_apply';

/** Something a reviewer should look at before approving; never a value. */
export interface ReviewWarning {
  /**
   * `jev_context` and `scope_override` are recomputed for every version;
   * `analysis` is inherited.
   */
  kind: 'analysis' | 'jev_context' | 'scope_override';
  /** `METHOD path` of the endpoint, or `global` / `environment` for a scope. */
  endpoint: string;
  /** `location:name` of the field, or null for the endpoint itself. */
  field: string | null;
  message: string;
}

export interface PolicyVersionV2Document {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  version: string;
  schemaVersion: 'tessera.policy/v2';
  toolRegistryVersion: 'tessera.tools/v2';
  structuredPolicy: StructuredPolicyV2;
  compilationStatus: CompilationStatus;
  /** Contract paths of compilation failures; empty when compiled. */
  compilationIssues: string[];
  reviewWarnings: ReviewWarning[];
  /** Some human-readable policy text was written or rewritten by AI. */
  aiWritten: boolean;
  approvalStatus: ApprovalStatus;
  approvalSource?: ApprovalSource;
  rejectionReason?: string;
  origin: PolicyVersionV2Origin;
  createdBy: string;
  createdAt: Date;
  lifecycleUpdatedAt: Date;
}

/** A `tessera.policy/v3` version (ADR-0021): scoped policies with tool configurations. */
export interface PolicyVersionV3Document {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  version: string;
  schemaVersion: 'tessera.policy/v3';
  toolRegistryVersion: 'tessera.tools/v3';
  structuredPolicy: StructuredPolicyV3;
  /** The steps and JEV context a bundle carries; absent when compilation failed. */
  compiledPolicy?: CompiledPolicyV3;
  compilationStatus: CompilationStatus;
  /** Contract paths of compilation failures; empty when compiled. */
  compilationIssues: string[];
  reviewWarnings: ReviewWarning[];
  /** Some human-readable policy text was written or rewritten by AI. */
  aiWritten: boolean;
  approvalStatus: ApprovalStatus;
  approvalSource?: ApprovalSource;
  rejectionReason?: string;
  origin: PolicyVersionV2Origin;
  createdBy: string;
  createdAt: Date;
  lifecycleUpdatedAt: Date;
}

export type PolicyVersionDocument =
  PolicyVersionV1Document | PolicyVersionV2Document | PolicyVersionV3Document;

export interface PolicyVersionV1Document {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  version: string;
  schemaVersion: 'tessera.policy/v1';
  toolRegistryVersion: 'tessera.tools/v1';
  humanReadableIntent: string;
  structuredPolicy: StructuredPolicyV1Dto;
  compiledPolicy?: CompiledPolicyV1;
  compilationStatus: CompilationStatus;
  compilationError?: {
    code: 'INVALID_TOOL_CONFIG' | 'UNKNOWN_TOOL';
    message: string;
  };
  approvalStatus: ApprovalStatus;
  rejectionReason?: string;
  origin?: PolicyVersionOrigin;
  createdBy: string;
  createdAt: Date;
  lifecycleUpdatedAt: Date;
}

export interface ActivePolicyPointerDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  policyVersion: string;
  activatedBy: string;
  activatedAt: Date;
}

export type PolicyVersionView =
  PolicyVersionV1View | PolicyVersionV2View | PolicyVersionV3View;

export interface PolicyVersionV3View {
  id: string;
  organizationId: string;
  tenantId: string;
  version: string;
  schemaVersion: 'tessera.policy/v3';
  toolRegistryVersion: 'tessera.tools/v3';
  structuredPolicy: StructuredPolicyV3;
  compiledPolicy: CompiledPolicyV3 | null;
  compilationStatus: CompilationStatus;
  compilationIssues: string[];
  reviewWarnings: ReviewWarning[];
  approvalStatus: ApprovalStatus;
  approvalSource: ApprovalSource | null;
  rejectionReason: string | null;
  state: PolicyLifecycleState;
  origin: PolicyVersionV2Origin;
  precisionWarning: string | null;
  /** Compiled and approved: activation builds a `tessera.bundle/v3`. */
  activatable: boolean;
  createdBy: string;
  createdAt: Date;
  lifecycleUpdatedAt: Date;
}

export interface PolicyVersionV2View {
  id: string;
  organizationId: string;
  tenantId: string;
  version: string;
  schemaVersion: 'tessera.policy/v2';
  toolRegistryVersion: 'tessera.tools/v2';
  structuredPolicy: StructuredPolicyV2;
  compilationStatus: CompilationStatus;
  compilationIssues: string[];
  reviewWarnings: ReviewWarning[];
  approvalStatus: ApprovalStatus;
  approvalSource: ApprovalSource | null;
  rejectionReason: string | null;
  state: PolicyLifecycleState;
  origin: PolicyVersionV2Origin;
  precisionWarning: string | null;
  /** False until a bundle schema carries policy v2 (ADR-0014). */
  activatable: boolean;
  createdBy: string;
  createdAt: Date;
  lifecycleUpdatedAt: Date;
}

export interface PolicyVersionV1View {
  id: string;
  organizationId: string;
  tenantId: string;
  version: string;
  schemaVersion: 'tessera.policy/v1';
  toolRegistryVersion: 'tessera.tools/v1';
  humanReadableIntent: string;
  structuredPolicy: StructuredPolicyV1Dto;
  compiledPolicy: CompiledPolicyV1 | null;
  compilationStatus: CompilationStatus;
  compilationError: PolicyVersionV1Document['compilationError'] | null;
  approvalStatus: ApprovalStatus;
  rejectionReason: string | null;
  state: PolicyLifecycleState;
  origin: PolicyVersionOrigin;
  /** Set for AI-produced versions; reviewers must see it before approval. */
  precisionWarning: string | null;
  createdBy: string;
  createdAt: Date;
  lifecycleUpdatedAt: Date;
}
