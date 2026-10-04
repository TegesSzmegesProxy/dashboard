# 0019: Deployment-configured AI model

## Status

Accepted. Supersedes ADR-0010 and ADR-0017, and the AI key parts of ADR-0015.

## Context

ADR-0010 and ADR-0015 made every organization bring its own AI key, stored
encrypted and set in the dashboard, and ADR-0017 let it point analyses at a
local model by URL. In practice one deployment uses one model. A card in the
dashboard asked for a provider and key that the operator already decides,
analyses could not run before an organization had saved one, and a URL chosen
in the dashboard needed SSRF defenses (ADR-0017) that an operator-set URL
does not.

## Decision

- **The deployment chooses the model, in its environment.** The dashboard
  neither shows nor changes it.
  - `ANTHROPIC_ANALYSIS_MODEL` names the model, and `ANTHROPIC_POLICY_MODEL`
    the one for policy edits.
  - `ANTHROPIC_API_KEY` is the key, used for analyses and policy edits.
  - `ANALYSIS_AI_BASE_URL` selects a self-hosted Anthropic-compatible model
    for analyses instead. When it is set, no key is sent to it, and
    `ANTHROPIC_API_KEY` is never attached to its requests. Redirects are
    refused.
  - With neither, no model is configured: starting an analysis or approving
    its budget fails with `409`, and a running one fails with
    `AI_NOT_CONFIGURED`.
- **The key is never exposed.** One service holds it. The dashboard receives
  only `{ configured, model, mode }` from
  `GET /organizations/:organizationId/projects/:tenantId/analysis-readiness`.
- **Removed.** The organization AI model credential: its
  `GET`/`PUT`/`DELETE .../integrations/ai-model` routes, its encrypted storage
  and URL validation, `AI_MODEL_ALLOW_PRIVATE_BASE_URL`, and the errors
  `AI_CREDENTIAL_MISSING`, `AI_CREDENTIAL_UNAVAILABLE`,
  `AI_ENDPOINT_NOT_ALLOWED` and `AI_ENDPOINT_UNRESOLVED`. Existing records in
  the `aiModelCredentials` collection are no longer read; the operator can drop
  them. Provider errors from the key keep their codes (ADR-0015):
  `AI_CREDENTIAL_INVALID` fails the analysis and `AI_QUOTA_EXCEEDED` pauses it.
- **Analyses can start from the dashboard.** `POST
  /organizations/:organizationId/projects/:tenantId/analyses` (owner or admin,
  `Idempotency-Key`) analyzes the head of the default branch of the project's
  bound repository, without a collector upload.
  - It refuses with `409` when no model is configured, the sandbox is not
    configured, no repository is bound, or an analysis of the project is
    already unfinished.
  - The analysis has no upload (`uploadId` is null) and records who started
    it. Its estimate, budget approval, environment snapshot and policy review
    mode work as for any other analysis.

## Consequences

An organization no longer pays for analyses with its own key: the operator
pays, and the budget ceiling (ADR-0015) is the only per-analysis control. A
hosted multi-tenant deployment therefore needs its own cost and abuse
controls. In exchange, nothing about the model is stored in the database, a
reversible customer secret is gone, and analyses run as soon as GitHub is
connected.

Changing the model needs a redeploy. All projects of a deployment use the
same model.
