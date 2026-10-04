import { detectSecrets, redactSecrets } from '../../common/secret-detection.js';
import type {
  EndpointFindingDto,
  EvidenceDto,
  ScopePolicySubmissionDto,
  ToolChoiceDto,
} from '../../contracts/analysis/v2/analysis-agent.contract.js';
import { jevContextReadsAsInstruction } from '../../contracts/policy/v2/policy.contract.js';
import {
  POLICY_SCHEMA_V3,
  ScopePolicyV3,
  StructuredPolicyV3,
} from '../../contracts/policy/v3/policy.contract.js';
import {
  findToolV3,
  TOOL_REGISTRY_V3,
  validateToolConfig,
} from '../../contracts/tools/v3/tool-registry.js';
import { normalizeRoutePath } from '../../repo-host/paths.js';
import type {
  AnalysisScopes,
  EndpointField,
  EndpointRecord,
  Evidence,
  ScopeRecord,
  ToolChoice,
} from './analysis.types.js';

const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 } as const;

export interface ReconcileCounters {
  discardedEvidence: number;
  downgradedFindings: number;
}

export class InvalidEndpointError extends Error {}

const clean = (value: string): string => redactSecrets(value).text;

/**
 * Keeps the model's tool choices that sit at `scope`, may be chosen by a
 * model, and carry a configuration the proxy accepts; every dropped choice
 * leaves a warning. The configuration arrives as a JSON string.
 */
function chooseTools<Choice extends ToolChoiceDto>(
  choices: Choice[],
  scope: 'full' | 'field' | 'file',
  where: string,
  warnings: string[],
): (Omit<Choice, 'configJson'> & ToolChoice)[] {
  const seen = new Set<string>();
  const kept: (Omit<Choice, 'configJson'> & ToolChoice)[] = [];
  for (const { configJson, ...choice } of choices) {
    const tool = findToolV3(choice.toolId);
    if (!tool || tool.scope !== scope) {
      warnings.push(
        `Dropped ${choice.toolId} from ${where}: it applies to ${tool?.scope ?? 'unknown'} scope.`,
      );
      continue;
    }
    if (!tool.aiSelectable) {
      warnings.push(
        `Dropped ${choice.toolId} from ${where}: operators configure it with the proxy.`,
      );
      continue;
    }
    if (seen.has(choice.toolId)) continue;
    let config: unknown;
    try {
      config = JSON.parse(configJson.trim() || '{}');
    } catch {
      config = null;
    }
    if (
      config === null ||
      typeof config !== 'object' ||
      Array.isArray(config)
    ) {
      warnings.push(
        `Dropped ${choice.toolId} from ${where}: its configuration is not a JSON object.`,
      );
      continue;
    }
    const issues = validateToolConfig(choice.toolId, config);
    if (issues.length > 0) {
      warnings.push(
        `Dropped ${choice.toolId} from ${where}: invalid configuration (${issues.slice(0, 3).join('; ')}).`,
      );
      continue;
    }
    if (detectSecrets(configJson).length > 0) {
      warnings.push(
        `Dropped ${choice.toolId} from ${where}: its configuration looks like it contains a credential.`,
      );
      continue;
    }
    seen.add(choice.toolId);
    kept.push({
      ...choice,
      rationale: clean(choice.rationale),
      config: config as Record<string, unknown>,
    });
  }
  return kept;
}

function lintJevContext(
  value: string | null,
  where: string,
  warnings: string[],
): string | null {
  if (value === null) return null;
  const redacted = clean(value);
  if (jevContextReadsAsInstruction(redacted)) {
    warnings.push(
      `JEV context of ${where} reads like an instruction or verdict; review it before approval.`,
    );
  }
  return redacted;
}

/**
 * Turns one validated submission into an endpoint record. Evidence must point
 * at real lines; tools must sit at their registry scope; all text is redacted.
 */
