import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { Readable } from 'node:stream';
import { Parser, ReadEntry } from 'tar';
import {
  containsPrivateKeyBlock,
  redactSecrets,
} from '../../common/secret-detection.js';
import type { AnalysisSourceFile } from '../../infrastructure/ai/application-analysis.provider.js';
import type { ExclusionReason, SourceManifest } from './analysis.types.js';

const MAX_FILES = 2_000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRIES = 200_000;
const MAX_EXCLUDED_SAMPLES = 500;

const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  '.next',
  '.nuxt',
  '.venv',
  '__pycache__',
  'bin',
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
  /^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|jks|keystore|crt|cer|der|tfstate|tfvars|kdbx)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.htpasswd|credentials(?:\..*)?|secrets?\..*)$/i;

const ALLOWED_EXTENSIONS = new Set([
  '.c',
  '.cfg',
  '.cjs',
  '.clj',
  '.conf',
  '.cpp',
  '.cs',
  '.cts',
  '.erl',
  '.ex',
  '.exs',
  '.go',
  '.gql',
  '.gradle',
  '.graphql',
  '.groovy',
  '.h',
  '.hpp',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.kts',
  '.mjs',
  '.mts',
  '.php',
  '.prisma',
  '.properties',
  '.proto',
  '.py',
  '.rb',
  '.rs',
  '.scala',
  '.sql',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
]);

const ALLOWED_NAMES = new Set([
  'Dockerfile',
  'Gemfile',
  'Makefile',
  'Pipfile',
  'Procfile',
  'go.mod',
  'requirements.txt',
]);

export class SourceSnapshotError extends Error {
  constructor(
    readonly code: 'SOURCE_TOO_LARGE' | 'SOURCE_ARCHIVE_INVALID',
    message: string,
  ) {
    super(message);
  }
}

export interface SourceSnapshot {
  files: AnalysisSourceFile[];
  manifest: SourceManifest;
}

/**
 * Reads a repository tarball in memory, keeping only allowlisted text files
 * and redacting detectable credentials before anything is retained. Nothing
 * is written to disk, so archive paths cannot escape a directory.
 */
@Injectable()
export class SourceSnapshotBuilder {
  async build(
    archive: Readable,
    repository: string,
    commitSha: string,
  ): Promise<SourceSnapshot> {
    const files: AnalysisSourceFile[] = [];
    const manifest: SourceManifest = {
      repository,
      commitSha,
      includedFiles: [],
      excludedCounts: {},
      excludedSamples: [],
      totals: {
        entriesScanned: 0,
        includedFiles: 0,
        includedBytes: 0,
        redactions: 0,
      },
      truncated: false,
      limits: {
        maxFiles: MAX_FILES,
        maxFileBytes: MAX_FILE_BYTES,
        maxTotalBytes: MAX_TOTAL_BYTES,
      },
    };
    const exclude = (path: string, reason: ExclusionReason) => {
      manifest.excludedCounts[reason] =
        (manifest.excludedCounts[reason] ?? 0) + 1;
      if (reason === 'file_count_limit' || reason === 'total_size_limit') {
        manifest.truncated = true;
      }
      if (manifest.excludedSamples.length < MAX_EXCLUDED_SAMPLES) {
        manifest.excludedSamples.push({ path, reason });
      }
    };

    let expandedBytes = 0;
    // Set from parser callbacks; an object keeps TypeScript from narrowing it.
    const state: { failure: Error | null } = { failure: null };
    const parser = new Parser({
      onReadEntry: (entry: ReadEntry) => {
        manifest.totals.entriesScanned++;
        expandedBytes += entry.size;
        if (
          manifest.totals.entriesScanned > MAX_ENTRIES ||
          expandedBytes > MAX_EXPANDED_BYTES
        ) {
          state.failure ??= new SourceSnapshotError(
            'SOURCE_TOO_LARGE',
            'Repository archive exceeds expansion limits',
          );
          entry.resume();
          return;
        }
        if (entry.type !== 'File') {
          entry.resume();
          return;
        }
        const path = this.normalizePath(entry.path);
        if (!path) {
          entry.resume();
          return;
        }
        const reason = this.preliminaryExclusion(path, entry.size, manifest);
        if (reason) {
          exclude(path, reason);
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
          const content = Buffer.concat(chunks);
          const finalReason =
            received > MAX_FILE_BYTES
              ? 'file_too_large'
              : this.contentExclusion(content);
          if (finalReason) {
            exclude(path, finalReason);
            return;
          }
          // Re-check after reading: entry.size can be smaller than the data.
          if (
            manifest.totals.includedBytes + content.length >
            MAX_TOTAL_BYTES
          ) {
            exclude(path, 'total_size_limit');
            return;
          }
          const text = content.toString('utf8');
          if (containsPrivateKeyBlock(text)) {
            exclude(path, 'private_key_material');
            return;
          }
          const redacted = redactSecrets(text);
          const redactionCount = Object.values(redacted.counts).reduce(
            (sum, count) => sum + count,
            0,
          );
          files.push({ path, content: redacted.text });
          manifest.includedFiles.push({
            path,
            sizeBytes: Buffer.byteLength(redacted.text),
            sha256: createHash('sha256').update(redacted.text).digest('hex'),
            redactions: redacted.counts,
          });
          manifest.totals.includedFiles++;
          manifest.totals.includedBytes += content.length;
          manifest.totals.redactions += redactionCount;
        });
      },
    });

    await new Promise<void>((resolve, reject) => {
      let downloaded = 0;
      const fail = (error: Error) => {
        archive.destroy();
        reject(error);
      };
      parser.on('error', () =>
        fail(
          new SourceSnapshotError(
            'SOURCE_ARCHIVE_INVALID',
            'Repository archive is invalid',
          ),
        ),
      );
      parser.on('end', () => resolve());
      archive.on('error', (error) => fail(error));
      archive.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        if (downloaded > MAX_DOWNLOAD_BYTES || state.failure) {
          fail(
            state.failure ??
              new SourceSnapshotError(
                'SOURCE_TOO_LARGE',
                'Repository archive is too large',
              ),
          );
          return;
        }
        if (!parser.write(chunk)) {
          archive.pause();
          parser.once('drain', () => archive.resume());
        }
      });
      archive.on('end', () => parser.end());
    });
    if (state.failure) throw state.failure;
    return { files, manifest };
  }

  /** Strips GitHub's `owner-repo-sha/` root and rejects unsafe paths. */
  private normalizePath(rawPath: string): string | null {
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

  private preliminaryExclusion(
    path: string,
    size: number,
    manifest: SourceManifest,
  ): ExclusionReason | null {
    const segments = path.split('/');
    const name = segments.at(-1)!;
    if (
      segments.slice(0, -1).some((segment) => EXCLUDED_DIRECTORIES.has(segment))
    ) {
      return 'excluded_directory';
    }
    if (DENIED_FILE.test(name)) return 'denied_file';
    if (
      !ALLOWED_NAMES.has(name) &&
      !ALLOWED_EXTENSIONS.has(posix.extname(name).toLowerCase())
    ) {
      return 'unsupported_type';
    }
    if (
      name.endsWith('.min.js') ||
      name === 'package-lock.json' ||
      name === 'yarn.lock'
    ) {
      return 'unsupported_type';
    }
    if (size > MAX_FILE_BYTES) return 'file_too_large';
    if (manifest.totals.includedFiles >= MAX_FILES) return 'file_count_limit';
    if (manifest.totals.includedBytes + size > MAX_TOTAL_BYTES) {
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
