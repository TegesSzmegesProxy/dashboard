# 0014: Endpoint policy v2, tool registry v2 and JEV context

## Status

Partly superseded by ADR-0021. Tool configuration, the `tessera.tools/v3`
registry and the bundle schema (`tessera.bundle/v3`, which carries policy v3)
are decided there. The endpoint and field shape, human-readable policy and JEV
context rules below still apply to policy v3.

## Context

`tessera.policy/v1` (ADR-0004) lists endpoints with `string_length` steps and
one whole-policy human-readable intent. Administrators need a readable
statement per endpoint that they can edit. The proxy also needs to know what
legitimate traffic for an endpoint or field looks like when it asks JEV to
classify a request. Static analysis can derive more than lengths (types,
formats, enumerations, ranges, body limits), but only tools the proxy
implements may be compiled.

## Decision

- `tessera.policy/v2` lists endpoints. Each endpoint has `method`, `path`, an
  editable `humanReadablePolicy`, endpoint-level `requestTools`, a `jevContext` and
  `fields`. Each field has `name` (a dot path, with `[]` for array items),
  `location`, `type`, `required`, field-level `tools` and its own `jevContext`.
- Each field also has a `humanReadablePolicy` (at most 500 characters). It
  states what that field's tools check and what they cannot check yet.
- **The human-readable policy is never enforced.** Editing the policy of an
  endpoint or field compiles it into that endpoint's tools and JEV context.
  - The compiler regenerates only that endpoint from its stored analysis facts
    (an `endpoint_edit` attempt). Its result is a **preview** in the policy
    editor's draft. The administrator accepts or discards it.
  - The draft can also change tools and JEV context directly. It cannot add or
    remove endpoints or fields.
  - Saving the draft creates one new pending version. Its origin lists the
    endpoints that changed.
  - The ADR-0007 precision warning still applies.
  - Until the compiler is implemented, the preview returns the endpoint
    unchanged and says so.
- **JEV context is free text** of bounded length (endpoint 1,500 characters,
  field 500; `null` means none). It describes the purpose of the endpoint or
  field and what legitimate input looks like.
  - It is derived from untrusted repository content and reaches JEV at runtime,
    so it is a prompt-injection path into the classifier. Mitigations: credential
    detection; a lint that flags instruction-like or verdict-like phrasing for
    the reviewer; human approval; and the proxy must present it to JEV as data,
    never as instructions.
- **Tool registry.** One registry module defines the compiler rules, the JSON
  schema and the tool documentation given to the model.
  - `tessera.tools/v2` contains exactly the tools the proxy implements today, with
    the proxy's identifiers and scopes (`field`, `file`, `full`):
    - field: `string_length`, `zod_type_check`, `integer_range`, `sql_injection`,
      `command_injection`, `xss`, `path_traversal`, `null_byte`,
      `control_character`, `url_validator`, `ssrf`;
    - file: `mime_type`, `file_size`, `archive_expansion_ratio`;
    - full: `json_schema`, `request_size`, `rate_limit`, `duplicate_request`,
      `sequence_analysis`, `private_ip`.
  - Placement: field tools go on fields, file tools only on multipart `file`
    fields, full tools on the endpoint. The compiler rejects a tool at the wrong
    scope, and an unknown tool.
  - Tools announced but not implemented (NoSQL injection, prototype pollution,
    open redirect, invalid bearer, JWT validation, session fixation, profanity
    filter) join the registry only when the proxy implements them. Until then the
    analysis records the need as an endpoint limitation.
  - **Tools carry no configuration.** The proxy hard-codes its limits today, so a
    policy only selects tools. Limits the analysis observes stay as facts and are
    named in the human-readable policy as not yet enforced. Configuration will be
    a later contract change made together with the proxy.
  - `required` is a field property, not a tool. Stateful tools chosen from an
    endpoint's purpose rather than from code are marked inferred and flagged for
    review.
- **Bundles.** `tessera.bundle/v2` already exists (ADR-0012): it carries
  runtime decision settings together with the v1 policy and tool registry
  `tessera.tools/v1`. Policy v2 and `tessera.tools/v2` therefore need a later
  bundle schema (provisionally `tessera.bundle/v3`) that carries the compiled
  v2 steps and the JEV contexts, but not the human-readable policy. It also
  carries ADR-0012's decision settings; the schema name is a decision for the
  team that owns the wire schemas (the proxy repository, per ADR-0012).
- **v1 and v2 policies coexist until deprecated.** Proxies in the field
  verify v1 and v2 bundles, so activation keeps building every schema a proxy
  still advertises, as ADR-0005 requires, until a deliberate deprecation
  decision. Negotiation through `Tessera-Bundle-Schemas` and
  `Tessera-Tool-Registries` is unchanged.

## Consequences

Policies can select many more checks than lengths, but cannot tune them yet, and administrators review and edit
them per endpoint. The proxy must implement every v2 tool and the JEV-context
handling before policy v2 can be enforced end to end. Free-text JEV context
gives the classifier richer context, but it carries an injection risk that
review must catch.
