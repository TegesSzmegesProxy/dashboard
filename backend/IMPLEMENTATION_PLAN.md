# Tessera Control Plane Backend — implementation plan

## 1. Scope and boundaries

This service is the hosted control plane. It manages configuration and
distributes signed, immutable bundles. It is not in the protected
application's request path and must not make runtime ALLOW/BLOCK decisions.

Three API surfaces live in one modular monolith initially:

1. Dashboard API authenticated with a user session or access token.
2. Collector API authenticated with a collector key.
3. Proxy distribution and telemetry API authenticated with a deployment key.

The proxy always initiates communication. The control plane never connects to
the customer's network. An unavailable control plane must not interrupt a
proxy that already has a valid bundle.

## 2. Target module layout

```text
src/
  common/                 shared HTTP, errors, logging, crypto primitives
  infrastructure/         MongoDB, Redis, jobs, object storage, AI adapters
  modules/
    auth/                  dashboard identity, sessions, guards
    organizations/         organizations, memberships, roles
    projects/              tenant metadata and runtime configuration
    api-keys/              deployment and collector keys
    analysis-uploads/      redacted collector packages
    analyses/              application analysis and findings
    policies/              drafts and immutable versions
    policy-generation/     provider-independent AI generation
    policy-compiler/       structured policy to registered toolchain
    approvals/             approve/reject workflow
    bundles/               activation, signing and distribution
    telemetry/             redacted summaries and proxy health
    audit/                 immutable administrative audit trail
    health/                liveness and readiness
```

Modules expose application services, not persistence models. Cross-module
workflows use explicit domain events with a transactional outbox. Controllers
perform transport validation and delegate business behavior.

## 3. Core data model

All tenant-owned records carry both `organizationId` and `tenantId`. Access is
derived from the authenticated principal; a client-provided tenant id is never
trusted as authorization.

- `Organization`: name, status, timestamps.
- `UserMembership`: user, organization, role (`owner`, `admin`, `viewer`).
- `Tenant`: project identity, routing, upstream, failure behavior, thresholds,
  unknown-endpoint behavior.
- `ApiKey`: hash, type, scopes, organization, allowed tenants, timestamps,
  revocation state. Plaintext is returned once.
- `AnalysisUpload`: source revision, schema version, object-storage reference,
  redaction manifest and processing state.
- `Analysis`: immutable version, API surface, dependencies, CVEs, environment,
  findings and source attribution.
- `PolicyVersion`: immutable human intent, structured intent, compilation state,
  toolchain, content hash and approval state.
- `ActiveBundle`: schema version, runtime configuration, compiled policy,
  signature, activation time and content hash.
- `ProxyHeartbeat`: deployment, loaded bundle versions, supported schema/tools,
  health and last-seen time.
- `TelemetryBucket`: redacted aggregate counters; never raw request bodies,
  field values, authorization headers or cookies.
- `AuditEntry`: actor, action, target, timestamp and safe metadata.

## 4. Persistence and infrastructure

- MongoDB is authoritative for organizations, tenants, keys, analyses,
  policies, bundles, telemetry metadata and audit records.
- Redis is non-authoritative and supports queues, rate limiting, idempotency,
  caching and outbox delivery coordination.
- Large collector uploads belong in object storage; MongoDB stores metadata and
  a content hash.
- Signing uses Ed25519. The private key comes from a secret manager or
  deployment secret and is never stored in MongoDB.
- External AI access is hidden behind a provider-independent interface with
  schema-validated structured output.
- Cross-repository wire contracts are published as a separately versioned
  `@tessera/contracts` package. The proxy must not import dashboard internals.

## 5. API conventions

- Version all external routes under `/api/v1` or `/v1`.
- Use DTO validation at every boundary and RFC 9457-compatible problem details
  for errors.
- Require idempotency keys for collector uploads, policy generation, approval,
  activation and key rotation.
- Use cursor pagination for lists.
- Add request ids and structured logs; redact credentials and customer payloads.
- Maintain separate guards for dashboard users, collector keys and deployment
  keys.
- Generate OpenAPI documentation from controllers and DTOs.

## 6. Delivery phases

### Phase 0 — foundation

- Keep the current NestJS bootstrap, configuration validation and health route.
- Add MongoDB and Redis adapters with readiness checks.
- Add structured logging, request ids, global exception mapping and API
  versioning conventions.
- Add Docker Compose for local MongoDB and Redis.
- Add CI checks: format, lint, typecheck and build.

Exit criteria: the service starts from validated configuration, reports
liveness/readiness and passes all checks in CI.

### Phase 1 — identity and tenant isolation

- Decide the dashboard identity provider and token/session model.
- Implement organizations, memberships and role guards.
- Implement tenant CRUD and validated runtime configuration.
- Add audit entries for every administrative mutation.
- Verify isolation manually across two organizations before completing the
  phase.

