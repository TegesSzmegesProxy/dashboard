import { posix } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { FileStore, StoredFile } from './files.js';
import { CandidateSet } from './candidates.js';
import {
  globToRegExp,
  joinRoutePaths,
  normalizeMethod,
  normalizeRoutePath,
} from './paths.js';
import type { RouteRule, RuleRunResult } from './protocol.js';
import { RegexEngine, RegexTimeoutError } from './regex-engine.js';

export { CandidateSet };

const MAX_HINTS = 30;
const RULE_TIMEOUT_MS = 5_000;
const RULE_MAX_MATCHES = 2_000;
const SPEC_HEAD_BYTES = 4_096;
const OPENAPI_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
];

interface HeuristicPattern {
  name: string;
  regex: RegExp;
  methodGroup: number | null;
  pathGroup: number;
  /** Only files whose path matches, when set. */
  file?: RegExp;
}

/**
 * Language-neutral route shapes. They only seed recon and the sweep: a hit
 * becomes a work item only when a stronger source confirms it (ADR-0009).
 */
const HEURISTICS: HeuristicPattern[] = [
  {
    name: 'call',
    regex:
      /(?:^|[^\w$])(?:[\w$]+(?:\.|->|::))?(get|post|put|patch|delete|head|options|all|any|route|match|handle|handlefunc|api_route|map(?:get|post|put|patch|delete))\s*\(\s*(['"`])(\/[^'"`\s]{0,500})\2/i,
    methodGroup: 1,
    pathGroup: 3,
  },
  {
    name: 'method-path-string',
    regex:
      /["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[^"'`\s]{0,500})["'`]/,
    methodGroup: 1,
    pathGroup: 2,
  },
  {
    name: 'annotation',
    regex:
      /@(Get|Post|Put|Patch|Delete|Head|Options|All|Request)(?:Mapping)?\s*\(\s*(?:(?:value|path)\s*=\s*)?\{?\s*['"]([^'"]{0,500})['"]/,
    methodGroup: 1,
    pathGroup: 2,
  },
  {
    name: 'attribute',
    regex:
      /\[\s*Http(Get|Post|Put|Patch|Delete|Head|Options)\s*\(\s*"([^"]{0,500})"/,
    methodGroup: 1,
    pathGroup: 2,
  },
  {
    name: 'laravel',
    regex:
      /Route::(get|post|put|patch|delete|options|any|match)\s*\(\s*['"]([^'"]{0,500})['"]/,
    methodGroup: 1,
    pathGroup: 2,
  },
  {
    name: 'django',
    regex: /(?:^|\W)(?:re_path|path|url)\s*\(\s*r?['"]\^?([^'"]{0,500})['"]/,
    methodGroup: null,
    pathGroup: 1,
    file: /(?:^|\/)urls\.py$/,
  },
  {
    name: 'rails',
    regex: /^\s*(get|post|put|patch|delete|match)\s+['"]([^'"]{1,500})['"]/,
    methodGroup: 1,
    pathGroup: 2,
    file: /(?:^|\/)routes\.rb$/,
  },
];

const ROUTE_LIKE_FILE =
  /(?:route|router|controller|handler|endpoint|api|urls|views|resource|server|app)\w*\.\w+$/i;

export class RouteDiscovery {
  readonly specFiles: string[] = [];
  readonly heuristicHits = new Map<string, number>();

  constructor(
    private readonly store: FileStore,
    private readonly regex: RegexEngine,
  ) {}

  /** Heuristics, specs and framework packs; no model involved. */
  discover(frameworks: string[]): {
    strong: CandidateSet;
    heuristic: CandidateSet;
  } {
    const strong = new CandidateSet();
    const heuristic = new CandidateSet();
    for (const file of this.store.files.values()) {
      this.runHeuristics(file, heuristic);
      this.readSpec(file, strong);
    }
    if (frameworks.includes('NestJS')) this.nestPack(strong);
    if (frameworks.includes('Express')) this.expressPack(strong);
    return { strong, heuristic };
  }

  /** Files that look like routing code or contain heuristic hits. */
  routeLikeFiles(limit: number): { path: string; heuristicHits: number }[] {
    const files: { path: string; heuristicHits: number }[] = [];
    for (const file of this.store.files.values()) {
      const hits = this.heuristicHits.get(file.path) ?? 0;
      if (hits > 0 || ROUTE_LIKE_FILE.test(file.path)) {
        files.push({ path: file.path, heuristicHits: hits });
      }
    }
    return files
      .sort((a, b) => b.heuristicHits - a.heuristicHits)
      .slice(0, limit);
  }

  async applyRule(rule: RouteRule): Promise<RuleRunResult> {
    const flags = rule.caseInsensitive ? 'i' : '';
    try {
      RegexEngine.compile(rule.pattern, flags);
      if (rule.fileGlob) globToRegExp(rule.fileGlob);
    } catch {
      return this.ruleFailure(
        'Pattern or glob is not a valid regular expression',
      );
    }
    let result;
    try {
      result = await this.regex.run(
        {
          pattern: rule.pattern,
          flags,
          pathPattern: rule.fileGlob
            ? globToRegExp(rule.fileGlob).source
            : null,
          maxMatches: RULE_MAX_MATCHES,
        },
        RULE_TIMEOUT_MS,
      );
    } catch (error) {
      return error instanceof RegexTimeoutError
        ? { ...this.ruleFailure('Pattern timed out'), timedOut: true }
        : this.ruleFailure('Pattern could not run');
    }
    const set = new CandidateSet();
    const samples: RuleRunResult['samples'] = [];
    for (const match of result.matches) {
      const rawPath = match.groups[rule.pathGroup - 1];
      const path =
        rawPath === null || rawPath === undefined
          ? null
          : joinRoutePaths(rule.pathPrefix, rawPath);
      if (!path) continue;
      const method =
        rule.method ??
        (rule.methodGroup
          ? normalizeMethod(match.groups[rule.methodGroup - 1])
          : null);
      set.add(
        method,
        path,
        { kind: 'route_rule', detail: rule.description.slice(0, 120) },
        { path: match.path, line: match.line },
      );
      if (samples.length < 10) {
        samples.push({
          path: match.path,
          line: match.line,
          method,
          path_: path,
        });
      }
    }
    return {
      matches: result.matches.length,
      candidates: set.list(),
      samples,
      timedOut: false,
      error: result.truncated ? 'Match limit reached' : null,
    };
  }

  private ruleFailure(error: string): RuleRunResult {
    return { matches: 0, candidates: [], samples: [], timedOut: false, error };
  }

  private runHeuristics(file: StoredFile, set: CandidateSet): void {
    if (
      !file.language ||
      ['json', 'yaml', 'xml', 'toml', 'html'].includes(file.language)
    ) {
      return;
    }
    let hits = 0;
    file.lines.forEach((line, index) => {
      for (const heuristic of HEURISTICS) {
        if (heuristic.file && !heuristic.file.test(file.path)) continue;
        const match = heuristic.regex.exec(line);
        if (!match) continue;
        const path = normalizeRoutePath(match[heuristic.pathGroup] ?? '');
        if (!path) continue;
        hits++;
        set.add(
          heuristic.methodGroup
            ? normalizeMethod(match[heuristic.methodGroup])
            : null,
          path,
          { kind: 'heuristic', detail: heuristic.name },
          { path: file.path, line: index + 1 },
        );
        break;
      }
    });
    if (hits > 0) this.heuristicHits.set(file.path, hits);
  }

  /** OpenAPI/Swagger documents and GraphQL schemas. */
  private readSpec(file: StoredFile, set: CandidateSet): void {
    if (file.language === 'graphql') {
      const operations = [
        ...file.content.matchAll(/type\s+(Query|Mutation)\s*\{([^}]*)\}/g),
      ];
      if (operations.length === 0) return;
      this.specFiles.push(file.path);
      const fields = operations.flatMap(([, type, body]) =>
        [...body.matchAll(/^\s*(\w+)\s*[(:]/gm)].map(
          ([, name]) => `${type}.${name}`,
        ),
      );
      set.add(
        'POST',
        '/graphql',
        { kind: 'spec', detail: `GraphQL schema ${file.path}` },
        { path: file.path, line: 1 },
        fields.slice(0, MAX_HINTS),
      );
      return;
    }
    if (file.language !== 'json' && file.language !== 'yaml') return;
    const head = file.content.slice(0, SPEC_HEAD_BYTES);
    if (!/["']?(?:openapi|swagger)["']?\s*:/.test(head)) return;
    let document: unknown;
    try {
      document = parseYaml(file.content, { maxAliasCount: 50 });
    } catch {
      return;
    }
    const paths = (document as { paths?: unknown } | null)?.paths;
    if (!paths || typeof paths !== 'object') return;
    this.specFiles.push(file.path);
    for (const [rawPath, item] of Object.entries(
      paths as Record<string, unknown>,
    )) {
      const path = normalizeRoutePath(rawPath);
      if (!path || !item || typeof item !== 'object') continue;
      const line = Math.max(
        1,
        file.lines.findIndex((text) => text.includes(rawPath)) + 1,
      );
      for (const method of OPENAPI_METHODS) {
        const operation = (item as Record<string, unknown>)[method];
        if (!operation || typeof operation !== 'object') continue;
        set.add(
          method.toUpperCase(),
          path,
          { kind: 'spec', detail: `OpenAPI ${file.path}` },
          { path: file.path, line },
          this.openApiHints(operation as Record<string, unknown>),
        );
      }
    }
  }

  private openApiHints(operation: Record<string, unknown>): string[] {
    const hints: string[] = [];
    const parameters = Array.isArray(operation.parameters)
      ? operation.parameters
      : [];
    for (const parameter of parameters as Record<string, unknown>[]) {
      if (
        typeof parameter?.name === 'string' &&
        typeof parameter.in === 'string'
      ) {
        hints.push(
          `${parameter.in}.${parameter.name}${parameter.required ? ' (required)' : ''}`,
        );
      }
    }
    const body = operation.requestBody as
      | {
          content?: Record<
            string,
            { schema?: { properties?: Record<string, unknown> } }
          >;
        }
      | undefined;
    for (const [contentType, media] of Object.entries(body?.content ?? {})) {
      hints.push(`content-type ${contentType}`);
      for (const name of Object.keys(media?.schema?.properties ?? {})) {
        hints.push(`body.${name}`);
      }
    }
    return hints.slice(0, MAX_HINTS);
  }

  /** NestJS: controller prefixes, method decorators, DTO validation hints. */
  private nestPack(set: CandidateSet): void {
    let globalPrefix = '';
    for (const file of this.store.files.values()) {
      const match = /setGlobalPrefix\(\s*['"`]([^'"`]*)['"`]/.exec(
        file.content,
      );
      if (match) {
        globalPrefix = match[1];
        break;
      }
    }
    const dtos = this.collectDtoHints();
    for (const file of this.store.files.values()) {
      if (!file.content.includes('@Controller')) continue;
      let controllerPrefix = '';
      file.lines.forEach((line, index) => {
        const controller =
          /@Controller\(\s*(?:['"`]([^'"`]*)['"`]|\{[^}]*path\s*:\s*['"`]([^'"`]*)['"`])?/.exec(
            line,
          );
        if (controller) {
          controllerPrefix = controller[1] ?? controller[2] ?? '';
          return;
        }
        const route =
          /^\s*@(Get|Post|Put|Patch|Delete|Head|Options|All)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/.exec(
            line,
          );
        if (!route) return;
        const path = joinRoutePaths(
          joinRoutePaths(globalPrefix, controllerPrefix) ?? '/',
          route[2] ?? '',
        );
        if (!path) return;
        const hints: string[] = [];
        // Parameters follow the decorators, up to the next route handler.
        for (const next of file.lines.slice(index + 1, index + 20)) {
          if (
            /^\s*@(Get|Post|Put|Patch|Delete|Head|Options|All)\(/.test(next)
          ) {
            break;
          }
          const body = /@Body\(\)\s*\w+\s*:\s*(\w+)/.exec(next);
          if (body && dtos.has(body[1])) hints.push(...dtos.get(body[1])!);
          for (const [, kind, name] of next.matchAll(
            /@(Query|Param|Headers)\(\s*['"`]([\w.-]+)['"`]/g,
          )) {
            hints.push(
              `${kind === 'Param' ? 'path' : kind === 'Query' ? 'query' : 'header'}.${name}`,
            );
          }
        }
        set.add(
          normalizeMethod(route[1]),
          path,
          { kind: 'framework_pack', detail: 'NestJS' },
          { path: file.path, line: index + 1 },
          hints,
        );
      });
    }
  }

  /** class-validator decorators per DTO property: `body.name: @IsString() @MaxLength(50)`. */
  private collectDtoHints(): Map<string, string[]> {
    const dtos = new Map<string, string[]>();
    for (const file of this.store.files.values()) {
      if (!file.content.includes('class-validator')) continue;
      let current: string | null = null;
      let decorators: string[] = [];
      for (const line of file.lines) {
        const declaration = /class\s+(\w+)/.exec(line);
        if (declaration) {
          current = declaration[1];
          decorators = [];
          dtos.set(current, []);
          continue;
        }
        if (!current) continue;
        const decorator = [
          ...line.matchAll(
            /@(Is\w+|Max\w*|Min\w*|Length|Matches|Array\w+|ValidateNested|Type)\(([^)]{0,120})\)/g,
          ),
        ];
        if (decorator.length > 0) {
          decorators.push(
            ...decorator.map(([, name, args]) => `@${name}(${args})`),
          );
          continue;
        }
        const property = /^\s*(?:readonly\s+)?(\w+)[?!]?\s*:/.exec(line);
        if (property && decorators.length > 0) {
          dtos
            .get(current)!
            .push(`body.${property[1]}: ${decorators.join(' ')}`.slice(0, 300));
          decorators = [];
        }
      }
    }
    return dtos;
  }

  /** Express: one level of `app.use('/prefix', router)` mounts. */
  private expressPack(set: CandidateSet): void {
    const mounts = new Map<string, string[]>();
    for (const file of this.store.files.values()) {
      if (
        !file.language ||
        !['javascript', 'typescript'].includes(file.language)
      )
        continue;
      const imports = new Map<string, string>();
      for (const [, name, from] of file.content.matchAll(
        /import\s+(\w+)\s+from\s+['"](\.[^'"]+)['"]/g,
      )) {
        imports.set(name, from);
      }
      for (const [, name, from] of file.content.matchAll(
        /(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"](\.[^'"]+)['"]\s*\)/g,
      )) {
        imports.set(name, from);
      }
      for (const [, prefix, target] of file.content.matchAll(
        /\.use\(\s*['"`](\/[^'"`]*)['"`]\s*,\s*(?:[\w.]+\s*,\s*)*(\w+)\s*\)/g,
      )) {
        const from = imports.get(target);
        const resolved = from ? this.resolveModule(file.path, from) : null;
        if (resolved)
          mounts.set(resolved, [...(mounts.get(resolved) ?? []), prefix]);
      }
    }
    for (const [path, prefixes] of mounts) {
      const file = this.store.get(path);
      if (!file) continue;
      file.lines.forEach((line, index) => {
        const call =
          /(?:^|[^\w$])[\w$]+\.(get|post|put|patch|delete|head|options|all)\s*\(\s*(['"`])(\/[^'"`\s]*)\2/i.exec(
            line,
          );
        const chained =
          /\.route\(\s*['"`](\/[^'"`]*)['"`]\s*\)((?:\s*\.\s*(?:get|post|put|patch|delete)\s*\()+)/i.exec(
            line,
          );
        const routes: [string | null, string][] = [];
        if (call) routes.push([normalizeMethod(call[1]), call[3]]);
        if (chained) {
          for (const [, verb] of chained[2].matchAll(
            /(get|post|put|patch|delete)/gi,
          )) {
            routes.push([normalizeMethod(verb), chained[1]]);
          }
        }
        for (const [method, raw] of routes) {
          for (const prefix of prefixes) {
            const full = joinRoutePaths(prefix, raw);
            if (full) {
              set.add(
                method,
                full,
                { kind: 'framework_pack', detail: `Express mount ${prefix}` },
                { path: file.path, line: index + 1 },
              );
            }
          }
        }
      });
    }
  }

  private resolveModule(fromFile: string, specifier: string): string | null {
    const base = posix.normalize(
      posix.join(posix.dirname(fromFile), specifier),
    );
    const stripped = base.replace(/\.(js|mjs|cjs)$/, '');
    for (const candidate of [
      base,
      `${stripped}.ts`,
      `${stripped}.js`,
      `${stripped}/index.ts`,
      `${stripped}/index.js`,
    ]) {
      if (this.store.get(candidate)) return candidate;
    }
    return null;
  }
}
