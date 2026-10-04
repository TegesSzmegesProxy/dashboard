import type {
  ActiveBundleV1Payload,
  BundleRuntimeConfigV1,
  SignedActiveBundleV1,
} from '../v1/bundle.contract.js';

export const BUNDLE_SCHEMA_VERSION_V2 = 'tessera.bundle/v2' as const;

/** Decision settings are explicit; v1's generic failureBehavior cannot supply them. */
export interface BundleRuntimeConfigV2 extends BundleRuntimeConfigV1 {
  decision: {
    sampling: { minN: number; maxN: number };
    jev: {
      attackProbabilityThreshold: number;
      attackProbabilityFloor: number;
      locked: boolean;
    };
    onStaticAnalysisError: 'allow' | 'block';
    onSuspiciousJevUnavailable: 'allow' | 'block';
    onSampledJevUnavailable: 'allow' | 'block';
  };
}

export interface ActiveBundleV2Payload extends Omit<
  ActiveBundleV1Payload,
  'schemaVersion' | 'runtimeConfig'
> {
  schemaVersion: typeof BUNDLE_SCHEMA_VERSION_V2;
  runtimeConfig: BundleRuntimeConfigV2;
}

export interface SignedActiveBundleV2 extends Omit<
  SignedActiveBundleV1,
  'schemaVersion' | 'runtimeConfig'
> {
  schemaVersion: typeof BUNDLE_SCHEMA_VERSION_V2;
  runtimeConfig: BundleRuntimeConfigV2;
}
