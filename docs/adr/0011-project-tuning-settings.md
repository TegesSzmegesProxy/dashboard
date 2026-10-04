# 0011: Project tuning settings are stored inputs

## Status

Accepted

## Context

The dashboard lets an operator tune a project: model context and sampling
settings, default policy action, constraints and threshold, and per-endpoint
and per-field overrides. Their values look like enforcement configuration,
but the policy contract (`tessera.policy/v1`), the tool registry and the bundle
have no representation for most of them (for example `review`, `mask` or a
score threshold). Writing them straight into a bundle would bypass policy
versioning, compilation, approval and activation.

## Decision

Each tenant has at most one record per tuning section, stored in MongoDB and
scoped by `organizationId` and `tenantId`:

- model settings: `contextLength`, `temperature`, `topP`, `maxTokens`;
- policy defaults: `defaultAction` (`allow` | `review` | `block`),
  `customConstraints`, `threshold`;
- endpoint overrides: endpoints by method and path, each with an optional
  request policy and threshold and per-field rules
  (`allow` | `require` | `mask` | `review` | `block`).

Owners and admins replace a section with
`PUT /api/v1/organizations/:organizationId/projects/:tenantId/{model-settings|policy-defaults|endpoint-overrides}`;
viewers may `GET` them. A `PUT` replaces the whole section and increases its
version. There are no defaults: `GET` returns `null` values (or no endpoints)
until a section is first saved. Free-text constraints and field names that
contain a detectable credential are rejected with `422`. Every save emits an
audit entry whose metadata excludes free text.

Saving a section creates no policy version, triggers no generation and
changes no bundle. The settings reach a proxy only through a future,
explicitly designed path that goes through policy versioning, compilation,
approval and activation.

## Consequences

The dashboard can persist tuning intent now without weakening the bundle
lifecycle, but the values have no runtime effect yet, and the UI must not
imply that saving them changes enforcement. Which model the model settings
apply to, and how defaults and overrides are mapped into policy generation or
the policy contract, remain open (implementation plan §8).
