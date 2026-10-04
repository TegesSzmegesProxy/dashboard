import type { PolicyHttpMethod } from '../../policy/v1/policy.contract.js';
import type { BundleSignatureV1 } from '../v1/bundle.contract.js';
import type { BundleRuntimeConfigV2 } from '../v2/bundle.contract.js';

/**
 * `tessera.bundle/v3` (ADR-0021): the decision settings of v2 with a
 * `tessera.policy/v3` policy in global, environment and endpoint scopes, and
 * JEV context. The proxy repository owns the wire schema; this mirrors it.
 */
export const BUNDLE_SCHEMA_VERSION_V3 = 'tessera.bundle/v3' as const;

export interface BundleStepV3 {
  toolId: string;
  contextType: 'field' | 'file' | 'full';
  /** Field tools: `body.x`, `query.x`, or `body.*` / `query.*` in scopes; file tools: the upload field. */
  target?: string;
  config: Record<string, unknown>;
}

export interface BundleScopeV3 {
  steps: BundleStepV3[];
  jevContext: string | null;
}

/** Steps and JEV context only; human-readable policy never reaches a proxy. */
export interface BundlePolicyV3 {
  schemaVersion: 'tessera.policy/v3';
  toolRegistryVersion: 'tessera.tools/v3';
  global: BundleScopeV3;
  environment: BundleScopeV3 & { environmentSnapshotId: string | null };
  endpoints: {
    method: PolicyHttpMethod;
    path: string;
    steps: BundleStepV3[];
    jevContext: string | null;
    fieldContexts: { target: string; jevContext: string }[];
  }[];
}

export interface ActiveBundleV3Payload {
  schemaVersion: typeof BUNDLE_SCHEMA_VERSION_V3;
  tenantId: string;
  /** SHA-256 over canonical {schemaVersion, tenantId, policyVersion, runtimeConfig, policy}. */
  version: string;
  policyVersion: string;
  runtimeConfig: BundleRuntimeConfigV2;
  policy: BundlePolicyV3;
  issuedAt: string;
}

export interface SignedActiveBundleV3 extends ActiveBundleV3Payload {
  signature: BundleSignatureV1;
}
