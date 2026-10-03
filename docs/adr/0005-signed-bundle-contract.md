# 0005: Signed bundle contract and schema negotiation

## Status

Accepted

## Context

Phase 4 distributes one immutable bundle per tenant to proxies. ADR-0002 and
ADR-0004 left open the bundle wire format, how its signature is computed, how
proxies that upgrade later than the control plane are handled, and when edited
runtime configuration reaches a proxy. The proxy repository describes an
`ActiveBundle` with Ed25519 signatures and `ETag` polling but does not yet
implement verification.

## Decision

The bundle schema is `tessera.bundle/v1`. A bundle contains `schemaVersion`,
`tenantId`, `version`, `policyVersion`, `runtimeConfig`, the compiled `policy`,
`issuedAt`, and `signature: { algorithm: "Ed25519", keyId, value }`.

- `version` is the SHA-256 of canonical
  `{ schemaVersion, tenantId, policyVersion, runtimeConfig, policy }`. It
  differs from `policyVersion` because runtime configuration is part of the
  distributed unit. Decisions should reference the bundle `version`.
- The signature covers the RFC 8785 canonical JSON UTF-8 bytes of every bundle
  field except `signature`, so `issuedAt` is also protected. `value` is
  unpadded base64url. `keyId` is the first 32 hex characters of the SHA-256 of
  the public key's SPKI DER.
- `runtimeConfig` carries the tenant's ADR-0002 values unchanged, including
  `failureBehavior`. A proxy with no bundle at all cannot have received this
  value, so behavior before the first verified bundle remains a proxy-side
  deployment decision.
- The Ed25519 private key is deployment secret material
  (`BUNDLE_SIGNING_PRIVATE_KEY`) and is never stored in MongoDB. The service
  refuses to start without a valid Ed25519 key. Proxies get the public key out
  of band.
- `GET /api/v1/tenants/:tenantId/active-bundle` requires the
  `Tessera-Bundle-Schemas` and `Tessera-Tool-Registries` request headers to
  list what the proxy supports. If either is missing or malformed the request
  fails with 400. An active bundle the proxy cannot accept fails with 406
  instead of being served. Responses carry `ETag: "<version>"` and honor
  `If-None-Match`.
- Activation builds, signs and stores the bundle in the same transaction that
  selects the policy. Editing runtime configuration does not change the active
  bundle; the dashboard shows it as pending until the policy is activated
  again. Identical content reuses the stored immutable bundle.
- When a new schema is added, activation must build a bundle in every schema
  still served. Older schemas are served until a deliberate deprecation
  decision.

## Consequences

A proxy never receives a format it has said it cannot verify, and the
dashboard can show which proxies are incompatible. Rotating the signing key
requires proxies to trust both keys during the overlap, because existing
bundles keep their original signature until a policy is activated again.
The proxy must implement the same canonicalization, verification and
tool-registry checks before Phase 4 is complete end to end.
