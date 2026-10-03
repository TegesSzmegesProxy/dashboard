import { ObjectId } from 'mongodb';
import type {
  BundleSource,
  ProxyHealth,
} from '../../contracts/heartbeat/v1/heartbeat.contract.js';

/** Last reported state of one proxy process for one tenant. */
export interface ProxyHeartbeatDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  apiKeyId: ObjectId;
  instanceId: string;
  proxyVersion: string;
  supportedBundleSchemas: string[];
  supportedToolRegistries: string[];
  health: ProxyHealth;
  bundleSource: BundleSource;
  loadedBundleVersion: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export type ProxyBundleState =
  'no_active_bundle' | 'up_to_date' | 'restart_required' | 'incompatible';

export interface ProxyInstanceView {
  instanceId: string;
  apiKeyId: string;
  proxyVersion: string;
  health: ProxyHealth;
  bundleSource: BundleSource;
  loadedBundleVersion: string | null;
  activeBundleVersion: string | null;
  bundleState: ProxyBundleState;
  restartRequired: boolean;
  stale: boolean;
  supportedBundleSchemas: string[];
  supportedToolRegistries: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
}
