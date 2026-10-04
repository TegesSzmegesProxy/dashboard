# Tessera Control Plane

NestJS backend for the hosted Tessera control plane. It owns organizations,
projects (tenants), policy lifecycle, bundle distribution and redacted
telemetry. It never participates in the proxy request path.

## Development

```bash
docker compose up -d --wait   # MongoDB (single-node replica set) and Redis
cp .env.example .env
npm install
npm run start:dev
```

To run the API in Docker as well, fill in `.env` and run from the repository
root:

```bash
npm run backend:docker          # build and run API + MongoDB + Redis
npm run backend:docker:detach   # same, in the background
npm run backend:docker:down     # stop everything
```

The containerized API listens on `http://localhost:5050/api/v1` (override with
`API_PORT`).

By default `docker-compose.yml` runs only the local dependencies, bound to
loopback; the API container uses the `app` profile.
`docker compose down` stops them; add `-v` to also delete their data. On macOS
port 5000 is often taken by the AirPlay Receiver; set `PORT` in `.env` if the
API fails to start with `EADDRINUSE`.

The dashboard API accepts Auth0-issued bearer access tokens. Configure the
issuer, API audience and MongoDB connection using `.env.example`. MongoDB must
run as a replica set because administrative mutations and their audit entries
are committed in one transaction.

Collector and deployment credentials are opaque machine keys whose plaintext
is returned only at creation or rotation. Configure Redis for distributed rate
limits and provide a stable `API_KEY_HASH_SECRET`; changing that secret
invalidates existing keys. The Redis failure posture is intentionally required
and has no default. Generate the HMAC secret independently for each deployment,
for example with a cryptographically secure secret manager.

Policy imports use the versioned `tessera.policy/v1` contract. Imported content
is immutable and content-addressed; compilation, approval or rejection, and
activation are separate audited transitions. Activation selects a policy for a
tenant and, in the same transaction, builds and signs an immutable
`tessera.bundle/v1` bundle from the compiled policy and the tenant's current
runtime configuration. Editing runtime configuration later does not change the
distributed bundle until the policy is activated again.

Bundles are signed with Ed25519. Provide `BUNDLE_SIGNING_PRIVATE_KEY` as a
PKCS#8 PEM from a secret manager; the service refuses to start without a valid
Ed25519 key. Generate a development key and the public key proxies need with:

```bash
openssl genpkey -algorithm ed25519 -out bundle-signing.pem
openssl pkey -in bundle-signing.pem -pubout
```

Proxies use deployment keys to call
`GET /api/v1/tenants/:tenantId/active-bundle`, with the
`Tessera-Bundle-Schemas` and `Tessera-Tool-Registries` headers and optional
`If-None-Match`. They report status to `POST /api/v1/proxy/heartbeats`.

### JEV credential

Owners and admins set the organization's JEV API key with
`PUT /api/v1/organizations/:organizationId/integrations/jev` (`apiKey`),
read its status with `GET` and disconnect it with `DELETE`. The key is
encrypted with `CREDENTIAL_ENCRYPTION_KEY` (`openssl rand -base64 32`) and
never returned to the dashboard; without that variable saving returns `503`.
Proxies fetch it from `GET /api/v1/proxy/jev-credential` with a deployment
key that has the opt-in `jev-credentials:read` scope; `404` means no
credential is configured. See ADR-0009.

### AI model

The deployment chooses the model in its environment (ADR-0019); the dashboard
cannot change it. Set `ANTHROPIC_API_KEY`, or `ANALYSIS_AI_BASE_URL` to use a
self-hosted model with an Anthropic-compatible API (no key is sent to it, and
redirects are refused). `ANTHROPIC_ANALYSIS_MODEL` and
`ANTHROPIC_POLICY_MODEL` name the models. Without a key or a URL, analyses
cannot start. `GET .../projects/:tenantId/analysis-readiness` shows the model,
whether the sandbox is configured and any unfinished analysis, never a key.

### Project tuning settings

Owners and admins replace a project's model settings, policy defaults and
endpoint overrides with `PUT` on
`/api/v1/organizations/:organizationId/projects/:tenantId/model-settings`,
`.../policy-defaults` and `.../endpoint-overrides`; viewers may `GET` them.
Unsaved sections return `null` values (or no endpoints); there are no
defaults. Constraints containing a detectable credential are rejected with
`422`. Saving changes no policy version or bundle. See ADR-0011.

