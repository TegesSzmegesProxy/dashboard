/**
 * `tessera.tools/v2`: exactly the tools the proxy implements
 * (`source/core/static-analysis/tools` in the proxy repository), with the
 * proxy's identifiers and context types. Tools carry no configuration yet;
 * the proxy hard-codes their limits (ADR-0014).
 *
 * This module is the single source for the compiler, the JSON schemas given
 * to the model and the tool documentation in the analysis prompts.
 */
export const TOOL_REGISTRY_V2 = 'tessera.tools/v2' as const;

export const TOOL_CATEGORIES = [
  'schema',
  'injection',
  'url',
  'resource',
  'anomaly',
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/** The proxy's `ToolContextType`: one field, one uploaded file, or the request. */
export const TOOL_SCOPES = ['field', 'file', 'full'] as const;
export type ToolScope = (typeof TOOL_SCOPES)[number];

export interface ToolDefinition {
  id: string;
  /** Short name for people, e.g. in the policy editor. */
  label: string;
  /** What the proxy checks, in one plain sentence. */
  summary: string;
  category: ToolCategory;
  scope: ToolScope;
  /** When an analysis should choose the tool; shown to the model. */
  useWhen: string;
  /**
   * The tool needs runtime state (rates, sequences) that code rarely shows;
   * choosing it from an endpoint's purpose is an inference for review.
   */
  stateful: boolean;
}

export const TOOL_DEFINITIONS = [
  {
    id: 'string_length',
    label: 'Length limit',
    summary: 'Rejects values that are longer or shorter than the proxy allows.',
    category: 'schema',
    scope: 'field',
    stateful: false,
    useWhen:
      'A string field whose length the application limits or clearly expects to be short (names, codes, identifiers).',
  },
  {
    id: 'zod_type_check',
    label: 'Type check',
    summary: 'Rejects values that are not of the expected type.',
    category: 'schema',
    scope: 'field',
    stateful: false,
    useWhen:
      'A field the application expects to have one type (number, boolean, string, array or object).',
  },
  {
    id: 'integer_range',
    label: 'Integer range',
    summary:
      'Rejects integers outside the allowed range, such as negative ids.',
    category: 'schema',
    scope: 'field',
    stateful: false,
    useWhen:
      'An integer field the application bounds or expects to be non-negative (ids, counts, page sizes, quantities).',
  },
  {
    id: 'json_schema',
    label: 'JSON shape',
    summary: 'Rejects JSON bodies that do not match the expected structure.',
    category: 'schema',
    scope: 'full',
    stateful: false,
    useWhen:
      'An endpoint whose JSON body has a defined shape (DTO, schema or model validation).',
  },
  {
    id: 'mime_type',
    label: 'File type',
    summary: 'Rejects uploaded files whose content type is not allowed.',
    category: 'schema',
    scope: 'file',
    stateful: false,
    useWhen:
      'An uploaded file the application expects to be of specific types (images, PDFs, archives).',
  },
  {
    id: 'sql_injection',
    label: 'SQL injection',
    summary: 'Detects SQL injection payloads.',
    category: 'injection',
    scope: 'field',
    stateful: false,
    useWhen:
      'A field that reaches a SQL query, query builder or ORM raw query.',
  },
  {
    id: 'command_injection',
    label: 'Command injection',
    summary: 'Detects shell command injection payloads.',
    category: 'injection',
    scope: 'field',
    stateful: false,
    useWhen:
      'A field that reaches a shell command, process execution or system call.',
  },
  {
    id: 'xss',
    label: 'Cross-site scripting',
    summary: 'Detects script or HTML injection payloads.',
    category: 'injection',
    scope: 'field',
    stateful: false,
    useWhen:
      'A field that is stored or reflected into HTML, templates or other rendered output.',
  },
  {
    id: 'path_traversal',
    label: 'Path traversal',
    summary: 'Detects attempts to escape a directory, such as ../ sequences.',
    category: 'injection',
    scope: 'field',
    stateful: false,
    useWhen:
      'A field used to build a filesystem path, file name or storage key.',
  },
  {
    id: 'null_byte',
    label: 'Null byte',
    summary: 'Rejects values that contain NUL bytes.',
    category: 'injection',
    scope: 'field',
    stateful: false,
    useWhen:
      'A field passed to filesystem, native or C-backed APIs where a NUL byte could truncate it.',
  },
  {
    id: 'control_character',
    label: 'Control characters',
    summary:
      'Rejects values that contain control characters such as line breaks in headers.',
    category: 'injection',
    scope: 'field',
    stateful: false,
    useWhen:
      'A field written to logs, headers, files or terminals where control characters could forge content.',
  },
  {
    id: 'url_validator',
    label: 'URL format',
    summary: 'Rejects values that are not well-formed URLs.',
    category: 'url',
    scope: 'field',
    stateful: false,
    useWhen: 'A field the application expects to be a URL.',
  },
  {
    id: 'ssrf',
    label: 'Server-side request forgery',
    summary: 'Detects URLs that point at internal or metadata addresses.',
    category: 'url',
    scope: 'field',
    stateful: false,
    useWhen:
      'A field used as or in a URL or host the server fetches or connects to (webhooks, imports, previews, callbacks).',
  },
  {
    id: 'file_size',
    label: 'File size',
    summary: 'Rejects uploaded files above the size limit.',
    category: 'resource',
    scope: 'file',
    stateful: false,
    useWhen: 'Any endpoint field that accepts an uploaded file.',
  },
  {
    id: 'archive_expansion_ratio',
    label: 'Archive bomb',
    summary: 'Rejects archives that expand far beyond their compressed size.',
    category: 'resource',
    scope: 'file',
    stateful: false,
    useWhen:
      'An uploaded file the application unpacks or decompresses (zip, tar, gzip, office documents).',
  },
  {
    id: 'request_size',
    label: 'Request size',
    summary: 'Rejects request bodies above the size limit.',
    category: 'resource',
    scope: 'full',
    stateful: false,
    useWhen:
      'An endpoint that accepts a request body, especially without a body size limit in the application.',
  },
  {
    id: 'rate_limit',
    label: 'Rate limiting',
    summary: 'Limits how often one client may call the endpoint.',
    category: 'resource',
    scope: 'full',
    stateful: true,
    useWhen:
      'An endpoint that is expensive or abuse-prone: login, registration, password reset, OTP, search, sending messages, payments.',
  },
  {
    id: 'duplicate_request',
    label: 'Replay protection',
    summary: 'Detects the same request being sent again.',
    category: 'anomaly',
    scope: 'full',
    stateful: true,
    useWhen:
      'A state-changing endpoint where a replayed request causes harm (payments, orders, transfers, votes).',
  },
  {
    id: 'sequence_analysis',
    label: 'Sequence analysis',
    summary: 'Detects enumeration and brute-force patterns across requests.',
    category: 'anomaly',
    scope: 'full',
    stateful: true,
    useWhen:
      'An endpoint that is a step in a flow attackers enumerate or brute-force (authentication, enumeration of ids).',
  },
  {
    id: 'private_ip',
    label: 'Private address',
    summary:
      'Rejects requests that carry private or internal network addresses.',
    category: 'anomaly',
    scope: 'full',
    stateful: false,
    useWhen:
      'An endpoint whose request carries addresses or hosts that must not point at internal networks.',
  },
] as const satisfies readonly ToolDefinition[];

export type ToolId = (typeof TOOL_DEFINITIONS)[number]['id'];

export const TOOL_IDS = TOOL_DEFINITIONS.map<ToolId>((tool) => tool.id);

const BY_ID = new Map<string, ToolDefinition>(
  TOOL_DEFINITIONS.map((tool) => [tool.id, tool]),
);

export function findTool(id: string): ToolDefinition | undefined {
  return BY_ID.get(id);
}

export function toolIdsWithScope(scope: ToolScope): ToolId[] {
  return TOOL_DEFINITIONS.filter((tool) => tool.scope === scope).map(
    (tool) => tool.id,
  );
}

/**
 * Announced by the proxy but not implemented yet. Never compiled; an analysis
 * records the need as a limitation instead.
 */
export const PLANNED_TOOL_NEEDS = [
  'NoSQL injection',
  'prototype pollution',
  'open redirect',
  'invalid bearer token',
  'JWT validation',
  'session fixation',
  'profanity filtering',
] as const;
