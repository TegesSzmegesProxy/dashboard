# 0009: Organization-managed JEV credential delivered to proxies

## Status

Accepted

## Context

The proxy calls JEV for selected runtime decisions and needs an API key for
it. Whether that key is customer-managed per proxy (an environment variable on
each deployment) or managed in the control plane was open (implementation plan
§8.2). Customers want to set one key in the dashboard and have every project
use it. Secrets must never enter a bundle, the control plane must never push
into the customer network, and the proxy request path must not depend on the
control plane.

## Decision

Each organization has at most one JEV credential, shared by all of its
projects. Owners and admins set, replace, or disconnect it through
`GET`/`PUT`/`DELETE /api/v1/organizations/:organizationId/integrations/jev`.
The key is write-only: the dashboard sees only whether one is configured, its
version and update time. Every change emits an audit entry without the key.

The control plane stores the key encrypted with AES-256-GCM under
`CREDENTIAL_ENCRYPTION_KEY`, a deployment secret. The organization id is
authenticated additional data, so a ciphertext cannot be moved to another
organization. Without the encryption key the credential cannot be saved or
delivered (`503`); there is no plaintext fallback. The record survives a
disconnect without its secret, so the version only ever increases.

Proxies pull the key from `GET /api/v1/proxy/jev-credential`
(`tessera.jev-credential/v1`, `Cache-Control: no-store`) with a deployment key
holding the opt-in `jev-credentials:read` scope. The organization comes from
the deployment key. The response is separate from the bundle and is not
signed; TLS and the deployment key protect it.

Proxy behavior:

- the proxy keeps the key in memory only and never logs or persists it;
- a failed or unavailable fetch keeps the key it already has;
- `404` means the organization disconnected JEV: the proxy drops its key and
  treats JEV as unavailable, applying each tenant's configured failure
  behavior;
- with no key at startup (control plane unreachable or `404`), JEV is
  unavailable in the same way.

## Consequences

One dashboard action configures JEV for every proxy of an organization, and
rotation reaches proxies on their next fetch without redeploying them. The
control plane now holds a reversible customer secret: a database leak alone
does not expose it, but a leak of the database and `CREDENTIAL_ENCRYPTION_KEY`
together does. Rotating `CREDENTIAL_ENCRYPTION_KEY` currently requires
re-entering the credential; a key identifier can be added to the record when
rotation is needed. A proxy restarted while the control plane is down runs
without JEV until the next successful fetch. The exact JEV API contract
remains open.
