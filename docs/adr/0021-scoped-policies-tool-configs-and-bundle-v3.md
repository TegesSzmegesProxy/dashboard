# 0021: Scoped policies, tool configurations and bundle v3

## Status

Accepted. Supersedes the parts of ADR-0014 that say tools carry no
configuration and that leave the bundle schema for analysis policies open. Its
endpoint shape, JEV context and human-readable policy rules still apply.

## Context

Analyses produced `tessera.policy/v2` proposals that could not reach a proxy:
- no bundle schema carried them;
- their tools had no configuration;
- they only had endpoint-level rules.

Meanwhile the proxy implemented `tessera.tools/v3`: 150 tools, each with a
configuration contract, published as a generated `docs/tool-registry.json`.

Some protections are not about one endpoint:
- a JSON API whose every body field should be checked for injection;
- an application-wide body limit;
- a vulnerable logging library found by Trivy.

Also, the proxy fetched and applied bundles on its own at startup. Operators
want to decide when new policies reach a running proxy.

## Decision

- **Policy scopes.** `tessera.policy/v3` has three scopes:
  - `global`: from code that shapes the whole application (middleware,
    parsers, framework limits). The recon agent proposes it.
  - `environment`: from the latest environment snapshot (ADR-0016). It records
    the snapshot's ID. A dedicated agent step proposes it and is skipped
    without a snapshot.
  - `endpoints`: the v2 endpoint and field shape.

  Global and environment policies apply to every request, including requests
  no endpoint policy matches, when `unknownEndpointBehavior` allows them. Scope
  field tools target every field of a location (`body.*`, `query.*`).
  The two scopes differ only in where they come from, which affects review.
  At runtime they behave the same.
- **Precedence.** When the same tool and target appear in more than one
  scope, the most specific one runs: endpoint, then environment, then global.
  The compiler reports every replaced step as a `scope_override` review
  warning.
- **Tool configuration.**
  - The dashboard keeps a copy of the proxy's `tessera.tools/v3` registry,
    synced with `backend/scripts/sync-tool-registry.mjs`. It never imports
    proxy code.
  - The model proposes each tool's configuration as a JSON string.
  - Reconciliation and the compiler validate it against the tool's JSON Schema
    with Ajv. An invalid choice is dropped with a warning in reconciliation,
    and fails compilation in a policy version.
  - The proxy validates again with its own contract (including refinements
    JSON Schema cannot express) when it fetches the bundle.
- **Operator-configured tools.** Tools whose configuration is secret material
  or a data feed may not appear in any policy, because policies are stored,
  shown and distributed. These are `cookie_tampering`, `jwt_validation`,
  `ip_reputation`, `geo_policy`, `impossible_travel`, `datacenter_asn` and
  `tor_exit_node`. Field tools are also rejected on `path`, `header` and
  `cookie` fields, which the proxy cannot inspect yet.
- **Bundle v3.** `tessera.bundle/v3` carries the v2 runtime and decision
  settings and the compiled v3 policy:
  - steps per scope and per endpoint;
  - JEV context per scope, per endpoint and per body or query field.

  It never carries human-readable policy. The proxy repository owns the wire
  schema; `backend/src/contracts/bundle/v3` mirrors it.
- **Activation.**
  - A v3 policy builds only `tessera.bundle/v3`. This is an explicit exception
    to ADR-0005's "build every schema still served", because a v3 policy cannot
    be expressed in v2.
  - A proxy that does not advertise v3 gets 406 and keeps its last known good
    bundle.
  - v1 policies keep building `tessera.bundle/v2`.
  - v2 policies cannot be activated. A new analysis produces v3.
- **Distribution.** The proxy fetches only when an operator runs
  `tessera fetch`:
  1. The fetch verifies the bundle and builds every tool.
  2. It stores the signed bundle in Redis.
  3. Ingress loads it at startup, verifying it again. Without one, the proxy
     exits and asks for `tessera fetch`.
  4. A running proxy switches to a newly fetched bundle without a restart,
     unless the bundle changes the upstream.
  5. A periodic check only reports that the dashboard has a newer bundle.

  The proxy repository records the proxy side of this decision.
- **JEV context at runtime.** The proxy gives JEV the global, environment,
  endpoint and matching field context as labelled data, never as
  instructions, as ADR-0014 requires.

## Consequences

- Policies can tune 143 tools, and protections that cover the whole
  application no longer have to be repeated on every endpoint.
- A mistake in a scope policy affects every request. The prompts ask the
  model to keep scope policies conservative, and reviewers see scope policies
  and overrides separately.
- New policies reach a proxy only when an operator fetches them. The dashboard
  shows them as activated before any proxy runs them.
- Configurations rest on JSON Schema in the dashboard and on Zod refinements
  in the proxy. A configuration the dashboard accepts can still be refused by
  `tessera fetch`. The fetch then fails and leaves the running policy in place.
- Policy editing in the dashboard keeps existing configurations, but cannot
  set tool settings or edit scope policies yet. The API accepts both.
