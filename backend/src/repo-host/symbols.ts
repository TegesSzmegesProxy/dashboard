import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Language, Node, Parser } from 'web-tree-sitter';
import type { FileStore, StoredFile } from './files.js';
import type { SymbolLocation } from './protocol.js';

const MAX_PARSE_BYTES = 512 * 1024;
const MAX_SYMBOLS_PER_FILE = 2_000;

/**
 * Node types that declare a named symbol, across grammars. Matching by name
 * keeps tier-1 indexing language-agnostic instead of per-grammar queries.
 */
const DECLARATION =
  /(?:^|_)(?:function|method|class|interface|struct|enum|trait|module|impl|record|protocol|object|type_alias|type_spec|constructor|singleton_method|def)(?:_declaration|_definition|_item|_spec|_signature|_statement)?$/;
const KIND =
  /(function|method|class|interface|struct|enum|trait|module|impl|record|protocol|object|type|constructor|def)/;

/** Tier-1 symbols from tree-sitter, plus text fallbacks for tier 0. */
export class SymbolIndex {
  private readonly languages = new Map<string, Language | null>();
  private readonly definitions = new Map<string, SymbolLocation[]>();
  private readonly outlines = new Map<string, SymbolLocation[]>();
  private parser: Parser | null = null;
  private symbolCount = 0;

  constructor(private readonly store: FileStore) {}

  get size(): number {
    return this.symbolCount;
  }

  async build(): Promise<void> {
    await Parser.init();
    this.parser = new Parser();
    for (const file of this.store.files.values()) {
      if (!file.grammar || file.bytes > MAX_PARSE_BYTES) continue;
      const language = await this.language(file.grammar);
      if (!language) {
        file.tier = 0;
        continue;
      }
      this.parser.setLanguage(language);
      const tree = this.parser.parse(file.content);
      if (!tree) continue;
      const symbols: SymbolLocation[] = [];
      this.collect(tree.rootNode, file, symbols);
      tree.delete();
      this.outlines.set(file.path, symbols);
      for (const symbol of symbols) {
        const list = this.definitions.get(symbol.name) ?? [];
        list.push(symbol);
        this.definitions.set(symbol.name, list);
      }
      this.symbolCount += symbols.length;
    }
  }

  outline(path: string): SymbolLocation[] | null {
    return this.outlines.get(path) ?? null;
  }

  /** Exact symbol definitions; text heuristics when no tree-sitter match. */
  definitionsOf(
    name: string,
    limit: number,
  ): { method: 'syntax' | 'text'; locations: SymbolLocation[] } {
    const exact = this.definitions.get(name);
    if (exact?.length) {
      return { method: 'syntax', locations: exact.slice(0, limit) };
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `\\b(?:function|def|class|func|fn|sub|interface|struct|type|enum|trait|module|object|record)\\s+${escaped}\\b`,
    );
    const locations: SymbolLocation[] = [];
    for (const file of this.store.files.values()) {
      file.lines.forEach((line, index) => {
        if (locations.length < limit && pattern.test(line)) {
          locations.push({
            name,
            kind: 'text_match',
            path: file.path,
            startLine: index + 1,
            endLine: index + 1,
          });
        }
      });
      if (locations.length >= limit) break;
    }
    return { method: 'text', locations };
  }

  private collect(node: Node, file: StoredFile, out: SymbolLocation[]): void {
    if (out.length >= MAX_SYMBOLS_PER_FILE) return;
    if (node.isNamed && DECLARATION.test(node.type)) {
      const nameNode =
        node.childForFieldName('name') ??
        node.childForFieldName('declarator') ??
        null;
      const name = nameNode ? this.identifier(nameNode) : null;
      if (name) {
        out.push({
          name,
          kind: KIND.exec(node.type)?.[1] ?? node.type,
          path: file.path,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
    } else if (
      node.type === 'variable_declarator' ||
      node.type === 'assignment'
    ) {
      // `const handler = async (req, res) => {...}` and similar.
      const value =
        node.childForFieldName('value') ?? node.childForFieldName('right');
      const target =
        node.childForFieldName('name') ?? node.childForFieldName('left');
      if (
        value &&
        target &&
        /function|arrow|lambda/.test(value.type) &&
        /identifier/.test(target.type)
      ) {
        out.push({
          name: target.text,
          kind: 'function',
          path: file.path,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
    }
    for (const child of node.namedChildren) {
      if (child) this.collect(child, file, out);
    }
  }

  /** The identifier text of a name or declarator node. */
  private identifier(node: Node): string | null {
    if (/identifier|name|constant/.test(node.type) && node.text.length <= 200) {
      return node.text;
    }
    const nested =
      node.childForFieldName('name') ??
      node.childForFieldName('declarator') ??
      node.namedChildren.find(
        (child) => child !== null && /identifier|name/.test(child.type),
      ) ??
      null;
    return nested && nested !== node ? this.identifier(nested) : null;
  }

  private async language(grammar: string): Promise<Language | null> {
    if (this.languages.has(grammar)) return this.languages.get(grammar)!;
    let language: Language | null = null;
    try {
      const require = createRequire(import.meta.url);
      const directory = dirname(
        require.resolve('tree-sitter-wasms/package.json'),
      );
      language = await Language.load(
        join(directory, 'out', `tree-sitter-${grammar}.wasm`),
      );
    } catch {
      language = null;
    }
    this.languages.set(grammar, language);
    return language;
  }
}
