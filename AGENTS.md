# Tessera Dashboard — agent guide

This repository contains the hosted Tessera control plane and its dashboard UI.
These instructions apply to the whole repository, including future frontend
code and the existing `backend/` application.

## Read before changing code

1. Read [ARCHITECTURE.md](./ARCHITECTURE.md) for system boundaries and the
   proxy/control-plane relationship.
2. Use [GLOSSARY.md](./GLOSSARY.md) for domain names. Do not introduce a second
   name for an existing concept.
3. For backend work, also read
   [backend/IMPLEMENTATION_PLAN.md](./backend/IMPLEMENTATION_PLAN.md). It is the
   detailed delivery plan and records unresolved decisions.
4. Treat the root `mockup_*.html` files as visual exploration, not as API or
   domain specifications.

The sibling `../proxy` repository is useful for compatibility checks, but this
repository must not import its implementation. Cross-repository data belongs
in versioned wire contracts, ultimately published as `@tessera/contracts`.

## Non-negotiable boundaries

- The dashboard/backend is the **control plane**. It never handles protected
  application traffic and never makes runtime `ALLOW`/`BLOCK` decisions.
- The **proxy** is the data plane and always initiates communication with the
  control plane. Control-plane availability must not be required in the proxy
  request path.
- A proxy runs the last known good signed bundle when the control plane is
  unavailable. A failed build, validation, signature, or pull must never replace
  the currently active bundle.
- The collector redacts environment context before upload and never uploads
  source files. Source is fetched from the project's bound GitHub repository,
  then filtered and redacted in memory before storage or AI processing
  (ADR-0006). Never persist or log secrets, raw request bodies, authorization
  headers, cookies, or unredacted source.
- Derive organization and tenant access from the authenticated user or API
  key. Never trust a client-provided `organizationId` or `tenantId` as
  authorization.
- Keep tenant-owned records explicitly scoped by both `organizationId` and
  `tenantId`.
- Runtime configuration and compiled policy are activated and distributed as
  one immutable, signed, versioned bundle.
- Do not invent security-sensitive defaults. If failure behavior, compatibility
  policy, identity, or key ownership is unresolved, record or request a
  decision before implementing it.

## Repository map

- `backend/` — NestJS control-plane API. Its modules should own domain logic,
  validation, and persistence; controllers stay thin.
- `mockup_dashboard.html`, `mockup_main_settings_page.html`,
  `mockup_project_settings.html` — disposable UI references.
- `docs/adr/` — durable architectural decisions.
- `.agents/skills/tessera-dashboard/` — task-specific context for agents working
  on the dashboard or control plane.
- A production frontend has not been scaffolded yet. Do not infer a framework
  from the static mockups or introduce one unless the task calls for it.

## Implementation conventions

- External APIs and payloads are versioned. Validate every external input at
  the boundary.
- Dashboard, collector, and proxy APIs use distinct authentication guards and
  scopes.
- Keep cross-module workflows explicit. Long-running control-plane workflows
  use durable state plus an outbox/inbox approach; Redis is coordination and
  cache infrastructure, not the source of truth.
- AI output is untrusted structured input. Validate it before storage,
  compilation, approval, or activation.
- Policies and analyses are immutable versions. Administrative mutations emit
  safe audit entries.
- TypeScript stays strict; avoid `any` and avoid leaking transport DTOs or
  persistence models into domain interfaces.
- Preserve the current backend constraint: do not add automated tests, test
  runners, test dependencies, fixtures, `*.spec.ts`, or `*.test.ts` files until
  that decision is explicitly changed. Verify with format/lint/typecheck/build
  and focused manual checks.

## Keeping context current

- Update `GLOSSARY.md` when a new durable domain concept is introduced or an
  existing term is sharpened.
- Add an ADR only for a consequential decision that future contributors might
  otherwise revisit. Follow `docs/adr/README.md`.
- Update `ARCHITECTURE.md` when a system boundary or cross-deployable contract
  changes. Keep implementation status and phased work in the implementation
  plan instead of duplicating it here.

