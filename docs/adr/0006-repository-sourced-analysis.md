# 0006: Repository-sourced application analysis

## Status

Accepted

## Context

Phase 5 needs application source and environment context for analysis. The
original design had the collector redact source in the customer's CI and
upload it. The product decision is that the collector must not upload source
files; source comes from the customer's GitHub repository. That moves source
handling, and therefore redaction, into the control plane. Upload limits,
retention, storage and the AI provider were open decisions (plan item 7).

## Decision

- **Source access** uses a Tessera GitHub App with read-only Contents and
  Metadata permissions. An organization links an installation only by
  completing the App's setup flow. The control plane exchanges the OAuth code
  once and confirms that the authorizing user can access that installation.
  An installation belongs to exactly one organization. The App private key is
  deployment secret material; installation tokens are short-lived, scoped to
  one repository, and never stored.
- **Repository binding**: an organization owner or admin binds one repository
  to a project. Collectors cannot choose the repository.
- **Collector upload** (`tessera.analysis-upload/v1`) carries only the commit
  SHA, collector identity, environment tool results (dependencies,
  vulnerabilities, tool status) and the collector's redaction summary. It
  never contains files. Uploads require an `Idempotency-Key`; content-identical
  uploads resolve to the existing upload. An upload containing a detectable
  credential is rejected with 422 and nothing is stored.
- **Control-side filtering and redaction**: the commit tarball is read in
  memory and never extracted to disk. Only allowlisted source and
  configuration files are retained: at most 2,000 files, 256 KiB per file and
  2 MiB in total. Dependency directories, credential-bearing files (`.env*`,
  keys, certificates, `.npmrc`, Terraform state and similar) and files
  containing private-key blocks are excluded. Remaining detectable
  credentials are replaced with `<redacted:rule>` markers before storage or
  AI processing. A source manifest records every retained file and its
  redactions, plus exclusion counts, and is visible in the dashboard.
- **Retention**: raw collector packages are deleted when their analysis
  finishes, whether it succeeds or fails. Deletion is retried until it
  succeeds. The redacted source snapshot exists only in worker memory.
  Derived analyses are kept as immutable versions.
- **Storage**: transient objects use local filesystem storage behind an
  `ObjectStorage` interface. Running more than one instance requires a shared
  volume.
- **AI provider**: a provider-independent `ApplicationAnalysisProvider`
  interface, implemented with the Claude API. The default model is
  `claude-opus-5-5` with server-side refusal fallbacks enabled. Output is
  requested as JSON schema and re-validated as untrusted input. Evidence must
  reference retained files and valid line ranges. Without
  `ANTHROPIC_API_KEY` the AI step is recorded as skipped.
- **Orchestration**: each analysis document is a durable job claimed with a
  lease. Retryable GitHub and AI outages back off and retry, up to three
  attempts. Completion commits results and an `AnalysisCompleted` or
  `AnalysisFailed` outbox event in one transaction. Partial step failures are
  preserved with status `partial`.

## Consequences

The control plane now handles unredacted customer source, transiently and in
memory, and sends the redacted subset to Anthropic. Redaction is best-effort
pattern matching; customers must not rely on it instead of keeping secrets
out of Git. Self-hosted Git servers and other providers are unsupported. The
GitHub fork network can make fork commits reachable through the parent
repository. Analyses cannot be re-run from a deleted raw package; a new
upload is required. The outbox has no external relay; Phase 6 consumes
`AnalysisCompleted` in-process (ADR-0007).
