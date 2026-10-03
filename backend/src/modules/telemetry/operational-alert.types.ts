import { ObjectId } from 'mongodb';

export type OperationalAlertType =
  | 'proxy_stale'
  | 'proxy_degraded'
  | 'proxy_incompatible'
  | 'bundle_verification_failures'
  | 'jev_unavailable'
  | 'telemetry_quota_exceeded'
  | 'attack_rate_high';

export type OperationalAlertSeverity = 'info' | 'warning' | 'critical';
export type OperationalAlertStatus = 'open' | 'resolved';
export type OperationalAlertDetails = Record<string, string | number>;

/**
 * A notification about operational state, derived from heartbeats and
 * telemetry. Alerts are display state only: they never influence bundle
 * distribution or proxy decisions.
 */
export interface OperationalAlertDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  type: OperationalAlertType;
  /** Proxy instance id for per-instance alerts, otherwise empty. */
  subject: string;
  severity: OperationalAlertSeverity;
  status: OperationalAlertStatus;
  details: OperationalAlertDetails;
  openedAt: Date;
  lastObservedAt: Date;
  resolvedAt: Date | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  /** Resolved alerts are kept for this long. */
  expiresAt: Date | null;
}

export interface AlertSettingsDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  attackRateThreshold: number | null;
  attackRateMinClassified: number | null;
  updatedBy: string;
  updatedAt: Date;
}

export interface OperationalAlertView {
  id: string;
  organizationId: string;
  tenantId: string;
  type: OperationalAlertType;
  subject: string | null;
  severity: OperationalAlertSeverity;
  status: OperationalAlertStatus;
  details: OperationalAlertDetails;
  openedAt: Date;
  lastObservedAt: Date;
  resolvedAt: Date | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
}

export interface AlertSettingsView {
  tenantId: string;
  attackRateThreshold: number | null;
  attackRateMinClassified: number | null;
  updatedBy: string | null;
  updatedAt: Date | null;
}
