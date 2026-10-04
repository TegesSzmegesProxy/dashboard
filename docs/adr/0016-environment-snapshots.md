# 0016: Environment snapshots

## Status

Accepted

## Context

Analyses need to know the application's runtime environment: exposed
services, technologies, known vulnerabilities and scanner findings. The
customer collects it with `tessera -get-environment`, which runs httpx,
Lynis, nmap, nuclei and Trivy inside the customer's environment. The control
plane must never scan or connect into that environment. Scanner output can
contain attacker-controlled text.

## Decision

- **Contract.** The collector sends one `tessera.environment/v1` snapshot,
  which mirrors the collector's `EnvironmentAnalysisResult`, to
  `POST /api/v1/tenants/:tenantId/environment-snapshots`.
  - It requires a collector key with the `environment-snapshots:write` scope
    that is assigned to the tenant, and an `Idempotency-Key`.
  - The tenant comes from the route and the key. A payload `tenantId` that
    differs is rejected.
- **Validation.** Strict, per tool: `ok`, `failed` or `skipped`, with bounded
  strings and arrays and a total size limit.
- **Redaction.** Detectable credentials in any text are redacted on the server
  before storage, even though the collector already omits bodies and secret
  text.
- **Storage.** Snapshots are immutable MongoDB documents scoped by
  organization and tenant. The latest N per tenant are kept
  (`ENVIRONMENT_SNAPSHOTS_RETAINED`, default 10); older ones are deleted when a
  new snapshot arrives.
- **Use.** An analysis uses the tenant's latest snapshot and records its ID and
  age.
  - Without one, the analysis still runs. The environment step is
    `ENVIRONMENT_NOT_COLLECTED`, and the user is told to run
    `tessera -get-environment`, which can take several minutes because nmap
    scans are slow.
  - Old snapshots are shown with their age, not refused.
- **Trust.**
  - Only typed, bounded, redacted fields reach the model, never raw scanner
    output.
  - Lynis audits the machine the command ran on, so it is host context only
    and never justifies a request tool.
  - Trivy secret findings reach the model only as counts by rule.
  - Failed or skipped tools are reported as unknown, never as clean.

## Consequences

Environment collection stays entirely customer-side and can run on its own
schedule. Analyses get runtime evidence (for example, paths that scanners saw
but code analysis missed) without the control plane touching the customer
network. Snapshot freshness is the customer's responsibility; the dashboard
makes its age visible.
