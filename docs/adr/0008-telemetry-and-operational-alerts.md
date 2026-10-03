# 0008: Telemetry contract, retention and operational alerts

## Status

Accepted

## Context

Phase 7 adds proxy telemetry and operational views. The proxy references
describe telemetry only loosely ("counts per verdict, recent BLOCK summaries,
active version, degraded state"). They require it to be best-effort,
off the request path and redacted. The wire format, what may identify an
endpoint, retention, quotas and alert delivery were undecided. Raw request
paths can contain identifiers or tokens, so even endpoint names are
sensitive.

## Decision

- **Contract** `tessera.telemetry/v1`, sent to `POST /api/v1/proxy/telemetry`
  with a deployment key holding `telemetry:write`. A batch has an
  `instanceId`, a random `batchId` (reused on retry) and up to 1,440
  one-minute UTC windows. Each window names the tenant and the loaded
  `bundleVersion` (or null). It also carries per-endpoint counters
  (ALLOW/BLOCK decisions, static verdicts, SAFE requests sampled, JEV
  ATTACK/BENIGN/unavailable, failure behavior applied), the end-of-window
  sampling rate and attack-rate EWMA gauges, and tenant events (bundle
  verification failures, pull failures, dropped windows). The contract has
  no free-text fields.
- **Endpoint identity**: an endpoint key must be a `METHOD /path` key from the
  compiled policy of the bundle version the window reports. Traffic matching
  no policy endpoint is reported once with `endpoint: null`. Raw request
  paths are never accepted or stored.
- **Validation**: windows must be minute-aligned, at most 24 hours old and
  at most 2 minutes in the future. Counters must be internally consistent
  (verdicts and JEV results cannot exceed decisions). A batch has at most
  5,000 endpoint entries. Any violation rejects the whole batch with 422.
  The proxy drops a batch on 4xx and may retry 429/5xx with the same
  `batchId`; a repeated `batchId` is applied once.
- **Storage and retention**: counters are merged with `$inc` into one-minute
  buckets kept 48 hours and hourly buckets kept 90 days, removed by TTL
  indexes. Gauges are stored as sums and counts so that several proxy
  instances average correctly.
- **Quota**: each tenant accepts `TELEMETRY_QUOTA_ENTRIES_PER_TENANT_HOUR`
  endpoint-window entries per hour (default 100,000). A batch over the quota
  is rejected with 429 and nothing from it is stored. The rejection is
  counted for alerting. The quota lives in MongoDB, so it does not depend on
  Redis.
- **Alerts** are dashboard-only. A per-instance evaluator reconciles alerts
  every minute: stale, degraded, last-known-good, bundle-less and
  incompatible proxies; bundle verification failures and JEV unavailability
  in the last 15 minutes; quota rejections this hour; and an attack-rate
  alert. Alerts open and resolve automatically, can be acknowledged by
  owners and admins, and emit `OperationalAlertOpened`/`Resolved` outbox
  events so that email or webhook delivery can be added without changing the
  evaluator. Resolved alerts are kept 90 days.
- **Attack-rate alert** is opt-in per project. It has a threshold (ATTACK
  share of JEV-classified requests in the last hour) and a minimum number of
  classified requests, set together. There is no default.
- **Isolation**: telemetry intake, queries and alert evaluation share no
  code path with bundle distribution or activation and never write to their
  collections.

## Consequences

Telemetry is useful only for endpoints that exist in the loaded policy;
everything else is one aggregate bucket by design. A proxy whose bundle the
control plane no longer stores cannot report endpoint detail. Old minute data
is not backfilled into hourly buckets beyond 24 hours. Alert delivery outside
the dashboard and alert thresholds other than attack rate remain future
decisions. The proxy must implement this contract; until it does, Phase 7 is
verified only against the control-plane side.
