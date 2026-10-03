# 0002: Explicit tenant runtime safety behavior

## Status

Accepted

## Context

Tenant CRUD needs to validate runtime configuration, but silently choosing
fail-open or fail-closed behavior would be a security-sensitive default. The
same applies to requests whose endpoint is unknown to a compiled policy.

## Decision

Every tenant runtime configuration must explicitly provide:

- `failureBehavior`: `allow` or `block`, used when the proxy has neither a
  valid remote bundle nor a last known good bundle;
- `unknownEndpointBehavior`: `allow` or `block`;
- routing, upstream URL, timeout, request-body limit, and sampling values.

The control plane validates and stores these values but does not enforce them.
No value is defaulted. The Phase 4 versioned bundle contract will define their
wire representation and proxy compatibility behavior.

Upstream URLs are limited to HTTP(S) and may not contain embedded credentials.

## Consequences

Tenant creation is more explicit and cannot accidentally inherit a platform
security posture. Changing runtime configuration is an audited administrative
mutation. Activation and distribution remain separate later lifecycle steps.
