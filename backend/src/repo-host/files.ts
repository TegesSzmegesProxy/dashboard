import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { Parser, ReadEntry } from 'tar';
import { languageOf } from './languages.js';
import type {
  ExclusionReason,
  ExtractionSummary,
  FileStat,
  LanguageTier,
} from './protocol.js';

const MAX_FILES = 25_000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 500_000;
const MAX_EXCLUDED_SAMPLES = 300;
/** Longer lines indicate minified or generated content. */
const MAX_LINE_CHARS = 5_000;

const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.venv',
  '.tox',
  '.gradle',
  '.terraform',
  '__pycache__',
  'bower_components',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'obj',
  'out',
  'target',
  'vendor',
  'venv',
]);

/** Files that conventionally hold credentials are never read. */
const DENIED_FILE =
  /^(?:\.env(?:\.(?!example$).*)?|.*\.(?:pem|key|p12|pfx|jks|keystore|crt|cer|der|tfstate|tfvars|kdbx)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.htpasswd|credentials(?:\..*)?|secrets?\..*)$/i;

/** Text that is data, docs or lockfiles rather than application code. */
const DENIED_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.rst',
  '.txt',
  '.csv',
  '.tsv',
  '.log',
  '.svg',
  '.map',
  '.lock',
  '.snap',
  '.min.js',
  '.min.css',
  '.css',
  '.scss',
  '.less',
]);
const DENIED_NAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Cargo.lock',
  'go.sum',
]);

const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

export class ExtractionError extends Error {
  constructor(
    readonly code: 'SOURCE_TOO_LARGE' | 'SOURCE_ARCHIVE_INVALID',
    message: string,
  ) {
    super(message);
  }
}

export interface StoredFile {
  path: string;
  content: string;
  lines: string[];
  bytes: number;
  sha256: string;
  language: string | null;
  grammar: string | null;
  tier: LanguageTier;
}

/** The extracted repository, held in sandbox memory only. */
export class FileStore {
  readonly files = new Map<string, StoredFile>();
  private parser: Parser | null = null;
  private parsing: Promise<void> | null = null;
  private failure: Error | null = null;
  private expandedBytes = 0;
  private summary: ExtractionSummary = {
    entriesScanned: 0,
    includedFiles: 0,
    includedBytes: 0,
    excludedCounts: {},
    excludedSamples: [],
    truncated: false,
    sourceHash: '',
  };

  /** Feeds one chunk of the gzip tarball. */
  write(chunk: Buffer): void {
    if (this.failure) throw this.failure;
    if (!this.parser) this.start();
    this.parser!.write(chunk);
  }

  async end(): Promise<ExtractionSummary> {
    if (!this.parser) this.start();
    this.parser!.end();
    await this.parsing;
    if (this.failure) throw this.failure;
    const hash = createHash('sha256');
    for (const path of [...this.files.keys()].sort()) {
      hash.update(`${path}:${this.files.get(path)!.sha256}\n`);
    }
    this.summary.sourceHash = hash.digest('hex');
    return this.summary;
  }

  get(path: string): StoredFile | undefined {
    return this.files.get(path);
  }

  stat(file: StoredFile): FileStat {
    return {
      path: file.path,
      bytes: file.bytes,
      lines: file.lines.length,
      language: file.language,
      tier: file.tier,
    };
  }

  private start(): void {
    this.parser = new Parser({
      onReadEntry: (entry: ReadEntry) => this.onEntry(entry),
    });
    this.parsing = new Promise<void>((resolve) => {
      this.parser!.on('error', () => {
        this.failure ??= new ExtractionError(
          'SOURCE_ARCHIVE_INVALID',
          'Repository archive is invalid',
        );
        resolve();
      });
      this.parser!.on('end', () => resolve());
    });
  }

