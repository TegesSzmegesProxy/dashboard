# 0015: Customer-provided AI keys and analysis budgets

## Status

Accepted

## Context

An agentic analysis (ADR-0013) makes many model calls, so its cost depends on
the size of the repository. Customers pay for it with their own Anthropic
API key, and need to know the cost before it is incurred. AI spending must not
be controllable by repository content. ADR-0010 already stores one AI model
credential per organization, encrypted in MongoDB, and left open how
analyses would use it.

## Decision

- **Analyses use the organization's AI model credential (ADR-0010).** There is
  no second key store.
  - Only an `anthropic` credential works for analyses. Another provider, or no
    credential, stops the analysis before any model call with
    `AI_CREDENTIAL_MISSING`; a stored key that cannot be decrypted fails it with
    `AI_CREDENTIAL_UNAVAILABLE`.
  - Analyses never fall back to the platform `ANTHROPIC_API_KEY`.
  - The key is decrypted only by the analysis worker, for one job, and kept only
    in memory. It never appears in logs, errors, API responses or the frontend.
- **Estimate.** Every analysis first fetches and indexes the repository
  without any model call, then computes a low, expected and high cost in
  tokens and USD.
  - Inputs: the number of work items, the size of each item's source, fixed
    overheads, and a configurable model price table.
  - The analysis then waits in `awaiting_budget`.
- **Approval.** An owner or admin approves a budget ceiling in USD, with an
  `Idempotency-Key` and an audit entry.
  - A project may set an explicit auto-approve ceiling for automatic uploads;
    there is no default.
  - The ceiling is enforced in code after every model response. When it is
    reached, the remaining work items become `unresolved` and the analysis
    finishes as `partial`.
- **Provider errors from the customer's key:**
  - an invalid key fails the analysis with `AI_CREDENTIAL_INVALID`;
  - exhausted credit or quota pauses it with `AI_QUOTA_EXCEEDED` until it is
    resumed;
  - rate limits back off.

## Consequences

Customers control and see their AI spending, and the dashboard's existing key
screen is all they need. Analyses depend on `CREDENTIAL_ENCRYPTION_KEY`, with
the exposure and key-rotation limits ADR-0009 and ADR-0010 describe. A
deployment that prefers a secret manager would replace the credential's
storage, which is a separate decision. Estimates are approximations; the
enforced ceiling, not the estimate, bounds the spend. Usage is recorded per
work item so the estimator can be calibrated.
