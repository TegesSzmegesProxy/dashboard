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
- **Policy scope**: where a rule of a `tessera.policy/v3` version applies:
  `global`, `environment` or one endpoint. When a tool and target appear in
  more than one scope, the most specific one runs (ADR-0021).
- **Global policy**: the scope for rules derived from code that shapes the
  whole application (middleware, parsers, framework limits). It applies to
  every request, including endpoints no endpoint policy lists.
- **Environment policy**: the scope for rules derived from an environment
  snapshot (scanner findings, vulnerable packages, exposed services). It
  applies to every request and records the snapshot it came from.
- **Tool configuration**: the settings of one selected tool, validated
  against the tool's schema in `tessera.tools/v3`. An empty configuration
  uses the proxy's defaults.
- **Operator-configured tool**: a tool whose configuration is secret material
  or a data feed (keys, cookie secrets, GeoIP or reputation tables). No
  policy may select it; it is configured with the proxy deployment.
- **Human-readable policy**: the administrator-editable plain-language
  description of one endpoint policy or one of its fields. It is never
  enforced. Editing it compiles it into that endpoint's structured policy,
  which the administrator accepts into a policy draft.
- **Policy draft**: a local, unsaved set of changes to a policy version made
  in the policy editor: human-readable policies, tools and JEV context of
  existing endpoints and fields. Saving it creates one new pending policy
  version; the drafted-from version never changes.
- **Policy review mode**: chosen per analysis before it runs. `review` leaves
  the proposed policy version pending; `auto_apply` approves it as a standing
  approval when it compiled and nothing needs review (ADR-0018).
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
- **Runtime decision settings**: the tenant's explicit sampling bounds, JEV
  threshold and floor, and separate actions for static-analysis errors and
  unavailable JEV. They travel in bundle v2; `failureBehavior` alone does not
  define them. Bundle v3 carries them unchanged.
- **Active version**: the bundle selected by the control plane for distribution.
  It can differ from the version currently loaded by a running proxy.
- **Loaded version**: the verified bundle currently used by a proxy process.
- **Policy fetch**: `tessera fetch`, the operator command that pulls the
  active bundle, verifies it, builds its tools and stores it in the proxy's
  Redis. It is the only way a proxy obtains a bundle (ADR-0021).
- **Restart required**: a proxy state shown in the dashboard when a compatible
  proxy's loaded version differs from the active version. A running proxy
  switches to a fetched bundle by itself, unless the bundle changes the
  upstream; then a restart applies it.
- **Heartbeat**: a proxy's periodic report of its loaded versions, supported
  bundle schemas and tool registries, and health. It is display state only.
- **Last known good**: the most recent bundle a policy fetch verified and
  stored in the proxy's Redis. The proxy runs it during control-plane outages,
  and a failed fetch never replaces it.
- **Deployment key**: a revocable credential used by a proxy to pull bundles
  for an explicit set of tenants and report health/telemetry.
- **Collector key**: a revocable credential limited to analysis uploads for an
  explicit set of tenants.
- **Activation**: the atomic selection of an approved, successfully compiled
  version for distribution. Saving, generating, or approving alone is not
  activation.
- **JEV**: an external classification model used by the proxy for selected
  runtime decisions. It is not the model used to generate or edit policies.
- **JEV credential**: the organization's write-only JEV API key, stored
  encrypted and pulled by proxies with the `jev-credentials:read` deployment
  scope. It is never part of a bundle.
- **Analysis AI model**: the model analyses and policy edits use. The
  deployment sets it in its environment (ADR-0019); it is not stored in the
  database or editable in the dashboard, and its key is never sent to
  proxies or included in a bundle.
- **Dashboard-started analysis**: an analysis of the head of the bound
  repository's default branch, started from the dashboard instead of by a
  collector upload.
- **Tuning settings**: a project's stored model settings, policy defaults and
  endpoint overrides. They are inputs only: saving them creates no policy
  version and changes no bundle (ADR-0011).
- **Model settings**: a project's context length (most recent requests given
  to the model) and sampling parameters (`temperature`, `topP`, `maxTokens`).
- **Policy defaults**: a project's default policy action (`allow`, `review`,
  `block`), free-text constraints and trigger threshold for every endpoint.
- **Endpoint override**: a per-endpoint (method and path) request policy,
  threshold and per-field rules that take precedence over the policy defaults.
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
