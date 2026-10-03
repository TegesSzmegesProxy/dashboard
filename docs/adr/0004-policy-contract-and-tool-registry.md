# 0004: Versioned policy contract and initial tool registry

## Status

Accepted

## Context

Policy import and compilation require a versioned structured contract and a
closed registry of proxy tools. The proxy repository currently defines the
tool id `string_length`, but its configuration support and registry are still
planned work. Inventing additional runtime tools in the control plane would
create a false compatibility promise.

## Decision

The initial structured policy contract is `tessera.policy/v1`; compiled policy
uses registry `tessera.tools/v1`. Version 1 contains only the existing proxy
tool id `string_length`, with field context and explicit `minLength` and/or
`maxLength` configuration. Neither bound is defaulted. Unknown tool ids,
duplicate endpoints, duplicate tool targets, and invalid bounds fail
compilation.

Policy content is canonically serialized and addressed by a SHA-256 version.
Human intent and structured content are immutable after import. Compilation,
approval, rejection, and selection for activation are explicit durable states
and emit versioned outbox events. Activation atomically changes only a
tenant-scoped policy selection; it does not yet create or distribute an active
bundle.

The contract starts in the backend's versioned `src/contracts` namespace. It
must move to the separately versioned `@tessera/contracts` package, and the
proxy must implement the same registry/config validation, before Phase 4 can
distribute it.

## Consequences

Phase 3 can validate lifecycle guarantees without claiming support for proxy
tools that do not exist. The first useful policy surface is intentionally
narrow. Bundle schema compatibility and delayed proxy upgrades remain Phase 4
decisions.
