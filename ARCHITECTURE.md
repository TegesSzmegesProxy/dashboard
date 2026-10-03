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
Dashboard user -> Frontend -> Control-plane API -> MongoDB / Redis / object storage
                                    ^       |
                                    |       +-> AI provider (analysis/generation)
                                    |
Collector (customer CI/CLI) --------+  redacted analysis upload
                                    |
Proxy (customer environment) -------+  bundle pull, heartbeat, redacted telemetry

Client traffic -> Proxy -> protected application
                 (the control plane is not on this path)
```

The proxy and collector initiate outbound HTTPS requests. The control plane
never connects into a customer's network. A control-plane outage must not
interrupt a proxy that already has a verified bundle.

## Trust boundaries and API surfaces

The backend exposes three logically separate surfaces:

| Surface | Principal | Responsibilities |
| --- | --- | --- |
| Dashboard API | user session/access token | organizations, projects, keys, analyses, policy lifecycle, operations views |
| Collector API | collector key | versioned, redacted analysis uploads for assigned tenants |
| Proxy API | deployment key | signed bundle pull, heartbeat/version state, redacted telemetry |

Authenticate and authorize each surface independently. Keys are scoped to an
organization, explicit tenants, and capabilities. Store only key hashes and
safe metadata; reveal plaintext once at creation.

## Control-plane workflow

```text
redacted upload
  -> application analysis
  -> policy generation or human import/edit
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

## Data and infrastructure

- MongoDB is authoritative for organization- and tenant-owned state.
- Redis supports queues, rate limits, idempotency, caching, and outbox delivery
  coordination. Losing Redis must not corrupt durable state.
- Large analysis uploads belong in object storage; MongoDB stores metadata,
  provenance, redaction manifest, and content hash.
- Signing keys and provider credentials come from deployment secrets or a
  secret manager, never the database or frontend.
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

