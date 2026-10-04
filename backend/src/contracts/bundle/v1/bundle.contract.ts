import type {
  POLICY_SCHEMA_VERSION,
  PolicyHttpMethod,
  TOOL_REGISTRY_VERSION,
} from '../../policy/v1/policy.contract.js';

export const BUNDLE_SCHEMA_VERSION = 'tessera.bundle/v1' as const;
export const BUNDLE_SIGNATURE_ALGORITHM = 'Ed25519' as const;

/** Bundle schemas this control plane can serve, newest first. */
export const SUPPORTED_BUNDLE_SCHEMAS = [
  'tessera.bundle/v2',
  BUNDLE_SCHEMA_VERSION,
] as const;
export type BundleSchemaVersion = (typeof SUPPORTED_BUNDLE_SCHEMAS)[number];

/** Request header listing every bundle schema the proxy can verify. */
export const BUNDLE_SCHEMAS_HEADER = 'tessera-bundle-schemas';
/** Request header listing every tool registry the proxy can execute. */
export const TOOL_REGISTRIES_HEADER = 'tessera-tool-registries';
/** Response header naming the schema of the returned bundle. */
export const BUNDLE_SCHEMA_RESPONSE_HEADER = 'tessera-bundle-schema';

export type BundleRuntimeBehaviorV1 = 'allow' | 'block';

export interface BundleRuntimeConfigV1 {
  upstreamUrl: string;
  failureBehavior: BundleRuntimeBehaviorV1;
  unknownEndpointBehavior: BundleRuntimeBehaviorV1;
  routing: { pathPrefix: string };
  thresholds: {
    requestTimeoutMs: number;
    maxRequestBodyBytes: number;
  };
  samplingRate: number;
}

export interface BundleToolStepV1 {
  toolId: 'string_length';
  contextType: 'field';
  target: string;
  config: { minLength?: number; maxLength?: number };
}

export interface BundlePolicyV1 {
  schemaVersion: typeof POLICY_SCHEMA_VERSION;
  toolRegistryVersion: typeof TOOL_REGISTRY_VERSION;
  endpoints: {
    method: PolicyHttpMethod;
    path: string;
    steps: BundleToolStepV1[];
  }[];
}

/**
 * Signed content. The signature covers the RFC 8785 canonical JSON UTF-8
 * bytes of this object, i.e. every bundle field except `signature`.
 */
export interface ActiveBundleV1Payload {
  schemaVersion: typeof BUNDLE_SCHEMA_VERSION;
  tenantId: string;
  /** SHA-256 over canonical {schemaVersion, tenantId, policyVersion, runtimeConfig, policy}. */
  version: string;
  policyVersion: string;
  runtimeConfig: BundleRuntimeConfigV1;
  policy: BundlePolicyV1;
  issuedAt: string;
}

export interface BundleSignatureV1 {
  algorithm: typeof BUNDLE_SIGNATURE_ALGORITHM;
  /** Hex SHA-256 of the signer's SPKI DER public key, truncated to 32 chars. */
  keyId: string;
  /** Base64url Ed25519 signature without padding. */
  value: string;
}

export interface SignedActiveBundleV1 extends ActiveBundleV1Payload {
  signature: BundleSignatureV1;
}
