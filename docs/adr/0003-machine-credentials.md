# 0003: Opaque machine credentials and explicit rate-limit failure behavior

## Status

Accepted

## Context

Collectors and proxy deployments need independently scoped credentials. The
control plane must reveal plaintext only once, authenticate without storing it,
and limit abusive authentication attempts across service instances. Redis can
be unavailable, and silently selecting fail-open or fail-closed behavior would
be a security-sensitive default.

## Decision

Tessera issues opaque credentials with a public type and key identifier plus a
cryptographically random 256-bit secret. The database stores only a keyed
SHA-256 digest and safe metadata. Collector and deployment credentials use
distinct prefixes, guards, and allowed scope sets. Every key is assigned to an
explicit organization and non-empty tenant set.

Rotation requires an idempotency key. Its replacement secret is derived with
HMAC-SHA-256 from deployment secret material and the idempotency context, so a
retry can return the same plaintext without persisting plaintext. A later
rotation supersedes that response.

Redis holds fixed-window machine-authentication rate-limit counters. Each
deployment must explicitly configure whether Redis failure permits the request
to continue (`allow`) or returns service unavailable (`deny`); there is no
default. MongoDB remains authoritative for credentials and revocation.

## Consequences

A database leak does not expose usable credentials, and collector credentials
cannot authenticate as deployment credentials. Rotating a key invalidates the
previous value immediately. Operators must manage the HMAC secret as deployment
secret material and choose the Redis failure posture deliberately.
