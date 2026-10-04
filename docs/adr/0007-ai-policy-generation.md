# 0007: AI policy generation and natural-language editing

## Status

Accepted. Automatic whole-policy generation from `AnalysisCompleted` is
superseded by ADR-0013; editing is per endpoint under ADR-0014.

## Context

Phase 6 turns analyses into policies and lets administrators change a policy
in natural language. Both use an AI model, whose output is untrusted and may
be wrong, malformed or influenced by text in the customer's repository.
Policies must stay immutable, reviewable versions, and nothing produced by a
model may become runnable or active without human approval. ADR-0006 left the
consumer of `AnalysisCompleted` to this phase.

## Decision

- **Attempts**: every generation or edit is a durable *policy generation
  attempt* (`policyGenerations`), processed by a leased worker with the same
  retry rules as analyses (three attempts, exponential backoff for retryable
  provider outages). An attempt either succeeds with a reference to a policy
  version or fails with an error code. **A failed attempt never creates a
  policy version.** Invalid output is not stored; only contract paths and
  rule names are recorded as validation issues.
- **Triggers**: an `AnalysisCompleted` event with a non-empty API surface
  queues one generation attempt automatically. Owners and admins can also
  request generation from an analysis, or an edit of any version, with an
  `Idempotency-Key`. The outbox is consumed in-process: a consumer handles an
  event and records an inbox receipt (`consumedBy`) in one transaction.
- **Validation order**: AI output (`tessera.ai-policy/v1`) must (1) match the
  contract exactly, (2) contain no detectable credential, (3) compile against
  the tool registry, and (4) when an analysis is linked, reference only
  endpoints and field names from that analysis (or the base policy, for
  edits). Failing any step fails the attempt.
- **Versions**: a successful attempt stores a compiled policy version with
  approval status `pending` and an `origin` (`generation` or `edit`, with the
  attempt, analysis, parent version and model). Content-identical output
  reuses the existing version. Generation never approves or activates.
- **Editing**: an edit instruction is admin-authored, limited to 2,000
  characters, and rejected with 422 if it contains a detectable credential.
  The edit inherits the analysis of its base version's lineage. Results
  include a structural diff against the base and the limitations the model
  could not express with the tool registry.
- **Precision warning**: every attempt and every AI-produced version carries a
  fixed warning that natural language is imprecise and that the structured
  policy, not the text, is what gets approved and enforced.
- **Provider**: a provider-independent `PolicyGenerationProvider`,
  implemented with the Claude API (`ANTHROPIC_POLICY_MODEL`, default
  `claude-opus-5-5`, server-side refusal fallbacks enabled). It receives the
  derived analysis (endpoints, fields, configuration and finding summaries)
  and, for edits, the base policy. It never receives source files.

## Consequences

The tool registry still contains only `string_length`, so generated policies
are narrow; the `limitations` list makes the gap visible instead of hiding it.
Grounding rejects output that names fields the analysis missed, so some
attempts fail where a human would have accepted the policy; importing remains
available for those cases. Edits of imported versions without an analysis
lineage are not grounded and rely on review of the diff. Every completed
analysis with an API surface costs one AI call.
