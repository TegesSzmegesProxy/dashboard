# 0020: Provider-neutral AI layer and Google Gemini

## Status

Accepted. Amends ADR-0019.

## Context

ADR-0019 lets the deployment choose one model, but the code spoke only the
Anthropic Messages API: the agent loop, the tool definitions and policy
generation all used the Anthropic SDK types. A self-hosted model had to
imitate that API, and Google Gemini, which has no Anthropic-compatible
endpoint, could not be used.

Which vendor receives redacted source (ADR-0013) is a data-handling choice
that the operator must make on purpose.

## Decision

- **A provider-neutral interface.** `LlmClient` (`chat`, `generateJson`,
  `ping`) and its neutral message, tool and usage types are the only AI
  surface the agent loop, the analysis pipeline and policy generation use.
  Vendor SDKs appear only inside the adapters in
  `backend/src/infrastructure/ai/llm/`. Tool schemas and submit tools stay
  plain JSON Schema.
- **Two adapters.**
  - Anthropic keeps what it had: beta features, server-side fallbacks,
    context clearing, task budgets, adaptive thinking and prompt caching. It
    also serves the keyless self-hosted mode (`local`).
  - Gemini uses `@google/genai` with function calling and JSON-schema
    responses. It keeps each model turn as the provider returned it (thought
    signatures) and replays it on the next request. It uses the model's
    default thinking, caching and context handling, and has no server-side
    context clearing; the agent's `record_note` tool and the turn and spend
    limits still bound a run.
- **Selection is explicit.** `AI_PROVIDER` is `anthropic` or `gemini`.
  - With one of `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or `AI_BASE_URL` set,
    that one is used.
  - With more than one set, `AI_PROVIDER` is required, and the process
    refuses to start without it. There is no default vendor.
  - `AI_BASE_URL` is valid only for the Anthropic provider.
  - `AI_MODEL` is required for Gemini. It defaults to `claude-opus-5-5`
    otherwise.
- **Spend limits are unchanged.** A Gemini response is reported as input,
  output and cached tokens (thinking tokens count as output). Prices come
  from the price table; a model that is not in it is charged at the most
  expensive known price (ADR-0015), so a Gemini deployment sets
  `AI_PRICE_TABLE` for its model. No Gemini prices are built in.
- **Provider errors map to the same codes** (`AI_CREDENTIAL_INVALID`,
  `AI_QUOTA_EXCEEDED`, `PROVIDER_UNAVAILABLE`, `REFUSED`, `OUTPUT_TRUNCATED`),
  so analyses pause, fail or retry exactly as before.
- **The readiness and model-check responses** report `mode` as `anthropic`,
  `local` or `gemini`. They never include a key or URL.

## Consequences

Adding another provider means one adapter and an `AI_PROVIDER` value, not a
change to the agent or the pipeline.

- Providers differ in how well they follow tool schemas. Submissions are
  validated and a rejected one is returned to the model for up to two
  corrections; a weaker model can still fail an analysis.
- Gemini input is billed and limited by Google's terms, and redacted source
  leaves for Google when it is selected. A deployment that must keep
  source with one vendor sets `AI_PROVIDER` and a single key.
- The Gemini adapter has been checked against the SDK's types and a stubbed
  client, not against the live API in this repository.