export function toEndpointRecord(
  endpoint: EndpointFindingDto,
  lineCounts: Map<string, number>,
  workItemId: string,
  counters: ReconcileCounters,
): EndpointRecord {
  const path = normalizeRoutePath(endpoint.path);
  if (!path)
    throw new InvalidEndpointError('Endpoint path is not a valid route');
  const warnings: string[] = [];
  const verify = (evidence: EvidenceDto[]): Evidence[] => {
    const kept = evidence.filter((item) => {
      const lines = lineCounts.get(item.path);
      return (
        lines !== undefined &&
        item.startLine <= item.endLine &&
        item.endLine <= lines
      );
    });
    counters.discardedEvidence += evidence.length - kept.length;
    return kept.map((item) => ({
      path: item.path,
      startLine: item.startLine,
      endLine: item.endLine,
    }));
  };
  const choose = (
    choices: ToolChoiceDto[],
    scope: 'full' | 'field' | 'file',
    where: string,
  ): ToolChoice[] => chooseTools(choices, scope, where, warnings);
  const lint = (value: string | null, where: string): string | null =>
    lintJevContext(value, where, warnings);

  const fieldKeys = new Set<string>();
  const fields: EndpointField[] = [];
  for (const field of endpoint.fields) {
    const key = `${field.location}:${field.name}`;
    if (fieldKeys.has(key)) continue;
    fieldKeys.add(key);
    fields.push({
      name: field.name,
      location: field.location,
      type: field.type,
      required: field.required,
      constraints: field.constraints.map(clean),
      evidence: verify(field.evidence),
      tools: choose(
        field.tools,
        field.location === 'file' ? 'file' : 'field',
        `field ${field.name}`,
      ),
      humanReadablePolicy: clean(field.humanReadablePolicy),
      jevContext: lint(field.jevContext, `field ${field.name}`),
    });
  }

  const handler = endpoint.handler
    ? (verify([endpoint.handler])[0] ?? null)
    : null;
  if (endpoint.handler && !handler)
    warnings.push('The handler location could not be verified.');

  return {
    method: endpoint.method,
    path,
    handler,
    confidence: endpoint.confidence,
    auth: {
      required: endpoint.auth.required,
      mechanism: clean(endpoint.auth.mechanism),
      evidence: verify(endpoint.auth.evidence),
    },
    contentTypes: endpoint.contentTypes,
    observedLimits: endpoint.observedLimits.map((limit) => ({
      subject: clean(limit.subject),
      limit: clean(limit.limit),
      evidence: verify(limit.evidence),
    })),
    sinks: endpoint.sinks.map((sink) => ({
      kind: sink.kind,
      field: sink.field,
      evidence: verify(sink.evidence),
    })),
    fields,
    requestTools: choose(endpoint.requestTools, 'full', 'the endpoint'),
    jevContext: lint(endpoint.jevContext, 'the endpoint'),
    humanReadablePolicy: clean(endpoint.humanReadablePolicy),
    limitations: endpoint.limitations.map(clean),
    findings: endpoint.findings.map((finding) => {
      const evidence = verify(finding.evidence);
      const downgrade = finding.basis === 'observed' && evidence.length === 0;
      if (downgrade) counters.downgradedFindings++;
      return {
        category: finding.category,
        severity: finding.severity,
        title: clean(finding.title),
        description: clean(finding.description),
        basis: downgrade ? 'inferred' : finding.basis,
        evidence,
      };
    }),
    warnings,
    workItemIds: [workItemId],
  };
}

/**
 * Turns a global or environment submission into a scope record. Global
 * evidence must point at real lines (`lineCounts`); environment policies rest
 * on snapshot facts and carry no code evidence.
 */
export function toScopeRecord(
  submission: ScopePolicySubmissionDto,
  scope: 'global' | 'environment',
  lineCounts: Map<string, number>,
  counters: ReconcileCounters,
): ScopeRecord {
  const warnings: string[] = [];
  const evidence = submission.evidence.filter((item) => {
    const lines = lineCounts.get(item.path);
    return (
      lines !== undefined &&
      item.startLine <= item.endLine &&
      item.endLine <= lines
    );
  });
  counters.discardedEvidence += submission.evidence.length - evidence.length;
  const where = `the ${scope} policy`;
  return {
    humanReadablePolicy: clean(submission.humanReadablePolicy),
    requestTools: chooseTools(submission.requestTools, 'full', where, warnings),
    fieldTools: chooseTools(submission.fieldTools, 'field', where, warnings)
      .filter((tool) => tool.locations.length > 0)
      .map((tool) => ({ ...tool, locations: [...new Set(tool.locations)] })),
    jevContext: lintJevContext(submission.jevContext, where, warnings),
    evidence: evidence.map(({ path, startLine, endLine }) => ({
      path,
      startLine,
      endLine,
    })),
    limitations: submission.limitations.map(clean),
    warnings,
  };
}

