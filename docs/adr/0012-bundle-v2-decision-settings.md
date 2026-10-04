# 0012: Bundle v2 carries explicit runtime decision settings

## Status

Accepted, 2026-10-04.

## Context

The proxy cannot enforce JEV thresholds, adaptive sampling bounds or separate
failure behaviors from `tessera.bundle/v1`. Its generic `failureBehavior` does
not determine those choices. Supplying proxy-side defaults would make the
dashboard cease to be the source of truth for request decisions.

## Decision

New activations produce `tessera.bundle/v2`. It extends the runtime config with
required `decision.sampling`, `decision.jev`, and explicit behaviors for static
analysis errors, suspicious requests without JEV, and sampled safe requests
without JEV. Tenant creation and updates require these settings. Sampling rate
must lie within its bounds, and the JEV floor may not exceed the threshold.
Existing v1 bundles remain immutable and may be served to compatible older
proxies. New v2 activations require proxies to advertise v2 support; older
proxies receive 406 and must upgrade. Tenants stored before this decision need
their decision settings supplied before they can activate a v2 bundle.
Versioned network schemas are kept in the proxy repository, with matching
transport definitions in this backend, as chosen for this integration. This
supersedes the package-location intention in ADR-0004.

## Consequences

No security-sensitive decision value is inferred from `failureBehavior` or
hidden in proxy code. Rollout requires updating tenant settings, activating a
new bundle, then restarting compatible proxies.
