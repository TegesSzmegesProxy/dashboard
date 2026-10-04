# 0017: Local AI model provider

## Status

Superseded by ADR-0019

## Context

ADR-0010 stores one AI model credential per organization. Its providers are
`openai`, `anthropic` and `custom`, and each has an API key. ADR-0015 makes
analyses use only an `anthropic` key, sent to the public Anthropic API. Some
organizations want analyses to run against their own model instead. That
model is a self-hosted or local server that speaks the Anthropic Messages API
and usually needs no key. `custom` was never used by anything.

Pointing the control plane at a URL the organization chooses lets admins make
it send requests and redacted source to any address it can reach. That
includes the control plane's own internal network.

## Decision

- The providers are `openai`, `anthropic` and `local`. `local` replaces
  `custom`. A record that still stores `custom` is shown as connected but
  cannot be used by analyses.
- `openai` and `anthropic` take an `apiKey` and no `baseUrl`. They always use
  the provider's API.
- `local` takes a `baseUrl` and no `apiKey`. Analyses use either an
  `anthropic` key or a `local` model, and never fall back to the platform key.
  - Requests to a `local` model carry no key.
  - The client is built with explicit empty credentials, so the SDK never
    picks up a platform key from the environment.
  - The address is not secret. The dashboard shows it, and the audit entry
    records it.
- The URL must be `http` or `https`, without credentials, query or fragment.
  A trailing slash is removed.
- By default only `https` addresses on public hosts are accepted. The
  following are rejected when the credential is saved:
  - loopback, private, link-local, CGNAT, multicast and reserved addresses;
  - `localhost` and single-label names;
  - names under `.local`, `.localhost`, `.internal` and `.home.arpa`.
- A self-hosted control plane may set `AI_MODEL_ALLOW_PRIVATE_BASE_URL=true`.
  It then also accepts local, private and plain-`http` addresses. The default
  is `false`, and a hosted multi-tenant control plane keeps it that way.
- With the default policy, the worker checks the address again before an
  analysis calls it:
  - it fails with `AI_ENDPOINT_NOT_ALLOWED` if the address is no longer
    allowed or resolves to a private address;
  - it retries with `AI_ENDPOINT_UNRESOLVED` if the name does not resolve.
  HTTP redirects are refused in every case.
- A `local` record keeps an encrypted empty secret. Its authenticated context
  is `ai-model-credential:<organizationId>:endpoint=<baseUrl>`. A record whose
  address was changed outside the API cannot be decrypted, so it is not used.
  Saving needs `CREDENTIAL_ENCRYPTION_KEY`, as for the other providers.

## Consequences

Organizations can run analyses against their own models without a code
change.

- Cost estimates and budgets still use the configured price table and
  `ANTHROPIC_ANALYSIS_MODEL`. The local server must accept that model name
  and the features analyses use. For a local model, the USD figures are only
  nominal.
- The DNS check runs before the SDK resolves the name again. It narrows DNS
  rebinding but does not close it. A deployment that needs a hard guarantee
  must also restrict egress at the network layer.
- Policy generation still uses the platform key, and `openai` is still not
  used by analyses.
