import Anthropic from '@anthropic-ai/sdk';
import { redactSecrets } from '../../common/secret-detection.js';
import {
  SUBMIT_ENDPOINT_SCHEMA,
  SUBMIT_RECON_SCHEMA,
  SUBMIT_SWEEP_SCHEMA,
} from '../../contracts/analysis/v2/analysis-agent.contract.js';
import { HTTP_METHODS } from '../../contracts/policy/v1/policy.contract.js';
import type { ToolExecution } from '../../infrastructure/ai/agent/agent-loop.js';
import {
  HostCallError,
  RepoSandboxSession,
} from '../../infrastructure/sandbox/repo-sandbox.js';
import type {
  FileStat,
  RuleRunResult,
  SearchHit,
  SymbolLocation,
} from '../../repo-host/protocol.js';
import type { AiReadManifest } from './analysis.types.js';

const MAX_LINE_CHARS = 500;

/** Tool inputs are schema-checked by the API; anything else becomes empty. */
const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const MAX_NOTES = 20;
const MAX_NOTE_CHARS = 500;

type Schema = Record<string, unknown>;
const strict = (
  name: string,
  description: string,
  properties: Record<string, Schema>,
): Anthropic.Beta.BetaTool => ({
  name,
  description,
  strict: true,
  input_schema: {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
});

const NAVIGATION_TOOLS: Anthropic.Beta.BetaTool[] = [
  strict(
    'list_files',
    'List repository files (path, lines, language, index tier). Filter by directory or glob; paginate with offset.',
    {
      directory: { type: ['string', 'null'] },
      glob: { type: ['string', 'null'] },
      offset: { type: 'integer' },
      limit: { type: 'integer' },
    },
  ),
  strict(
    'read_file',
    'Read lines start_line..end_line (1-based, at most 400 lines or 30 KB) of a repository file. Lines come numbered.',
    {
      path: { type: 'string' },
      start_line: { type: 'integer' },
      end_line: { type: 'integer' },
    },
  ),
  strict(
    'search_code',
    'Search the repository line by line for a literal string or a JavaScript regular expression. Returns at most 100 locations with a short preview.',
    {
      query: { type: 'string' },
      regex: { type: 'boolean' },
      case_insensitive: { type: 'boolean' },
      path_glob: { type: ['string', 'null'] },
    },
  ),
  strict(
    'find_definition',
    'Find where a symbol (function, class, method, type) is defined. Syntax-aware for indexed languages, text-based otherwise.',
    { name: { type: 'string' } },
  ),
  strict(
    'find_references',
    'Find lines that mention a symbol name (word boundary, text-based).',
    { name: { type: 'string' } },
  ),
  strict(
    'outline',
    'List the symbols declared in one file with their line ranges (indexed languages only).',
    { path: { type: 'string' } },
  ),
];

const NOTE_TOOL = strict(
  'record_note',
  'Save a short fact you will need later; old tool results may be cleared from your context.',
  { note: { type: 'string' } },
);

const TEST_RULE_TOOL = strict(
  'test_route_rule',
  'Dry-run a route rule over the repository and see the match count, sample matches and errors.',
  {
    description: { type: 'string' },
    fileGlob: { type: ['string', 'null'] },
    pattern: { type: 'string' },
    caseInsensitive: { type: 'boolean' },
    method: { type: ['string', 'null'], enum: [...HTTP_METHODS, null] },
    methodGroup: { type: ['integer', 'null'] },
    pathGroup: { type: 'integer' },
    pathPrefix: { type: 'string' },
  },
);

const submit = (name: string, description: string, schema: Schema) =>
  ({
    name,
    description,
    strict: true,
    input_schema: schema as Anthropic.Beta.BetaTool['input_schema'],
  }) satisfies Anthropic.Beta.BetaTool;

export const RECON_TOOLS: Anthropic.Beta.BetaTool[] = [
  ...NAVIGATION_TOOLS,
  NOTE_TOOL,
  TEST_RULE_TOOL,
  submit(
    'submit_recon',
    'Submit the application dossier, route rules and extra candidates. Call exactly once.',
    SUBMIT_RECON_SCHEMA,
  ),
];

export const ENDPOINT_TOOLS: Anthropic.Beta.BetaTool[] = [
  ...NAVIGATION_TOOLS,
  NOTE_TOOL,
  submit(
    'submit_endpoint',
    'Submit the resolution of your candidate with facts and the proposed endpoint policy. Call exactly once.',
    SUBMIT_ENDPOINT_SCHEMA,
  ),
];

export const SWEEP_TOOLS: Anthropic.Beta.BetaTool[] = [
  ...NAVIGATION_TOOLS,
  submit(
    'submit_sweep',
    'Submit endpoints the earlier mapping missed (possibly none). Call exactly once.',
    SUBMIT_SWEEP_SCHEMA,
  ),
];

/** Escapes invisible and control characters and cuts long lines. */
export function sanitizeLine(line: string): string {
  const escaped = line.replace(
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g,
    (character) =>
      `\\u{${character.codePointAt(0)!.toString(16).padStart(4, '0')}}`,
  );
  return escaped.length > MAX_LINE_CHARS
    ? `${escaped.slice(0, MAX_LINE_CHARS)} …[+${escaped.length - MAX_LINE_CHARS} chars]`
    : escaped;
}

/** Records exactly what reaches the AI provider (ADR-0009). */
export class ReadManifestRecorder {
  private readonly files = new Map<
    string,
    { ranges: [number, number][]; redactions: number }
  >();
  private searchPreviews = 0;
  private totalLines = 0;

  constructor(previous: AiReadManifest | null = null) {
    for (const file of previous?.files ?? []) {
      this.files.set(file.path, {
        ranges: [...file.ranges],
        redactions: file.redactions,
      });
    }
    this.searchPreviews = previous?.searchPreviews ?? 0;
    this.totalLines = previous?.totalLinesSent ?? 0;
  }

  recordRange(
    path: string,
    start: number,
    end: number,
    redactions: number,
  ): void {
    const entry = this.files.get(path) ?? { ranges: [], redactions: 0 };
    entry.ranges.push([start, end]);
    entry.redactions += redactions;
    this.files.set(path, entry);
    this.totalLines += end - start + 1;
  }

  recordPreviews(count: number): void {
    this.searchPreviews += count;
  }

  touched(path: string): boolean {
    return this.files.has(path);
  }

  toJSON(): AiReadManifest {
    return {
      files: [...this.files.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, entry]) => ({
          path,
          ranges: mergeRanges(entry.ranges),
          redactions: entry.redactions,
        })),
      searchPreviews: this.searchPreviews,
      totalLinesSent: this.totalLines,
    };
  }
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/**
 * Executes repository tools against the sandbox. Every result is sanitized
 * and redacted here, before the model sees it, and recorded in the manifest.
 */
