# 0013: Sandboxed agentic repository analysis

## Status

Accepted. Supersedes the source handling, size limits and AI analysis parts of
ADR-0006, and the automatic whole-policy generation step of ADR-0007.

## Context

ADR-0006 sends at most 2 MiB of redacted source, in archive order, to one model
call. For a typical 100k-line repository about half the code is dropped, which
half is arbitrary, and the model does not know what it never saw. Missed
endpoints and fields are therefore likely. Under ADR-0007 grounding, a missed
field becomes a failed or incomplete policy. A missed endpoint becomes an outage
or an unprotected route, depending on `unknownEndpointBehavior`.

Protected applications can be written in any language and framework, so the
analysis cannot depend on framework-specific tooling.

## Decision

- **Sandbox.** Each analysis runs a disposable container per job:
  - no network, read-only root filesystem, the source on an in-memory filesystem
    (tmpfs), an unprivileged user, all capabilities dropped, memory/process/time
    limits, and gVisor in production;
  - the worker fetches the commit tarball with a short-lived, repository-scoped
    installation token (the same path as ADR-0006, including private
    repositories) and streams it into the sandbox; the token never enters the
    sandbox;
  - ADR-0006's exclusion rules apply during extraction;
  - the sandbox is destroyed when the job ends, whatever the outcome;
  - source is still never persisted.
- **Language-agnostic index.** Inside the sandbox, a `repo-host` process indexes
  the repository without a model. Every repository gets at least tier 0, and
  each tier adds precision:
  - tier 0 (any text): file listing, reads and search;
  - tier 1 (a tree-sitter grammar exists): symbols, definitions, name-based
    references, structural search;
  - tier 2 (a framework pack matches): deterministic routes and
    validator-derived hints;
  - tier 3 (an optional precise indexer succeeds): type-accurate references.
  - Framework packs are optional accelerators, never prerequisites.
- **Ledger, not model memory.** A recon agent writes route rules: structural or
  regex patterns describing how this application registers routes. The sandbox
  applies them to the whole repository. Their matches are merged with API
  specifications, generic heuristics and framework-pack output into durable work
  items. One bounded agent loop resolves each item.
- **Coverage gate.** Every work item ends as `endpoint` with evidence,
  `not_an_endpoint` with a reason, or `unresolved`. Any unresolved item makes
  the analysis `partial` and is shown in the dashboard. A sweep agent examines
  files with route-like code that no worker read.
- **Read-only tools.** The model gets no shell, filesystem or network. It calls
  read-only tools that the worker executes against the sandbox. The worker
  enforces line, byte, call and time budgets and redacts credentials in every
  result before the model sees it.
- **AI read manifest.** The analysis records exactly which paths and line
  ranges were sent to the AI provider, with redaction counts. This replaces the
  retained-file list of ADR-0006.
- **Output.** A successful analysis stores evidence-backed facts and, in the
  same transaction, a pending policy version (ADR-0014). The separate automatic
  generation attempt of ADR-0007 is removed. Approval and activation are
  unchanged.
- **Provider.** The Claude API through a manual tool-use loop in the worker:
  - default model `claude-opus-5-5`, with server-side refusal fallbacks;
  - token usage recorded per analysis;
  - an independent verification pass on high-risk endpoints is optional and
    configurable.

## Consequences

The analysis is no longer limited by a fixed snapshot size, and missed
endpoints become visible instead of silent. Running containers requires the
analysis worker to be a separate deployable with access to a container runtime.
The public API container must never get the Docker socket.

One analysis now costs many model calls, so cost is recorded and incremental
re-analysis is planned. Parsing hostile repository content happens only inside
the sandbox. Precision varies by tier, and the tier is shown with the evidence.
Git submodules are not fetched.
