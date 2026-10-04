import { ExtractionError, FileStore } from './files.js';
import { DEPENDENCY_MANIFESTS, FRAMEWORK_MARKERS } from './languages.js';
import { globToRegExp } from './paths.js';
import type {
  FileStat,
  HostOperation,
  LanguageTier,
  RepoIndexSummary,
  RouteRule,
  SearchHit,
} from './protocol.js';
import { RegexEngine, RegexTimeoutError } from './regex-engine.js';
import { CandidateSet, RouteDiscovery } from './routes.js';
import { SymbolIndex } from './symbols.js';

export const MAX_READ_LINES = 400;
export const MAX_READ_BYTES = 30 * 1024;
const MAX_SEARCH_RESULTS = 100;
const MAX_LIST = 500;
const SEARCH_TIMEOUT_MS = 5_000;

export class HostError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Dispatches protocol operations over the extracted repository. */
export class RepoHost {
  private readonly store = new FileStore();
  private readonly regex = new RegexEngine(this.store);
  private readonly symbols = new SymbolIndex(this.store);
  private readonly routes = new RouteDiscovery(this.store, this.regex);
  private loaded = false;
  private indexed = false;

  async handle(
    op: HostOperation,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (op === 'archive.chunk') {
      if (this.loaded)
        throw new HostError('INVALID_REQUEST', 'Archive already loaded');
      this.store.write(
        Buffer.from(this.string(params, 'data', 1_000_000), 'base64'),
      );
      return null;
    }
    if (op === 'archive.end') {
      try {
        const summary = await this.store.end();
        this.loaded = true;
        return summary;
      } catch (error) {
        if (error instanceof ExtractionError)
          throw new HostError(error.code, error.message);
        throw error;
      }
    }
    if (!this.loaded) throw new HostError('NOT_LOADED', 'No archive loaded');
    switch (op) {
      case 'index':
        return this.index();
      case 'list_files':
        return this.listFiles(params);
      case 'read_file':
        return this.readFile(params);
      case 'search':
        return this.search(params);
      case 'outline':
        return this.requireIndex(() => ({
          path: this.string(params, 'path', 1_024),
          symbols:
            this.symbols
              .outline(this.string(params, 'path', 1_024))
              ?.slice(0, 300) ?? null,
        }));
      case 'definitions':
        return this.requireIndex(() =>
          this.symbols.definitionsOf(this.string(params, 'name', 200), 20),
        );
      case 'references':
        return this.references(this.string(params, 'name', 200));
      case 'test_route_rule':
        return this.requireIndex(async () => {
          const result = await this.routes.applyRule(this.rule(params.rule));
          return { ...result, candidates: result.candidates.slice(0, 50) };
        });
      case 'apply_route_rules':
        return this.requireIndex(() => this.applyRules(params));
      case 'file_stats':
        return this.fileStats(params);
      case 'route_like_files':
        return this.requireIndex(() =>
          this.routes.routeLikeFiles(
            Math.min(this.integer(params, 'limit', 1, 2_000), 2_000),
          ),
        );
      default:
        throw new HostError('INVALID_REQUEST', 'Unknown operation');
    }
  }

  async close(): Promise<void> {
    await this.regex.close();
  }

  private async index(): Promise<RepoIndexSummary> {
    if (!this.indexed) {
      await this.symbols.build();
      this.indexed = true;
    }
    const frameworks = this.frameworkGuesses();
    const { strong, heuristic } = this.routes.discover(frameworks);
    strong.merge(heuristic.list());
    const languages: Record<string, number> = {};
    const tiers: Record<LanguageTier, number> = { 0: 0, 1: 0, 2: 0 };
    let bytes = 0;
    for (const file of this.store.files.values()) {
      const language = file.language ?? 'other';
      languages[language] = (languages[language] ?? 0) + 1;
      tiers[file.tier]++;
      bytes += file.bytes;
    }
    const candidates = strong.list();
    return {
      files: this.store.files.size,
      bytes,
      languages,
      tiers,
      frameworkGuesses: frameworks,
      dependencyManifests: [...this.store.files.keys()]
        .filter((path) => DEPENDENCY_MANIFESTS.has(path.split('/').at(-1)!))
        .slice(0, 100),
      specFiles: this.routes.specFiles.slice(0, 100),
      symbols: this.symbols.size,
      candidates,
      candidatesTruncated: strong.truncated,
    };
  }

