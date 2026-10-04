/**
 * `tessera.tools/v2`: exactly the tools the proxy implements
 * (`source/core/static-analysis/tools` in the proxy repository), with the
 * proxy's identifiers and context types. Tools carry no configuration yet;
 * the proxy hard-codes their limits (ADR-0010).
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
    category: 'schema',
    scope: 'field',
    stateful: false,
    useWhen:
      'A string field whose length the application limits or clearly expects to be short (names, codes, identifiers).',
  },
  {
    id: 'zod_type_check',
    category: 'schema',
    scope: 'field',
    stateful: false,
    useWhen:
      'A field the application expects to have one type (number, boolean, string, array or object).',
  },
  {
    id: 'integer_range',
    category: 'schema',
    scope: 'field',
    stateful: false,
    useWhen:
      'An integer field the application bounds or expects to be non-negative (ids, counts, page sizes, quantities).',
  },
  {
    id: 'json_schema',
    category: 'schema',
    scope: 'full',
    stateful: false,
    useWhen:
      'An endpoint whose JSON body has a defined shape (DTO, schema or model validation).',
  },
  {
    id: 'mime_type',
    category: 'schema',
    scope: 'file',
    stateful: false,
    useWhen:
      'An uploaded file the application expects to be of specific types (images, PDFs, archives).',
  },
  {
    id: 'sql_injection',
    category: 'injection',
    scope: 'field',
    stateful: false,
    useWhen:
      'A field that reaches a SQL query, query builder or ORM raw query.',
  },
  {
    id: 'command_injection',
    category: 'injection',
    scope: 'field',
    stateful: false,
    useWhen:
      'A field that reaches a shell command, process execution or system call.',
  },
  {
    id: 'xss',
    category: 'injection',
    scope: 'field',
    stateful: false,
    useWhen:
      'A field that is stored or reflected into HTML, templates or other rendered output.',
  },
  {
    id: 'path_traversal',
    category: 'injection',
    scope: 'field',
    stateful: false,
    useWhen:
      'A field used to build a filesystem path, file name or storage key.',
  },
  {
    id: 'null_byte',
    category: 'injection',
    scope: 'field',
    stateful: false,
    useWhen:
      'A field passed to filesystem, native or C-backed APIs where a NUL byte could truncate it.',
  },
  {
    id: 'control_character',
    category: 'injection',
    scope: 'field',
    stateful: false,
    useWhen:
      'A field written to logs, headers, files or terminals where control characters could forge content.',
  },
  {
    id: 'url_validator',
    category: 'url',
    scope: 'field',
    stateful: false,
    useWhen: 'A field the application expects to be a URL.',
  },
  {
    id: 'ssrf',
    category: 'url',
    scope: 'field',
    stateful: false,
    useWhen:
      'A field used as or in a URL or host the server fetches or connects to (webhooks, imports, previews, callbacks).',
  },
  {
    id: 'file_size',
    category: 'resource',
    scope: 'file',
    stateful: false,
    useWhen: 'Any endpoint field that accepts an uploaded file.',
  },
  {
    id: 'archive_expansion_ratio',
    category: 'resource',
    scope: 'file',
    stateful: false,
    useWhen:
      'An uploaded file the application unpacks or decompresses (zip, tar, gzip, office documents).',
  },
  {
    id: 'request_size',
    category: 'resource',
    scope: 'full',
    stateful: false,
    useWhen:
      'An endpoint that accepts a request body, especially without a body size limit in the application.',
  },
  {
    id: 'rate_limit',
    category: 'resource',
    scope: 'full',
    stateful: true,
    useWhen:
      'An endpoint that is expensive or abuse-prone: login, registration, password reset, OTP, search, sending messages, payments.',
  },
  {
    id: 'duplicate_request',
    category: 'anomaly',
    scope: 'full',
    stateful: true,
    useWhen:
      'A state-changing endpoint where a replayed request causes harm (payments, orders, transfers, votes).',
  },
  {
    id: 'sequence_analysis',
    category: 'anomaly',
    scope: 'full',
    stateful: true,
    useWhen:
      'An endpoint that is a step in a flow attackers enumerate or brute-force (authentication, enumeration of ids).',
  },
  {
    id: 'private_ip',
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
