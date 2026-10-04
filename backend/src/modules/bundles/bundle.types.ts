import { ObjectId } from 'mongodb';
import type {
  BundleSchemaVersion,
  BundleSignatureV1,
  SignedActiveBundleV1,
} from '../../contracts/bundle/v1/bundle.contract.js';
import type { SignedActiveBundleV2 } from '../../contracts/bundle/v2/bundle.contract.js';

/** Immutable signed bundle. `canonicalPayload` holds the exact signed bytes. */
export interface BundleDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  version: string;
  schemaVersion: BundleSchemaVersion;
  policyVersion: string;
  toolRegistryVersion: string;
  canonicalPayload: string;
  signature: BundleSignatureV1;
  issuedAt: Date;
  createdBy: string;
}

export interface ActiveBundlePointerDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  bundleId: ObjectId;
  bundleVersion: string;
  activatedBy: string;
  activatedAt: Date;
}

export interface ActiveBundleSummary {
  version: string;
  schemaVersion: BundleSchemaVersion;
  policyVersion: string;
  toolRegistryVersion: string;
  signingKeyId: string;
  issuedAt: Date;
  activatedAt: Date;
}

export interface ActiveBundleView extends ActiveBundleSummary {
  activatedBy: string;
  /** Tenant runtime configuration was edited after this bundle was built. */
  runtimeConfigurationPending: boolean;
  bundle: SignedActiveBundleV1 | SignedActiveBundleV2;
}

export interface BundleActivationResult {
  bundleVersion: string;
  changed: boolean;
}
