# 0010: Organization-managed AI model credential

## Status

Superseded by ADR-0019

## Context

The dashboard lets an organization set one AI model API key as the default for
all of its projects. Until now the control plane held only a platform-wide
`ANTHROPIC_API_KEY` from deployment secrets, and ADR-0009 made the JEV key the
single customer credential stored in the database.

## Decision

Each organization has at most one AI model credential: a provider
(`openai`, `anthropic` or `custom`) and an API key. Owners and admins set,
replace, or disconnect it through
`GET`/`PUT`/`DELETE /api/v1/organizations/:organizationId/integrations/ai-model`;
viewers may read its status. The key is write-only: the dashboard sees only
whether one is configured, its provider, version and update time. Every change
emits an audit entry without the key.

Storage follows ADR-0009: AES-256-GCM under `CREDENTIAL_ENCRYPTION_KEY`, with
the purpose and organization id (`ai-model-credential:<organizationId>`) as
authenticated additional data, `503` without the encryption key, and a record
that survives a disconnect so the version only increases. The credential is
never sent to proxies, bundles, or telemetry.

## Consequences

The control plane holds a second reversible customer secret, with the same
exposure and encryption-key rotation limits as ADR-0009. Analyses and policy
generation do not use this credential yet; they still use the platform
`ANTHROPIC_API_KEY`. How and when the organization key replaces it, and support
for non-Anthropic providers, remain open (implementation plan §8).