export class RepoToolExecutor {
  readonly notes: string[] = [];

  constructor(
    private readonly session: RepoSandboxSession,
    private readonly manifest: ReadManifestRecorder,
  ) {}

  async execute(name: string, rawInput: unknown): Promise<ToolExecution> {
    const input = (rawInput ?? {}) as Record<string, unknown>;
    try {
      switch (name) {
        case 'list_files':
          return await this.listFiles(input);
        case 'read_file':
          return await this.readFile(input);
        case 'search_code':
          return await this.search(input);
        case 'find_definition':
          return await this.definitions(input);
        case 'find_references':
          return await this.references(input);
        case 'outline':
          return await this.outline(input);
        case 'record_note':
          return this.recordNote(input);
        case 'test_route_rule':
          return await this.testRule(input);
        default:
          return { content: `Unknown tool ${name}.`, isError: true };
      }
    } catch (error) {
      if (error instanceof HostCallError) {
        return { content: `${error.code}: ${error.message}`, isError: true };
      }
      throw error;
    }
  }

  private async listFiles(
    input: Record<string, unknown>,
  ): Promise<ToolExecution> {
    const result = await this.session.call<{
      total: number;
      files: FileStat[];
    }>('list_files', {
      directory: input.directory ?? null,
      glob: input.glob ?? null,
      offset: this.int(input.offset, 0, 1_000_000, 0),
      limit: this.int(input.limit, 1, 500, 200),
    });
    const lines = result.files.map(
      (file) =>
        `${sanitizeLine(file.path)}  ${file.lines} lines  ${file.language ?? 'other'}  tier ${file.tier}`,
    );
    return { content: `${result.total} files match.\n${lines.join('\n')}` };
  }

  private async readFile(
    input: Record<string, unknown>,
  ): Promise<ToolExecution> {
    const path = text(input.path);
    const start = this.int(input.start_line, 1, 10_000_000, 1);
    const end = this.int(input.end_line, start, 10_000_000, start + 199);
    const result = await this.session.call<{
      path: string;
      startLine: number;
      endLine: number;
      totalLines: number;
      truncated: boolean;
      lines: string[];
    }>('read_file', { path, startLine: start, endLine: end });
    const redacted = redactSecrets(result.lines.map(sanitizeLine).join('\n'));
    const redactions = Object.values(redacted.counts).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (result.lines.length > 0) {
      this.manifest.recordRange(
        result.path,
        result.startLine,
        result.endLine,
        redactions,
      );
    }
    const numbered = redacted.text
      .split('\n')
      .map((line, index) => `${result.startLine + index}| ${line}`)
      .join('\n');
    const header = JSON.stringify({
      path: result.path,
      startLine: result.startLine,
      endLine: result.endLine,
      totalLines: result.totalLines,
      truncated: result.truncated,
    });
    return { content: `${header}\n${numbered}` };
  }

