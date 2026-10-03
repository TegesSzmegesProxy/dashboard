import { ObjectId } from 'mongodb';

/** Bucket key for requests that matched no policy endpoint. */
export const UNMATCHED_ENDPOINT = '*';
/** Bucket key for tenant-level events and gauges. */
export const TENANT_SCOPE = '#tenant';

export type TelemetryGranularity = 'minute' | 'hour';

export const TELEMETRY_BUCKET_COLLECTIONS: Record<
  TelemetryGranularity,
  string
> = {
  minute: 'telemetryMinuteBuckets',
  hour: 'telemetryHourBuckets',
};
export const TELEMETRY_QUOTA_COLLECTION = 'telemetryQuotas';

/** Additive counters; every bucket field is merged with `$inc`. */
export interface TelemetryCounters {
  requests: number;
  allow: number;
  block: number;
  safe: number;
  suspicious: number;
  policyViolation: number;
  error: number;
  sampledSafe: number;
  jevAttack: number;
  jevBenign: number;
  jevUnavailable: number;
  failureBehaviorApplied: number;
  bundleVerificationFailures: number;
  bundlePullFailures: number;
  droppedWindows: number;
  /** Gauges are kept as sums and counts so instances can be averaged. */
  samplingRateSum: number;
  samplingRateCount: number;
  attackRateEwmaSum: number;
  attackRateEwmaCount: number;
}

export const TELEMETRY_COUNTER_FIELDS = [
  'requests',
  'allow',
  'block',
  'safe',
  'suspicious',
  'policyViolation',
  'error',
  'sampledSafe',
  'jevAttack',
  'jevBenign',
  'jevUnavailable',
  'failureBehaviorApplied',
  'bundleVerificationFailures',
  'bundlePullFailures',
  'droppedWindows',
  'samplingRateSum',
  'samplingRateCount',
  'attackRateEwmaSum',
  'attackRateEwmaCount',
] as const satisfies readonly (keyof TelemetryCounters)[];

/** Aggregated redacted telemetry for one tenant, window and endpoint key. */
export interface TelemetryBucketDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  windowStart: Date;
  /** Policy endpoint key, `UNMATCHED_ENDPOINT`, or `TENANT_SCOPE`. */
  endpoint: string;
  counters: TelemetryCounters;
  updatedAt: Date;
  expiresAt: Date;
}

/** Retry receipt; a batch id is applied at most once per credential. */
export interface TelemetryBatchReceiptDocument {
  _id: ObjectId;
  apiKeyId: ObjectId;
  batchId: string;
  receivedAt: Date;
  expiresAt: Date;
}

export interface TelemetryQuotaDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  hourStart: Date;
  entries: number;
  rejectedBatches: number;
  expiresAt: Date;
}

export interface TelemetryTotalsView {
  requests: number;
  decisions: { allow: number; block: number };
  staticVerdicts: {
    safe: number;
    suspicious: number;
    policyViolation: number;
    error: number;
  };
  jev: {
    sampledSafe: number;
    attack: number;
    benign: number;
    unavailable: number;
  };
  failureBehaviorApplied: number;
  /** ATTACK share of JEV-classified requests; null without classifications. */
  attackRate: number | null;
  /** Share of SAFE requests sent to JEV; null without SAFE requests. */
  observedSamplingRate: number | null;
  /** Average of the sampling rate proxies reported. */
  reportedSamplingRate: number | null;
  /** Average of the attack-rate EWMA proxies reported. */
  attackRateEwma: number | null;
}

export interface TelemetrySeriesPointView extends TelemetryTotalsView {
  windowStart: Date;
  events: {
    bundleVerificationFailures: number;
    bundlePullFailures: number;
    droppedWindows: number;
  };
}

export interface TelemetryEndpointSummaryView extends TelemetryTotalsView {
  /** Policy endpoint key, or null for requests that matched none. */
  endpoint: string | null;
}

export interface TelemetrySummaryView {
  tenantId: string;
  granularity: TelemetryGranularity;
  from: Date;
  to: Date;
  totals: TelemetryTotalsView;
  events: TelemetrySeriesPointView['events'];
  series: TelemetrySeriesPointView[];
  /** Busiest endpoints first, at most 50. */
  endpoints: TelemetryEndpointSummaryView[];
}