  private frameworkGuesses(): string[] {
    const found = new Set<string>();
    for (const file of this.store.files.values()) {
      const name = file.path.split('/').at(-1)!;
      if (DEPENDENCY_MANIFESTS.has(name) || name.endsWith('.csproj')) {
        const lower = file.content.toLowerCase();
        for (const [marker, framework] of Object.entries(FRAMEWORK_MARKERS)) {
          if (lower.includes(marker)) found.add(framework);
        }
      }
      if (file.language === 'javascript' || file.language === 'typescript') {
        if (file.content.includes('@nestjs/common')) found.add('NestJS');
        if (
          /from\s+['"]express['"]|require\(\s*['"]express['"]\s*\)/.test(
            file.content,
          )
        ) {
          found.add('Express');
        }
      }
    }
    return [...found].sort();
  }

  private listFiles(params: Record<string, unknown>) {
    const directory = this.optionalString(params, 'directory', 1_024)?.replace(
      /\/$/,
      '',
    );
    const glob = this.optionalString(params, 'glob', 200);
    const offset = this.integer(params, 'offset', 0, 1_000_000);
    const limit = Math.min(
      this.integer(params, 'limit', 1, MAX_LIST),
      MAX_LIST,
    );
    const globRegex = glob ? this.safe(() => globToRegExp(glob)) : null;
    const matching = [...this.store.files.values()]
      .filter((file) => !directory || file.path.startsWith(`${directory}/`))
      .filter((file) => !globRegex || globRegex.test(file.path))
      .sort((a, b) => a.path.localeCompare(b.path));
    return {
      total: matching.length,
      files: matching
        .slice(offset, offset + limit)
        .map((file) => this.store.stat(file)),
    };
  }

  private readFile(params: Record<string, unknown>) {
    const path = this.string(params, 'path', 1_024);
    const file = this.store.get(path);
    if (!file) throw new HostError('NOT_FOUND', 'File not found');
    const startLine = Math.max(
      1,
      this.integer(params, 'startLine', 1, 10_000_000),
    );
    const requestedEnd = this.integer(params, 'endLine', 1, 10_000_000);
    const endLine = Math.min(
      requestedEnd,
      file.lines.length,
      startLine + MAX_READ_LINES - 1,
    );
    const lines: string[] = [];
    let bytes = 0;
    for (let line = startLine; line <= endLine; line++) {
      const text = file.lines[line - 1] ?? '';
      bytes += Buffer.byteLength(text) + 1;
      if (bytes > MAX_READ_BYTES) break;
      lines.push(text);
    }
    return {
      path,
      startLine,
      endLine: startLine + lines.length - 1,
      totalLines: file.lines.length,
      truncated:
        startLine + lines.length - 1 <
        Math.min(requestedEnd, file.lines.length),
      lines,
    };
  }

  private async search(
    params: Record<string, unknown>,
  ): Promise<{ hits: SearchHit[]; truncated: boolean }> {
    const query = this.string(params, 'query', 500);
    const isRegex = params.regex === true;
    const caseInsensitive = params.caseInsensitive === true;
    const glob = this.optionalString(params, 'pathGlob', 200);
    const max = Math.min(
      this.integer(params, 'maxResults', 1, MAX_SEARCH_RESULTS),
      MAX_SEARCH_RESULTS,
    );
    const pathRegex = glob ? this.safe(() => globToRegExp(glob)) : null;
    if (isRegex) {
      this.safe(() => RegexEngine.compile(query, caseInsensitive ? 'i' : ''));
      try {
        const result = await this.regex.run(
          {
            pattern: query,
            flags: caseInsensitive ? 'i' : '',
            pathPattern: pathRegex?.source ?? null,
            maxMatches: max,
          },
          SEARCH_TIMEOUT_MS,
        );
        return {
          hits: result.matches.map((match) => ({
            path: match.path,
            line: match.line,
            preview: match.text.slice(0, 160),
          })),
          truncated: result.truncated,
        };
      } catch (error) {
        if (error instanceof RegexTimeoutError)
          throw new HostError('TIMEOUT', 'Search pattern timed out');
        throw error;
      }
    }
    const needle = caseInsensitive ? query.toLowerCase() : query;
    const hits: SearchHit[] = [];
    let truncated = false;
    outer: for (const file of this.store.files.values()) {
      if (pathRegex && !pathRegex.test(file.path)) continue;
      for (let index = 0; index < file.lines.length; index++) {
        const line = caseInsensitive
          ? file.lines[index].toLowerCase()
          : file.lines[index];
        if (!line.includes(needle)) continue;
        if (hits.length >= max) {
          truncated = true;
          break outer;
        }
        hits.push({
          path: file.path,
          line: index + 1,
          preview: file.lines[index].slice(0, 160),
        });
      }
    }
    return { hits, truncated };
  }