  private async search(input: Record<string, unknown>): Promise<ToolExecution> {
    const result = await this.session.call<{
      hits: SearchHit[];
      truncated: boolean;
    }>('search', {
      query: text(input.query),
      regex: input.regex === true,
      caseInsensitive: input.case_insensitive === true,
      pathGlob: input.path_glob ?? null,
      maxResults: 100,
    });
    this.manifest.recordPreviews(result.hits.length);
    return { content: this.renderHits(result.hits, result.truncated) };
  }

  private async definitions(
    input: Record<string, unknown>,
  ): Promise<ToolExecution> {
    const result = await this.session.call<{
      method: string;
      locations: SymbolLocation[];
    }>('definitions', { name: text(input.name) });
    if (result.locations.length === 0)
      return { content: 'No definition found.' };
    return {
      content: `${result.method === 'syntax' ? 'Syntax-aware' : 'Text-based'} matches:\n${result.locations
        .map(
          (symbol) =>
            `${sanitizeLine(symbol.path)}:${symbol.startLine}-${symbol.endLine}  ${symbol.kind} ${sanitizeLine(symbol.name)}`,
        )
        .join('\n')}`,
    };
  }

  private async references(
    input: Record<string, unknown>,
  ): Promise<ToolExecution> {
    const result = await this.session.call<{
      hits: SearchHit[];
      truncated: boolean;
    }>('references', { name: text(input.name) });
    this.manifest.recordPreviews(result.hits.length);
    return { content: this.renderHits(result.hits, result.truncated) };
  }

  private async outline(
    input: Record<string, unknown>,
  ): Promise<ToolExecution> {
    const result = await this.session.call<{
      symbols: SymbolLocation[] | null;
    }>('outline', { path: text(input.path) });
    if (!result.symbols) {
      return {
        content:
          'No outline: this file is not syntax-indexed (tier 0). Use read_file or search_code.',
      };
    }
    return {
      content:
        result.symbols
          .map(
            (symbol) =>
              `${symbol.startLine}-${symbol.endLine}  ${symbol.kind} ${sanitizeLine(symbol.name)}`,
          )
          .join('\n') || 'No symbols.',
    };
  }

  private recordNote(input: Record<string, unknown>): ToolExecution {
    if (this.notes.length >= MAX_NOTES) {
      return { content: 'Note limit reached.', isError: true };
    }
    this.notes.push(
      redactSecrets(sanitizeLine(text(input.note))).text.slice(
        0,
        MAX_NOTE_CHARS,
      ),
    );
    return { content: 'Noted.' };
  }

  private async testRule(
    input: Record<string, unknown>,
  ): Promise<ToolExecution> {
    const result = await this.session.call<RuleRunResult>('test_route_rule', {
      rule: {
        description: text(input.description, 'rule').slice(0, 300) || 'rule',
        fileGlob: input.fileGlob ?? null,
        pattern: text(input.pattern),
        caseInsensitive: input.caseInsensitive === true,
        method: input.method ?? null,
        methodGroup: input.methodGroup ?? null,
        pathGroup: input.pathGroup,
        pathPrefix: input.pathPrefix ?? '',
      },
    });
    const samples = result.samples
      .map(
        (sample) =>
          `${sanitizeLine(sample.path)}:${sample.line}  ${sample.method ?? '*'} ${sanitizeLine(sample.path_)}`,
      )
      .join('\n');
    return {
      content: `${result.matches} matches, ${result.candidates.length} distinct routes${result.timedOut ? ', TIMED OUT' : ''}${result.error ? `, ${result.error}` : ''}.\n${samples}`,
      isError:
        result.timedOut || (result.matches === 0 && result.error !== null),
    };
  }

  private renderHits(hits: SearchHit[], truncated: boolean): string {
    if (hits.length === 0) return 'No matches.';
    const text = hits
      .map(
        (hit) =>
          `${sanitizeLine(hit.path)}:${hit.line}  ${sanitizeLine(hit.preview)}`,
      )
      .join('\n');
    return `${redactSecrets(text).text}${truncated ? '\n…more matches; narrow the query.' : ''}`;
  }

  private int(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ): number {
    return typeof value === 'number' && Number.isInteger(value)
      ? Math.min(Math.max(value, min), max)
      : fallback;
  }
}
