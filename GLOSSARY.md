# Tessera glossary

- **Organization**: a customer account in the hosted control plane. It owns
  users, projects, credentials, and billing/administrative context.
- **Project**: the dashboard-facing name for one protected application. In
  cross-system contracts and backend domain code, use **tenant**.
- **Tenant**: one protected application and its isolated configuration,
  policies, analyses, bundles, and telemetry. All tenant-owned data also
  belongs to an organization.
- **Control plane**: this hosted repository's frontend and backend. It manages
  configuration and lifecycle operations but is never in the protected
  application's request path.
- **Proxy (data plane)**: the customer-deployed enforcement process that
  analyzes requests and forwards only allowed traffic to the upstream.
- **Upstream**: the protected application behind the proxy.
- **Collector**: a customer-side CI step or CLI that gathers and redacts source
  and environment context before uploading it.
- **Analysis**: an immutable, versioned interpretation of a collector upload,
  including API surface, dependencies, CVEs, environment, and findings with
  provenance.
- **Policy version**: immutable human intent plus its validated structured form
  and compilation state. Editing creates a new version.
- **Compiled policy**: a policy translated into registered proxy tool IDs and
  validated tool configuration. It is not executable application code.
- **Active bundle**: the signed, immutable unit distributed to a proxy. It
  combines one tenant's runtime configuration and compiled policy under one
  version.
- **Active version**: the bundle selected by the control plane for distribution.
  It can differ from the version currently loaded by a running proxy.
- **Loaded version**: the verified bundle currently used by a proxy process.
- **Last known good**: the most recent bundle a proxy successfully verified and
  persisted for use during control-plane outages or invalid pulls.
- **Deployment key**: a revocable credential used by a proxy to pull bundles
  for an explicit set of tenants and report health/telemetry.
- **Collector key**: a revocable credential limited to analysis uploads for an
  explicit set of tenants.
- **Activation**: the atomic selection of an approved, successfully compiled
  version for distribution. Saving, generating, or approving alone is not
  activation.
- **JEV**: an external classification model used by the proxy for selected
  runtime decisions. It is not the model used to generate or edit policies.
- **Telemetry**: best-effort redacted proxy health and aggregate decision data.
  It excludes raw request bodies, field values, authorization headers, and
  cookies.
- **Failure behavior**: explicit tenant configuration for a security-relevant
  failure. Do not silently substitute a fail-open or fail-closed default.

