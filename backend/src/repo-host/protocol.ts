/**
 * Wire protocol between the analysis worker and `repo-host`, the process that
 * runs inside the per-job sandbox (ADR-0013). Newline-delimited JSON over
 * stdin/stdout; stderr carries only operational logs without content.
 *
 * The repository archive is streamed in with `archive.chunk` requests, so the
 * sandbox never needs network access or credentials.
 */

export interface HostRequest {
  id: number;
  op: HostOperation;
  params?: Record<string, unknown>;
}

export type HostResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { code: string; message: string } };

export type HostOperation =
  | 'archive.chunk'
  | 'archive.end'
  | 'index'
  | 'list_files'
  | 'read_file'
  | 'search'
  | 'outline'
  | 'definitions'
  | 'references'
  | 'test_route_rule'
  | 'apply_route_rules'
  | 'file_stats'
  | 'route_like_files';

export type ExclusionReason =
  | 'excluded_directory'
  | 'denied_file'
  | 'unsupported_type'
  | 'file_too_large'
  | 'binary_content'
  | 'private_key_material'
  | 'generated_or_minified'
  | 'file_count_limit'
  | 'total_size_limit';

export interface ExtractionSummary {
  entriesScanned: number;
  includedFiles: number;
  includedBytes: number;
  excludedCounts: Partial<Record<ExclusionReason, number>>;
  excludedSamples: { path: string; reason: ExclusionReason }[];
  truncated: boolean;
  /** SHA-256 over sorted `path:sha256` lines of every included file. */
  sourceHash: string;
}

export type LanguageTier = 0 | 1 | 2;

export type CandidateSourceKind =
  | 'heuristic'
  | 'framework_pack'
  | 'spec'
  | 'route_rule'
  | 'recon'
  | 'environment'
  | 'sweep';

export interface CandidateLocation {
  path: string;
  line: number;
}

export interface RouteCandidate {
  /** `METHOD /path`, `* /path` when the method is unknown, or a unique id. */
  key: string;
  method: string | null;
  path: string | null;
  sources: { kind: CandidateSourceKind; detail: string }[];
  locations: CandidateLocation[];
  /** Constraint hints from framework packs or specs, e.g. `body.email: @IsEmail()`. */
  hints: string[];
}

export interface RepoIndexSummary {
  files: number;
  bytes: number;
  languages: Record<string, number>;
  tiers: Record<LanguageTier, number>;
  frameworkGuesses: string[];
  dependencyManifests: string[];
  specFiles: string[];
  symbols: number;
  candidates: RouteCandidate[];
  candidatesTruncated: boolean;
}

export interface RouteRule {
  description: string;
  fileGlob: string | null;
  pattern: string;
  caseInsensitive: boolean;
  method: string | null;
  methodGroup: number | null;
  pathGroup: number;
  pathPrefix: string;
}

export interface RuleRunResult {
  matches: number;
  candidates: RouteCandidate[];
  samples: {
    path: string;
    line: number;
    method: string | null;
    path_: string;
  }[];
  timedOut: boolean;
  error: string | null;
}

export interface SearchHit {
  path: string;
  line: number;
  preview: string;
}

export interface SymbolLocation {
  name: string;
  kind: string;
  path: string;
  startLine: number;
  endLine: number;
}

export interface FileStat {
  path: string;
  bytes: number;
  lines: number;
  language: string | null;
  tier: LanguageTier;
}
