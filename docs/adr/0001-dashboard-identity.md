# 0001: Auth0 access tokens for dashboard identity

## Status

Accepted

## Context

The dashboard API needs an identity provider and token model before it can
derive organization access safely. Authentication and organization
authorization have different lifecycles: the provider owns login identity,
while Tessera owns organization memberships.

## Decision

Dashboard clients send Auth0-issued OAuth 2.0 bearer access tokens. The backend
validates their signature through the issuer's OIDC JWKS, plus issuer,
audience, expiry and the `RS256` algorithm. The stable `sub` claim is the user
identity.

Tessera stores `owner`, `admin`, and `viewer` organization memberships in
MongoDB. It does not trust roles, organization IDs, or tenant IDs from token
custom claims or request payloads. An organization creator becomes its first
owner. Session cookies and refresh tokens are outside this API.

## Consequences

Authentication remains standards-based without an Auth0 SDK, but deployments
depend on Auth0 availability for login and JWKS refresh. Revoking membership is
immediately effective in Tessera even while an access token remains valid.
Auth0 subject IDs are durable external identifiers and must be preserved when
migrating providers.