Exit criteria: an organization administrator can manage only their own
projects; cross-organization access consistently returns 404/403 without data
leakage.

### Phase 2 — machine credentials

- Implement cryptographically random deployment and collector keys.
- Store only hashes and safe metadata.
- Show plaintext exactly once, then support listing, rotation and revocation.
- Derive tenant access and scopes from the authenticated key.
- Add rate limits and last-used metadata.

Exit criteria: collector and proxy credentials cannot use each other's API or
access an unassigned tenant.

Decision: machine credentials use opaque 256-bit secrets, keyed hashes and
type-specific guards; Redis rate-limit failure behavior is explicit per
deployment. See ADR-0003.

### Phase 3 — policy import, compile and lifecycle MVP

- Import a structured policy through the dashboard API.
- Validate it against versioned shared contracts.
- Compile only registered tools and validated configurations.
- Store immutable content-addressed policy versions.
- Implement approval/rejection and atomic activation pointer updates.
- Never replace the active version after validation or compilation failure.

Exit criteria: a valid imported policy can reach `ACTIVE`; invalid input leaves
the previous active policy unchanged.

Decision: structured policy uses `tessera.policy/v1` and the initial closed
tool registry `tessera.tools/v1`. Policy content is SHA-256 addressed, lifecycle
transitions emit durable outbox events, and activation updates a tenant-scoped
selection without distributing a bundle. See ADR-0004.

### Phase 4 — signed bundle distribution

- Build one atomic bundle from runtime configuration plus compiled policy.
- Sign canonical bytes with Ed25519.
- Expose `GET /v1/tenants/:tenantId/active-bundle` to deployment keys.
- Support `ETag`, `If-None-Match` and explicit supported schema versions.
- Add proxy heartbeat/version reporting and a dashboard-visible `restart
required` state.

Exit criteria: an authorized proxy receives only its tenants' signed bundles;
tampering and unsupported formats are rejected during manual compatibility
verification with the proxy repository.

### Phase 5 — collector and application analysis

- Accept versioned, redacted uploads with source revision and a visible upload
  manifest.
- Store large payloads outside MongoDB and scan/archive them safely.
- Orchestrate dependency, CVE, API-surface and AI analysis asynchronously.
- Preserve partial tool failures and source attribution.
- Emit `AnalysisCompleted` or `AnalysisFailed` through outbox/inbox processing.

Exit criteria: duplicate uploads are idempotent; unredacted secrets are
rejected where detectable; analysis failure cannot alter the active policy.

### Phase 6 — policy generation and editing

- Generate human-readable and structured policy from an analysis.
- Validate all AI output as untrusted structured data.
- Compile generated policies and place them in the approval workflow.
- Support natural-language edits as new versions, with an explicit precision
  warning.

Exit criteria: invalid AI output creates a failed attempt and never a runnable
or active policy.

### Phase 7 — telemetry and operations

- Ingest best-effort, batched, redacted counters and health reports.
- Add retention, aggregation and quotas.
- Expose active-versus-loaded version, degraded state, verdict counts, sampling
  metrics and attack-rate summaries.
- Add operational alerts without putting telemetry in the decision path.

Exit criteria: telemetry outages do not affect bundle distribution or proxy
decisions, and sensitive request data is absent from storage and logs.

## 7. Verification policy — no automated tests

Do not write unit, integration, end-to-end, contract or security tests for this
backend during the current implementation phase. Do not create `*.spec.ts`,
`*.test.ts` or test fixture files, and do not add test runners, test scripts or
test-only dependencies. This is an explicit constraint intended to reduce
token usage.

Use formatting, linting, strict type checking, production builds and small
manual verification commands as the quality gates. Keep modules strongly
typed and validate all external input at runtime so that removing automated
tests does not remove boundary validation. Automated tests may be restored
only after an explicit project decision changes this policy.

## 8. Decisions required before Phase 1

1. Dashboard identity uses Auth0 access tokens; authorization roles remain
   `owner`, `admin`, and `viewer` memberships stored by Tessera. See ADR-0001.
2. Whether JEV credentials are customer-managed per proxy or platform-managed.
3. Exact JEV API contract.
4. Runtime configuration requires an explicit `failureBehavior` value when a
   proxy has neither a valid remote bundle nor a last known good bundle. See
   ADR-0002; the wire-level behavior remains a Phase 4 contract decision.
5. Runtime configuration uses the required key `unknownEndpointBehavior`. See
   ADR-0002.
6. Tool-registry compatibility for Phase 3 is defined by ADR-0004. Supported
   bundle schemas and delayed proxy upgrade compatibility remain a required
   Phase 4 decision.
7. Collector upload size, file allowlist, retention and data residency.

These decisions must be recorded as ADRs before the dependent module is
implemented.