/** Every evidence path in a scope submission, for one line-count lookup. */
export function scopeEvidencePaths(
  submission: ScopePolicySubmissionDto,
): string[] {
  return [...new Set(submission.evidence.map((item) => item.path))];
}

/** Every evidence path in a submission, for one line-count lookup. */
export function evidencePaths(endpoint: EndpointFindingDto): string[] {
  const paths = new Set<string>();
  const add = (evidence: EvidenceDto[]) =>
    evidence.forEach((item) => paths.add(item.path));
  if (endpoint.handler) paths.add(endpoint.handler.path);
  add(endpoint.auth.evidence);
  endpoint.observedLimits.forEach((limit) => add(limit.evidence));
  endpoint.sinks.forEach((sink) => add(sink.evidence));
  endpoint.fields.forEach((field) => add(field.evidence));
  endpoint.findings.forEach((finding) => add(finding.evidence));
  return [...paths];
}

/** One record per method and path; the most confident wins. */
export function mergeEndpoints(records: EndpointRecord[]): {
  endpoints: EndpointRecord[];
  duplicateWorkItemIds: string[];
} {
  const byKey = new Map<string, EndpointRecord>();
  const duplicates: string[] = [];
  for (const record of records) {
    const key = `${record.method} ${record.path}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...record, workItemIds: [...record.workItemIds] });
      continue;
    }
    const better =
      CONFIDENCE_RANK[record.confidence] <
        CONFIDENCE_RANK[existing.confidence] ||
      (record.confidence === existing.confidence &&
        record.fields.length > existing.fields.length);
    const winner = better ? record : existing;
    const loser = better ? existing : record;
    duplicates.push(...loser.workItemIds);
    byKey.set(key, {
      ...winner,
      workItemIds: [...winner.workItemIds, ...loser.workItemIds],
    });
  }
  return {
    endpoints: [...byKey.values()].sort((a, b) =>
      a.path === b.path
        ? a.method.localeCompare(b.method)
        : a.path.localeCompare(b.path),
    ),
    duplicateWorkItemIds: duplicates,
  };
}

const EMPTY_SCOPE: ScopePolicyV3 = {
  humanReadablePolicy: '',
  requestTools: [],
  fieldTools: [],
  jevContext: null,
};

function toScopePolicy(record: ScopeRecord | null): ScopePolicyV3 {
  if (!record) return EMPTY_SCOPE;
  return {
    humanReadablePolicy: record.humanReadablePolicy,
    requestTools: record.requestTools.map((tool) => ({
      toolId: tool.toolId,
      config: tool.config ?? {},
    })),
    fieldTools: record.fieldTools.map((tool) => ({
      toolId: tool.toolId,
      config: tool.config ?? {},
      locations: tool.locations,
    })),
    jevContext: record.jevContext,
  };
}

/** The pending `tessera.policy/v3` proposal (ADR-0021); nothing here is approved. */
export function buildPolicyProposal(
  endpoints: EndpointRecord[],
  scopes: AnalysisScopes,
): StructuredPolicyV3 {
  return {
    schemaVersion: POLICY_SCHEMA_V3,
    toolRegistryVersion: TOOL_REGISTRY_V3,
    global: toScopePolicy(scopes.global),
    environment: {
      ...toScopePolicy(scopes.environment),
      environmentSnapshotId: scopes.environment
        ? scopes.environmentSnapshotId
        : null,
    },
    endpoints: endpoints.slice(0, 500).map((endpoint) => ({
      method: endpoint.method,
      path: endpoint.path,
      humanReadablePolicy: endpoint.humanReadablePolicy,
      requestTools: endpoint.requestTools.map((tool) => ({
        toolId: tool.toolId,
        config: tool.config ?? {},
      })),
      jevContext: endpoint.jevContext,
      fields: endpoint.fields.slice(0, 200).map((field) => ({
        name: field.name,
        location: field.location,
        type: field.type,
        required: field.required,
        // Analyses from before field-level policies have no text.
        humanReadablePolicy: field.humanReadablePolicy ?? '',
        tools: field.tools.map((tool) => ({
          toolId: tool.toolId,
          config: tool.config ?? {},
        })),
        jevContext: field.jevContext,
      })),
    })),
  };
}