  private onEntry(entry: ReadEntry): void {
    this.summary.entriesScanned++;
    this.expandedBytes += entry.size;
    if (
      this.summary.entriesScanned > MAX_ENTRIES ||
      this.expandedBytes > MAX_EXPANDED_BYTES
    ) {
      this.failure ??= new ExtractionError(
        'SOURCE_TOO_LARGE',
        'Repository archive exceeds expansion limits',
      );
      entry.resume();
      return;
    }
    const path =
      entry.type === 'File' ? normalizeArchivePath(entry.path) : null;
    if (!path) {
      entry.resume();
      return;
    }
    const reason = this.preliminaryExclusion(path, entry.size);
    if (reason) {
      this.exclude(path, reason);
      entry.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    entry.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received <= MAX_FILE_BYTES) chunks.push(chunk);
    });
    entry.on('end', () => {
      if (received > MAX_FILE_BYTES) {
        this.exclude(path, 'file_too_large');
        return;
      }
      const content = Buffer.concat(chunks);
      const finalReason = this.contentExclusion(content);
      if (finalReason) {
        this.exclude(path, finalReason);
        return;
      }
      if (this.summary.includedBytes + content.length > MAX_TOTAL_BYTES) {
        this.exclude(path, 'total_size_limit');
        return;
      }
      const text = content.toString('utf8');
      if (PRIVATE_KEY_BLOCK.test(text)) {
        this.exclude(path, 'private_key_material');
        return;
      }
      const lines = text.split(/\r?\n/);
      if (lines.some((line) => line.length > MAX_LINE_CHARS)) {
        this.exclude(path, 'generated_or_minified');
        return;
      }
      const spec = languageOf(path);
      this.files.set(path, {
        path,
        content: text,
        lines,
        bytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        language: spec?.language ?? null,
        grammar: spec?.grammar ?? null,
        tier: spec?.grammar ? 1 : 0,
      });
      this.summary.includedFiles++;
      this.summary.includedBytes += content.length;
    });
  }

  private exclude(path: string, reason: ExclusionReason): void {
    this.summary.excludedCounts[reason] =
      (this.summary.excludedCounts[reason] ?? 0) + 1;
    if (reason === 'file_count_limit' || reason === 'total_size_limit') {
      this.summary.truncated = true;
    }
    if (this.summary.excludedSamples.length < MAX_EXCLUDED_SAMPLES) {
      this.summary.excludedSamples.push({ path, reason });
    }
  }

  private preliminaryExclusion(
    path: string,
    size: number,
  ): ExclusionReason | null {
    const segments = path.split('/');
    const name = segments.at(-1)!;
    if (
      segments.slice(0, -1).some((segment) => EXCLUDED_DIRECTORIES.has(segment))
    ) {
      return 'excluded_directory';
    }
    if (DENIED_FILE.test(name)) return 'denied_file';
    const lower = name.toLowerCase();
    if (
      DENIED_NAMES.has(name) ||
      [...DENIED_EXTENSIONS].some((extension) => lower.endsWith(extension))
    ) {
      return 'unsupported_type';
    }
    if (!posix.extname(name) && !languageOf(path)) return 'unsupported_type';
    if (size > MAX_FILE_BYTES) return 'file_too_large';
    if (this.summary.includedFiles >= MAX_FILES) return 'file_count_limit';
    if (this.summary.includedBytes + size > MAX_TOTAL_BYTES) {
      return 'total_size_limit';
    }
    return null;
  }

  private contentExclusion(content: Buffer): ExclusionReason | null {
    if (content.includes(0)) return 'binary_content';
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch {
      return 'binary_content';
    }
    return null;
  }
}

/** Strips GitHub's `owner-repo-sha/` root and rejects unsafe paths. */
export function normalizeArchivePath(rawPath: string): string | null {
  const withoutRoot = rawPath.split('/').slice(1).join('/');
  if (!withoutRoot || withoutRoot.length > 1024) return null;
  const normalized = posix.normalize(withoutRoot);
  if (
    normalized.startsWith('/') ||
    normalized.startsWith('..') ||
    [...normalized].some((character) => character.charCodeAt(0) < 0x20)
  ) {
    return null;
  }
  return normalized;
}
