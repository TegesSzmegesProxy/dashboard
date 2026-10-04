import { parentPort, workerData } from 'node:worker_threads';

/**
 * Runs untrusted regular expressions (route rules and searches written by the
 * model) away from the host's main thread, which terminates this worker when
 * a job exceeds its time limit.
 */
export interface RegexJob {
  jobId: number;
  pattern: string;
  flags: string;
  /** Anchored path regex source, or null for every file. */
  pathPattern: string | null;
  maxMatches: number;
}

export interface RegexMatch {
  path: string;
  line: number;
  groups: (string | null)[];
  text: string;
}

export interface RegexJobResult {
  jobId: number;
  matches: RegexMatch[];
  truncated: boolean;
}

const files = (workerData as { files: [string, string[]][] }).files;

parentPort!.on('message', (job: RegexJob) => {
  const regex = new RegExp(job.pattern, job.flags.replace(/[gy]/g, ''));
  const pathRegex = job.pathPattern ? new RegExp(job.pathPattern) : null;
  const matches: RegexMatch[] = [];
  let truncated = false;
  outer: for (const [path, lines] of files) {
    if (pathRegex && !pathRegex.test(path)) continue;
    for (let index = 0; index < lines.length; index++) {
      const match = regex.exec(lines[index]);
      if (!match) continue;
      if (matches.length >= job.maxMatches) {
        truncated = true;
        break outer;
      }
      matches.push({
        path,
        line: index + 1,
        groups: match.slice(1).map((group) => group ?? null),
        text: lines[index].slice(0, 300),
      });
    }
  }
  const result: RegexJobResult = { jobId: job.jobId, matches, truncated };
  parentPort!.postMessage(result);
});
