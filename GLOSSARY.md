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
- **Collector**: a customer-side CI step or CLI that runs environment tools
  (for example Syft and Trivy), redacts their output, and uploads it with the
  commit SHA to analyze. It never uploads source files.
- **Repository binding**: the one GitHub repository an organization
  administrator assigns to a project. Analysis source always comes from it.
- **Analysis sandbox**: the disposable, network-less container in which one
  analysis extracts and indexes the repository. It is destroyed when the
  analysis ends; the model reaches its content only through read-only tools.
- **AI read manifest**: the customer-visible record of exactly which paths and
  line ranges an analysis sent to the AI provider, and how many values were
  redacted in them. It replaces the earlier source manifest.
- **Analysis**: an immutable, versioned interpretation of a collector upload
  and the bound repository at its commit,
  including API surface, dependencies, CVEs, environment, and findings with
  provenance.
- **Environment snapshot**: one immutable, redacted result of
  `tessera -get-environment` (httpx, Lynis, nmap, nuclei, Trivy) for a tenant,
  uploaded with a collector key. Analyses use the latest one; without one they
  run without environment context and say so.
- **Work item**: one candidate route (or suspected dynamic registration) that
  an analysis must resolve as an endpoint with evidence, not an endpoint with a
  reason, or unresolved.
- **Coverage gate**: the rule that every work item is resolved explicitly; any
  unresolved item makes the analysis `partial` instead of silently omitting it.
- **Application dossier**: the short, fixed summary of an application
  (frameworks, global middleware, auth, prefixes, conventions) that every
  analysis agent receives.
- **Route rule**: a structural or regex pattern written by the recon agent that
  describes how one application registers routes; the sandbox applies it to the
  whole repository to enumerate work items.
- **Framework pack**: optional framework-specific extractors that add exact
  routes and validator hints. Analysis works without one.
- **Language tier**: how precisely a file can be indexed: text only,
  syntax-aware (tree-sitter), framework pack, or type-accurate indexer.
- **Policy version**: immutable human intent plus its validated structured form
  and compilation state. Editing creates a new version.
- **Endpoint policy**: one endpoint of a policy version: its endpoint-level
  tools, JEV context, fields and human-readable policy.
- **Human-readable policy**: the administrator-editable plain-language
  description of one endpoint policy. It is never enforced; editing it
  regenerates that endpoint's structured policy as a new pending version.
- **JEV context**: bounded free text on an endpoint or field that tells JEV
  what the element is for and what legitimate input looks like. It is derived
  from untrusted repository content, reviewed with the policy, and given to
  JEV as data, never as instructions.
- **Policy generation attempt**: one durable request to apply a
  natural-language edit to one endpoint of a policy version (earlier attempts
  also generated whole policies from an analysis).
  It succeeds with a pending policy version or fails; a failed attempt never
  creates a policy version.
- **Precision warning**: the fixed notice shown with every AI-generated or
  AI-edited policy version that natural language is imprecise and that the
  reviewed structured policy, not the text, is what gets enforced.
- **Compiled policy**: a policy translated into registered proxy tool IDs and
  validated tool configuration. It is not executable application code.
- **Tool registry**: a versioned allowlist of proxy tool IDs, context types,
  and configuration contracts that the control plane may compile. An unknown
  tool is a compilation failure, never executable input.
- **Active bundle**: the signed, immutable unit distributed to a proxy. It
  combines one tenant's runtime configuration and compiled policy under one
  version.
- **Active version**: the bundle selected by the control plane for distribution.
  It can differ from the version currently loaded by a running proxy.
- **Loaded version**: the verified bundle currently used by a proxy process.
- **Restart required**: a proxy state shown in the dashboard when a compatible
  proxy's loaded version differs from the active version. Proxies never
  hot-swap bundles; a restart loads the active version.
- **Heartbeat**: a proxy's periodic report of its loaded versions, supported
  bundle schemas and tool registries, and health. It is display state only.
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
- **Telemetry window**: one UTC minute of a proxy's counters and gauges for
  one tenant, reported against the bundle version it had loaded.
- **Unmatched traffic**: requests that matched no endpoint of the loaded
  policy. Telemetry reports them as one aggregate and never by raw path.
- **Attack rate**: the share of JEV-classified requests classified as
  `ATTACK`. The proxy also reports its smoothed EWMA as a gauge.
- **Operational alert**: a dashboard notification derived from heartbeats
  and telemetry. It opens and resolves automatically and never affects
  distribution or enforcement.
- **Failure behavior**: explicit tenant configuration for a security-relevant
  failure. Do not silently substitute a fail-open or fail-closed default.
