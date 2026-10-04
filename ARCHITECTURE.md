# Tessera Dashboard system context

## What this repository owns

This repository is the hosted **control plane** for Tessera. It owns the web
dashboard and the API behind it: organizations, projects/tenants, credentials,
application analysis, policy generation and compilation, approvals,
activation, signed bundle distribution, redacted telemetry, and audit history.

It does not own runtime request enforcement. That belongs to the separately
deployed proxy in the sibling `../proxy` repository.

## System shape

```text
Dashboard user -> Frontend -> Control-plane API -> MongoDB / Redis / secret store
                                    ^       |
                                    |       +-> AI provider (analysis/generation)
                                    |       +-> GitHub (App, read-only source fetch)
                                    |
Collector (customer CI/CLI) --------+  commit SHA + redacted environment results
                                    |
Proxy (customer environment) -------+  bundle pull, heartbeat, redacted telemetry

Client traffic -> Proxy -> protected application
                 (the control plane is not on this path)
```

The proxy and collector initiate outbound HTTPS requests. The control plane
never connects into a customer's network. Its only outbound call for source
is to GitHub, through a GitHub App installation that the customer linked. A control-plane outage must not
interrupt a proxy that already has a verified bundle.

## Trust boundaries and API surfaces

The backend exposes three logically separate surfaces:

| Surface | Principal | Responsibilities |
| --- | --- | --- |
| Dashboard API | user session/access token | organizations, projects, keys, analyses, policy lifecycle, operations views |
| Collector API | collector key | versioned analysis uploads (commit SHA and redacted environment results, no files) for assigned tenants |
| Proxy API | deployment key | signed bundle pull, heartbeat/version state, redacted telemetry |

Authenticate and authorize each surface independently. Keys are scoped to an
organization, explicit tenants, and capabilities. Store only key hashes and
safe metadata; reveal plaintext once at creation.

## Control-plane workflow

```text
collector upload (commit SHA + environment results)
  -> source fetch from the bound repository into a disposable analysis sandbox
  -> agentic application analysis producing evidence-backed facts and a
     pending endpoint policy (ADR-0013, ADR-0014)
  -> per-endpoint natural-language edit (AI) or human import
  -> schema validation
  -> compilation against the supported tool registry
  -> human approval
  -> atomic activation
  -> canonical bundle signing
  -> proxy pull and verification
```

Each transition has explicit durable state. Policies, analyses, and activated
bundles are immutable versions. Retrying an operation must be idempotent, and a
failure must leave the previous active version untouched.

## Bundle contract

The unit distributed to a proxy is one immutable bundle containing at least:

- `schemaVersion`, `tenantId`, and a content-derived `version`;
- tenant runtime configuration (routing, upstream, failure behavior,
  thresholds, sampling bounds, and unknown-endpoint behavior);
- the compiled policy/tool configuration;
- activation metadata and an Ed25519 signature over canonical bundle bytes.

The proxy verifies the signature, schema version, expected tenant, full
contract, tool identifiers, and tool configs before persisting or using the
bundle. Secrets never belong in a bundle. Cross-repository contract evolution
must account for proxies upgrading later than the hosted control plane.

The current activation schema is `tessera.bundle/v2` (ADR-0012); existing v1
bundles remain immutable and serve compatible proxies. Proxies pull it from
`GET /api/v1/tenants/:tenantId/active-bundle` with a deployment key, declare
the bundle schemas and tool registries they support in request headers, and
poll with `If-None-Match`. They report loaded versions to
`POST /api/v1/proxy/heartbeats`, so the dashboard can show `restart required`
and incompatible proxies. Heartbeats never affect distribution.

Proxies send batched, redacted `tessera.telemetry/v1` counters to
`POST /api/v1/proxy/telemetry` (ADR-0008). Endpoints are identified only by
policy endpoint keys of the loaded bundle. Telemetry intake and operational
alerts are separate from distribution and never change it.

The organization's JEV credential is not part of a bundle. Proxies pull it
from `GET /api/v1/proxy/jev-credential` (`tessera.jev-credential/v1`) with a
deployment key that holds `jev-credentials:read`, keep it in memory only, and
keep the previous key when a fetch fails (ADR-0009).

## Data and infrastructure

- MongoDB is authoritative for organization- and tenant-owned state.
- Redis supports queues, rate limits, idempotency, caching, and outbox delivery
  coordination. Losing Redis must not corrupt durable state.
- Collector uploads keep only metadata; no raw package is stored. Fetched
  source exists only inside a
  per-job sandbox (in-memory filesystem, no network) that is destroyed when
  the analysis ends. MongoDB stores upload metadata, the AI read manifest
  (path and line ranges sent to the AI provider, redaction counts) and the
  derived analysis (ADR-0013).
- Signing keys, the GitHub App private key and provider credentials come from
  deployment secrets or a secret manager, never the database or frontend.
- Customer integration credentials (the organization JEV key and AI model
  key) are the one exception: MongoDB stores them encrypted under
  `CREDENTIAL_ENCRYPTION_KEY`, and they are write-only for the dashboard
  (ADR-0009, ADR-0010).
- Telemetry is best-effort and redacted. It must not affect bundle distribution
  or runtime decisions.

## Frontend implications

The frontend is an administrative view over control-plane state, not an
enforcement engine. It should make security-relevant states explicit:

- draft, validation, compilation, approval, rejection, and activation status;
- active bundle versus the version currently loaded by each proxy;
- `restart required`, degraded, stale heartbeat, and last-known-good state;
- one-time credential display, rotation, revocation, tenant assignment, and
  scope;
- what collector data is uploaded and how it was redacted;
- the precision limits of natural-language policy editing.

Do not expose secrets after creation and do not imply that saving a draft makes
it active. UI labels should use the terms in `GLOSSARY.md`.

## Current implementation

The backend is an early NestJS modular monolith with configuration validation,
Swagger setup, and a health module. The root HTML files are mockups; a frontend
stack has not been selected. The authoritative implementation sequence and
open decisions are in `backend/IMPLEMENTATION_PLAN.md`.
