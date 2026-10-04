import { redactSecrets } from '../../common/secret-detection.js';
import type {
  EndpointFindingDto,
  EvidenceDto,
} from '../../contracts/analysis/v2/analysis-agent.contract.js';
import {
  jevContextReadsAsInstruction,
  POLICY_SCHEMA_V2,
  StructuredPolicyV2,
} from '../../contracts/policy/v2/policy.contract.js';
import {
  findTool,
  TOOL_REGISTRY_V2,
} from '../../contracts/tools/v2/tool-registry.js';
import { normalizeRoutePath } from '../../repo-host/paths.js';
import type {
  EndpointField,
  EndpointRecord,
  Evidence,
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
    choices: ToolChoice[],
    scope: 'full' | 'field' | 'file',
    where: string,
  ): ToolChoice[] => {
    const seen = new Set<string>();
    return choices
      .filter((choice) => {
        if (findTool(choice.toolId)?.scope !== scope) {
          warnings.push(
            `Dropped ${choice.toolId} from ${where}: it applies to ${findTool(choice.toolId)?.scope ?? 'unknown'} scope.`,
          );
          return false;
        }
        if (seen.has(choice.toolId)) return false;
        seen.add(choice.toolId);
        return true;
      })
      .map((choice) => ({ ...choice, rationale: clean(choice.rationale) }));
  };
  const lint = (value: string | null, where: string): string | null => {
    if (value === null) return null;
    const redacted = clean(value);
    if (jevContextReadsAsInstruction(redacted)) {
      warnings.push(
        `JEV context of ${where} reads like an instruction or verdict; review it before approval.`,
      );
    }
    return redacted;
  };

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

/** The pending `tessera.policy/v2` proposal; nothing here is approved. */
export function buildPolicyProposal(
  endpoints: EndpointRecord[],
): StructuredPolicyV2 {
  return {
    schemaVersion: POLICY_SCHEMA_V2,
    toolRegistryVersion: TOOL_REGISTRY_V2,
    endpoints: endpoints.slice(0, 500).map((endpoint) => ({
      method: endpoint.method,
      path: endpoint.path,
      humanReadablePolicy: endpoint.humanReadablePolicy,
      requestTools: endpoint.requestTools.map((tool) => ({
        toolId: tool.toolId,
      })),
      jevContext: endpoint.jevContext,
      fields: endpoint.fields.slice(0, 200).map((field) => ({
        name: field.name,
        location: field.location,
        type: field.type,
        required: field.required,
        // Analyses from before field-level policies have no text.
        humanReadablePolicy: field.humanReadablePolicy ?? '',
        tools: field.tools.map((tool) => ({ toolId: tool.toolId })),
        jevContext: field.jevContext,
      })),
    })),
  };
}
