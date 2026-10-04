import { candidateKey } from './paths.js';
import type { CandidateSourceKind, RouteCandidate } from './protocol.js';

const MAX_CANDIDATES = 5_000;
const MAX_LOCATIONS = 10;
const MAX_HINTS = 30;

/** Merges candidates from every source by method and normalized path. */
export class CandidateSet {
  private readonly byKey = new Map<string, RouteCandidate>();
  private unknownCounter = 0;
  truncated = false;

  add(
    method: string | null,
    path: string | null,
    source: { kind: CandidateSourceKind; detail: string },
    location: { path: string; line: number } | null,
    hints: string[] = [],
  ): void {
    const key =
      path === null
        ? `? ${source.kind}-${++this.unknownCounter}`
        : candidateKey(method, path);
    let candidate = this.byKey.get(key);
    if (!candidate) {
      if (this.byKey.size >= MAX_CANDIDATES) {
        this.truncated = true;
        return;
      }
      candidate = { key, method, path, sources: [], locations: [], hints: [] };
      this.byKey.set(key, candidate);
    }
    if (
      !candidate.sources.some(
        (existing) =>
          existing.kind === source.kind && existing.detail === source.detail,
      )
    ) {
      candidate.sources.push(source);
    }
    if (
      location &&
      candidate.locations.length < MAX_LOCATIONS &&
      !candidate.locations.some(
        (existing) =>
          existing.path === location.path && existing.line === location.line,
      )
    ) {
      candidate.locations.push(location);
    }
    for (const hint of hints) {
      if (candidate.hints.length >= MAX_HINTS) break;
      if (!candidate.hints.includes(hint)) candidate.hints.push(hint);
    }
  }

  merge(other: RouteCandidate[]): void {
    for (const candidate of other) {
      for (const source of candidate.sources) {
        candidate.locations.forEach((location) =>
          this.add(
            candidate.method,
            candidate.path,
            source,
            location,
            candidate.hints,
          ),
        );
        if (candidate.locations.length === 0) {
          this.add(
            candidate.method,
            candidate.path,
            source,
            null,
            candidate.hints,
          );
        }
      }
    }
  }

  /** `* /path` folds into method-specific candidates of the same path. */
  list(): RouteCandidate[] {
    const specific = new Map<string, RouteCandidate[]>();
    for (const candidate of this.byKey.values()) {
      if (candidate.method && candidate.path) {
        const list = specific.get(candidate.path) ?? [];
        list.push(candidate);
        specific.set(candidate.path, list);
      }
    }
    const result: RouteCandidate[] = [];
    for (const candidate of this.byKey.values()) {
      const targets =
        !candidate.method && candidate.path
          ? specific.get(candidate.path)
          : undefined;
      if (targets) {
        for (const target of targets) {
          for (const source of candidate.sources) {
            if (
              !target.sources.some(
                (existing) =>
                  existing.kind === source.kind &&
                  existing.detail === source.detail,
              )
            ) {
              target.sources.push(source);
            }
          }
          for (const location of candidate.locations) {
            if (target.locations.length < MAX_LOCATIONS)
              target.locations.push(location);
          }
        }
        continue;
      }
      result.push(candidate);
    }
    return result;
  }
}
