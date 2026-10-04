# 0018: Standing approval for generated policies

## Status

Proposed

## Context

ADR-0007 requires that nothing produced by a model becomes runnable or active
without human approval. Some administrators want an analysis to apply its
policy without opening the policy editor. They decide this before the
analysis runs, when they approve its budget. A silent bypass of review would
break ADR-0007. Making them approve every generated version by hand would
make the choice meaningless.

## Decision

- **Policy review mode.** Each analysis records a `policyReview` choice:
  `review` (default) or `auto_apply`.
  - The owner or admin who approves the budget chooses it.
  - When a budget is approved automatically (ADR-0015), the project's
    `defaultPolicyReviewMode` applies. It is attributed to whoever last saved
    the analysis settings, and its default is `review`.
- **Standing approval.** Choosing `auto_apply` is that person's approval of the
  version the analysis proposes, given in advance. The version is approved in
  the analysis' own transaction with `approvalSource: 'auto_apply'`. The audit
  entry names the person who made the choice.
- **Fallback to review.** The standing approval is used only when:
  - the proposal compiled;
  - it contains no detectable credential;
  - it has no review warning (reconciliation warnings, low confidence, stateful
    tools chosen from purpose, or JEV context that reads like an
    instruction).

  Otherwise the version stays pending, and the analysis records why
  (`policy.autoApplySkipped`).
- **Scope.** The standing approval covers only the version that the analysis
  proposes. A version saved from the policy editor always needs a reviewer.
- **Activation.** Activation stays a separate step. Policy v2 cannot be
  activated until a bundle schema carries it (ADR-0014). Automatic activation
  is a later decision.

## Consequences

ADR-0007's rule holds: an approval always traces back to a person. Unattended
analyses can still produce approved policies when the result is clean. Any
signal that needs human judgment sends the version back to review, so
`auto_apply` never hides a warning. Reviewers see on the version that it was
approved automatically.
