# Architecture decision records

Use an ADR for a consequential, durable choice that future contributors could
reasonably reopen without knowing why it was made. Do not create ADRs for
temporary implementation details, obvious conventions, or choices that remain
undecided.

Name files `NNNN-short-title.md`, numbered in order, and use this shape:

```markdown
# NNNN: Decision title

## Status

Proposed | Accepted | Superseded by ADR-NNNN

## Context

What constraint or tension requires a decision?

## Decision

What was chosen?

## Consequences

What becomes easier, harder, or constrained?
```

Security-sensitive open questions stay in
`backend/IMPLEMENTATION_PLAN.md` until decided. Once accepted, record the
decision here and update the plan or architecture documents so they no longer
conflict.

