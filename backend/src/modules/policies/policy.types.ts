import { ObjectId } from 'mongodb';
import type { StructuredPolicyV1Dto } from '../../contracts/policy/v1/policy.contract.js';
import type { CompiledPolicyV1 } from '../policy-compiler/policy-compiler.types.js';

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

export interface PolicyVersionDocument {
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

export interface PolicyVersionView {
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
  compilationError: PolicyVersionDocument['compilationError'] | null;
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
