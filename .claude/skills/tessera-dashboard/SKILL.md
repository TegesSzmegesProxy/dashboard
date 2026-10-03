---
name: tessera-dashboard
description: Architecture and development context for Tessera's dashboard and hosted control plane. Use when changing the frontend, NestJS backend, organizations, tenants/projects, credentials, analysis, policy lifecycle, signed bundle distribution, proxy health, telemetry, or any dashboard-to-proxy contract.
---

# Tessera Dashboard

Work within the hosted control-plane boundary. Read the repository-root
`AGENTS.md`, `ARCHITECTURE.md`, and `GLOSSARY.md` before making architectural or
domain changes. For backend work, also read `backend/IMPLEMENTATION_PLAN.md`.

## Route the change

Identify which API surface owns it before coding:

- dashboard user operations;
- collector upload and analysis;
- proxy distribution, heartbeat, or redacted telemetry.

Then identify the owning domain module. Keep controllers and UI data adapters
thin; domain behavior, authorization, validation, and persistence belong to the
owning backend module. Do not duplicate proxy enforcement logic in the backend
or frontend.

## Preserve the important invariants

- The control plane is never in the protected request path and never makes
  runtime `ALLOW`/`BLOCK` decisions.
- Organization and tenant scope comes from the authenticated principal, not
  from an untrusted payload.
- Policies, analyses, and bundles are immutable versions; failures never
  replace the active version.
- The proxy pulls and verifies signed bundles and retains a last known good
  copy. Control never pushes into the customer network.
- Cross-repository payloads are versioned wire contracts, not imports of proxy
  implementation code.
- AI/provider output, uploads, and telemetry are untrusted and validated.
- Secrets, unredacted source, and raw customer request data do not enter logs,
  telemetry, bundles, or frontend state.

## Match the current repository state

The backend is NestJS and is intentionally developed without automated tests
for now. Use its existing lint, typecheck, build, and manual verification gates;
do not add test tooling unless the project decision changes. The static HTML
mockups communicate product direction only. Do not infer a frontend framework,
API shape, or domain rule from them.

When a task changes a cross-deployable contract, inspect the sibling `../proxy`
repository for compatibility and update the versioned contract deliberately.
When it changes durable terminology or architecture, update `GLOSSARY.md` or an
ADR as directed by the root agent guide.