  /** Word-boundary text references; syntax-accurate references are tier 3. */
  private references(name: string) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?:^|[^\\w$])${escaped}(?:$|[^\\w$])`);
    const hits: SearchHit[] = [];
    let truncated = false;
    outer: for (const file of this.store.files.values()) {
      for (let index = 0; index < file.lines.length; index++) {
        if (!pattern.test(file.lines[index])) continue;
        if (hits.length >= 50) {
          truncated = true;
          break outer;
        }
        hits.push({
          path: file.path,
          line: index + 1,
          preview: file.lines[index].slice(0, 160),
        });
      }
    }
    return { method: 'text', hits, truncated };
  }

  private async applyRules(params: Record<string, unknown>) {
    const rules = Array.isArray(params.rules) ? params.rules.slice(0, 30) : [];
    const set = new CandidateSet();
    const stats: {
      description: string;
      matches: number;
      timedOut: boolean;
      error: string | null;
    }[] = [];
    for (const raw of rules) {
      const rule = this.rule(raw);
      const result = await this.routes.applyRule(rule);
      set.merge(result.candidates);
      stats.push({
        description: rule.description,
        matches: result.matches,
        timedOut: result.timedOut,
        error: result.error,
      });
    }
    return { candidates: set.list(), truncated: set.truncated, rules: stats };
  }

  private fileStats(params: Record<string, unknown>): FileStat[] {
    const paths = Array.isArray(params.paths)
      ? params.paths.slice(0, 5_000)
      : [];
    return paths
      .filter((path): path is string => typeof path === 'string')
      .map((path) => this.store.get(path))
      .filter((file) => file !== undefined)
      .map((file) => this.store.stat(file));
  }

  private rule(raw: unknown): RouteRule {
    const value = (raw ?? {}) as Record<string, unknown>;
    const nullableInt = (key: string): number | null =>
      value[key] === null || value[key] === undefined
        ? null
        : this.integer(value, key, 1, 9);
    return {
      description: this.string(value, 'description', 300),
      fileGlob: this.optionalString(value, 'fileGlob', 200) ?? null,
      pattern: this.string(value, 'pattern', 500),
      caseInsensitive: value.caseInsensitive === true,
      method: this.optionalString(value, 'method', 10) ?? null,
      methodGroup: nullableInt('methodGroup'),
      pathGroup: this.integer(value, 'pathGroup', 1, 9),
      pathPrefix: this.optionalString(value, 'pathPrefix', 200) ?? '',
    };
  }

  private async requireIndex<T>(operation: () => T | Promise<T>): Promise<T> {
    if (!this.indexed) await this.index();
    return operation();
  }

  private safe<T>(build: () => T): T {
    try {
      return build();
    } catch {
      throw new HostError('INVALID_PATTERN', 'Invalid pattern');
    }
  }

  private string(
    params: Record<string, unknown>,
    key: string,
    max: number,
  ): string {
    const value = params[key];
    if (typeof value !== 'string' || value.length === 0 || value.length > max) {
      throw new HostError(
        'INVALID_REQUEST',
        `${key} must be a string of 1-${max} characters`,
      );
    }
    return value;
  }

  private optionalString(
    params: Record<string, unknown>,
    key: string,
    max: number,
  ): string | undefined {
    const value = params[key];
    if (value === undefined || value === null || value === '') return undefined;
    return this.string(params, key, max);
  }

  private integer(
    params: Record<string, unknown>,
    key: string,
    min: number,
    max: number,
  ): number {
    const value = params[key];
    if (value === undefined) return min;
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      throw new HostError(
        'INVALID_REQUEST',
        `${key} must be an integer from ${min} to ${max}`,
      );
    }
    return value;
  }
}