### Application analysis

Analyses are agentic and sandboxed (ADR-0013 to ADR-0016):

1. Collectors send `POST /api/v1/tenants/:tenantId/analysis-uploads` with a
   collector key, an `Idempotency-Key`, and a `tessera.analysis-upload/v1`
   body. Only the commit SHA starts the analysis; the environment section is
   summarized, not stored. An owner or admin can instead start one from the
   dashboard with `POST .../projects/:tenantId/analyses` (`Idempotency-Key`),
   which analyzes the head of the bound repository's default branch (ADR-0019).
2. Environment context comes from `tessera -get-environment`, which posts
   httpx, Lynis, nmap, nuclei and Trivy results to
   `POST /api/v1/tenants/:tenantId/environment-snapshots` (collector key with
   `environment-snapshots:write`). The latest snapshot is used; without one,
   analyses run anyway and `GET .../projects/:tenantId/environment` returns
   the notice to run the command.
3. The worker streams the commit from the bound GitHub repository into a
   per-job sandbox (`ANALYSIS_SANDBOX`) that indexes it for any language,
   without network access or credentials. It then estimates the cost and
   waits in `awaiting_budget`.
4. An owner or admin approves a ceiling with
   `POST .../analyses/:analysisId/budget-approval` (`ceilingUsd`,
   `Idempotency-Key`). `PUT .../projects/:tenantId/analysis-settings` can set
   an explicit auto-approve ceiling.
5. Recon writes route rules that the sandbox applies to the whole
   repository; one agent resolves each work item; a sweep looks for missed
   routes. Every work item ends as an endpoint, not an endpoint, a duplicate,
   or unresolved (`GET .../analyses/:analysisId/work-items`). The analysis
   result holds evidence-backed endpoint facts, a pending
   `tessera.policy/v2` proposal, coverage, cost and the AI read manifest.

The ceiling is enforced after every model response; when it is reached, the
remaining work items are unresolved and the analysis is `partial`. An
analysis paused because the provider account ran out of credit continues with
`POST .../analyses/:analysisId/resume`. Prompts live in
`src/modules/analyses/prompts/`.

Configure the GitHub App (`GITHUB_APP_*`, read-only Contents and Metadata, with
"Request user authorization during installation" enabled). The dashboard then
posts the setup callback's `installation_id` and `code` to
`POST /api/v1/organizations/:organizationId/github-installations` and binds a
repository with `PUT .../projects/:tenantId/repository`.

### Policy editing

Owners and admins can edit a v1 policy version in natural language with
`POST .../policies/:version/edits` (`instruction`, `Idempotency-Key`), which
returns `202` with the attempt. Poll `GET .../policy-generations/:attemptId`.
AI output is validated and compiled; a successful attempt references a new
pending version that still needs approval and activation, and a failed
attempt creates no version. `ANTHROPIC_POLICY_MODEL` selects the model.
Analyses no longer generate whole v1 policies; turning their v2 proposals
into policy versions, and per-endpoint edits, are the next phase.

### Telemetry and operations

Proxies send minute windows of redacted counters to
`POST /api/v1/proxy/telemetry` (`tessera.telemetry/v1`, deployment key with
`telemetry:write`). Endpoint keys must belong to the policy of the bundle the
proxy reports as loaded; a retried `batchId` is applied once. Telemetry is
kept 48 hours at minute and 90 days at hour granularity, and each project has
an hourly quota (`TELEMETRY_QUOTA_ENTRIES_PER_TENANT_HOUR`). The dashboard
reads `GET .../projects/:tenantId/operations`, `.../telemetry`, `.../alerts`
and `.../alert-settings`. Alerts are evaluated every minute and are visible
only in the dashboard; the attack-rate alert stays off until a threshold is
set.

The API is available at `http://localhost:5000/api/v1`. Swagger is available
at `http://localhost:5000/api/v1/docs` when `SWAGGER_ENABLED=true`.

## Quality checks

```bash
npm run lint
npm run typecheck
npm run build
```

## No automated tests

Do not create unit, integration, end-to-end or contract tests for this backend.
Do not add test runners, test dependencies, test scripts or `*.spec.ts` files.
This is an intentional project constraint to reduce token usage during the
current implementation phase. Validate changes with linting, type checking,
building and focused manual checks instead. Only restore automated tests after
an explicit project decision changes this rule.

See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for the domain and
delivery plan.
